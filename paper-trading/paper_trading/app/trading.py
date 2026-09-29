"""Trading workflow for trading-enabled runs (Step 5).

Called by the replay engine inside each event's transaction, in this order:

  1. ``before_event``        expire OPEN orders whose TTL ended at or before the event time
  2. (replay)                validate and record the incoming quote
  3. ``on_accepted_quote``   evaluate already-open orders against the quote, apply fills and
                             accounting, mark positions, then run the strategy on the updated
                             state and send any proposal through risk and order acceptance
  4. ``after_event``         label stale marks; at SESSION_CLOSE expire remaining orders
  5. ``on_exhausted``        COMPLETED if flat, INCOMPLETE with the open exposure otherwise
  6. (replay)                commit the event, cursor, and checkpoint atomically

Commands (``start``, ``request_close``, ``cancel_order``) use the same helpers.
Replay-only runs never reach this module.
"""

from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timedelta
from typing import Optional

from paper_trading.accounting.fills import apply_fill, mark_positions, refresh_staleness
from paper_trading.accounting.ledger import compute_snapshot, reconcile
from paper_trading.app.coordinator import new_id
from paper_trading.app.events import append_run_event
from paper_trading.broker import paper as broker
from paper_trading.contracts.models import (
    MarketQuote,
    OptionContract,
    Position,
    RiskDecision,
    TradeProposal,
)
from paper_trading.contracts.types import SCHEMA_VERSION, parse_utc
from paper_trading.risk import policy as risk
from paper_trading.strategy import sample_spy_long_call as strategy


class TradingError(RuntimeError):
    code = "TRADING_ERROR"


class NotTradingRunError(TradingError):
    code = "NOT_A_TRADING_RUN"


class RunStateError(TradingError):
    code = "RUN_STATE"


class ReconciliationFailedError(TradingError):
    code = "RECONCILIATION_FAILED"


class NoOpenPositionError(TradingError):
    code = "NO_OPEN_POSITION"


# --- state helpers ---------------------------------------------------------


def _run(conn, run_id) -> sqlite3.Row:
    return conn.execute("SELECT * FROM runs WHERE run_id = ?", (run_id,)).fetchone()


def _quote(row: sqlite3.Row) -> MarketQuote:
    # Provenance times (quote_provenance) are audit data; trading never reads them.
    data = {k: row[k] for k in MarketQuote.model_fields if k != "schema_version" and k in row.keys()}
    return MarketQuote(schema_version=SCHEMA_VERSION, **{**data, "is_sample": bool(row["is_sample"])})


def _position(row: sqlite3.Row) -> Position:
    return Position(schema_version=SCHEMA_VERSION, **{k: row[k] for k in Position.model_fields if k != "schema_version"})


def _contracts(conn, run_id) -> tuple[OptionContract, ...]:
    from paper_trading.app.replay import stored_fixture

    _, doc = stored_fixture(conn, run_id)
    return tuple(doc.contracts)


def latest_quote_row(conn, run_id: str, contract_id: str) -> Optional[sqlite3.Row]:
    """The contract's latest accepted quote: one descending probe of ix_quotes_run_contract_event."""
    return conn.execute(
        """SELECT * FROM market_quotes WHERE run_id = ? AND contract_id = ?
            ORDER BY event_sequence DESC LIMIT 1""", (run_id, contract_id)).fetchone()


def _latest_quotes(conn, run_id) -> dict[str, MarketQuote]:
    """Latest accepted quote per dataset contract (only dataset contracts can have quotes)."""
    latest = {}
    for c in _contracts(conn, run_id):
        row = latest_quote_row(conn, run_id, c.contract_id)
        if row is not None:
            latest[c.contract_id] = _quote(row)
    return latest


def _open_position(conn, run_id) -> Optional[sqlite3.Row]:
    return conn.execute("SELECT * FROM positions WHERE run_id = ? AND status = 'OPEN' ORDER BY opened_at LIMIT 1",
                        (run_id,)).fetchone()


def _last_entry_rejections(conn, run_id, clock: str) -> dict[str, datetime]:
    """Latest rejection time per contract for entries (risk rejections and acceptance rejections).

    Only used for the 60 s per-contract cooldown (clarification 1), so only
    rejections in the last 60 s can change a decision. Rows are read from
    (clock - 61 s, floored to the second) onward through an index, which is a
    superset of that window; the latest time per contract is then computed
    exactly as before. A contract whose latest rejection is older is absent,
    which the strategy treats the same as "cooldown over". This keeps the
    cost bounded by the cooldown window instead of growing with the day.
    """
    cutoff = parse_utc(clock) - timedelta(seconds=strategy.REJECTION_COOLDOWN_SECONDS + 1)
    # Timestamps are RFC 3339 UTC; a bare "YYYY-MM-DDTHH:MM:SS" prefix sorts at or before
    # every timestamp within that second, so the string bound never drops a row in the window.
    bound = cutoff.strftime("%Y-%m-%dT%H:%M:%S")
    rows = conn.execute(
        """SELECT p.contract_id, d.evaluated_at AS at FROM risk_decisions d JOIN trade_proposals p USING (proposal_id)
            WHERE d.run_id = ? AND d.decision = 'REJECTED' AND d.evaluated_at >= ? AND p.intent = 'BUY_TO_OPEN'
           UNION ALL
           SELECT o.contract_id, o.updated_at FROM orders o
            WHERE o.run_id = ? AND o.status = 'REJECTED' AND o.intent = 'BUY_TO_OPEN' AND o.updated_at >= ?""",
        (run_id, bound, run_id, bound),
    ).fetchall()
    latest: dict[str, datetime] = {}
    for r in rows:
        t = parse_utc(r["at"])
        if r["contract_id"] not in latest or t > latest[r["contract_id"]]:
            latest[r["contract_id"]] = t
    return latest


# --- proposal -> risk -> order ---------------------------------------------


def _persist_proposal(conn, run, draft: strategy.ProposalDraft, clock: str) -> sqlite3.Row:
    account = conn.execute("SELECT account_id FROM accounts WHERE run_id = ?", (run["run_id"],)).fetchone()
    seq = conn.execute("SELECT MAX(event_sequence) FROM run_events WHERE run_id = ?", (run["run_id"],)).fetchone()[0]
    proposal = TradeProposal(
        schema_version=SCHEMA_VERSION, proposal_id=new_id("prp"), run_id=run["run_id"],
        account_id=account["account_id"], contract_id=draft.contract_id, position_id=draft.position_id,
        quote_id=draft.quote_id, strategy_id=run["strategy_id"], strategy_version=run["strategy_version"],
        created_at=clock, intent=draft.intent, quantity=draft.quantity, limit_cents=draft.limit_cents,
        reason_code=draft.reason_code, reason=draft.reason, exit_rules=strategy.EXIT_RULES,
        # Deterministic and unique: at most one proposal per intent after each committed run event.
        idempotency_key=f"{run['run_id']}:{draft.intent}:after-event-{seq}",
    )
    r = proposal.exit_rules
    conn.execute(
        """INSERT INTO trade_proposals (proposal_id, schema_version, run_id, account_id, contract_id, position_id,
               quote_id, strategy_id, strategy_version, created_at, intent, quantity, limit_cents, reason_code,
               reason, profit_target_bps, loss_threshold_bps, max_hold_seconds, idempotency_key)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (proposal.proposal_id, SCHEMA_VERSION, proposal.run_id, proposal.account_id, proposal.contract_id,
         proposal.position_id, proposal.quote_id, proposal.strategy_id, proposal.strategy_version, clock,
         proposal.intent, proposal.quantity, proposal.limit_cents, proposal.reason_code, proposal.reason,
         r.profit_target_bps, r.loss_threshold_bps, r.max_hold_seconds, proposal.idempotency_key),
    )
    append_run_event(conn, run["run_id"], "PROPOSAL_CREATED", clock, {
        "proposal_id": proposal.proposal_id, "intent": proposal.intent, "contract_id": proposal.contract_id,
        "limit_cents": proposal.limit_cents, "reason_code": proposal.reason_code, "quote_id": proposal.quote_id,
    })
    return conn.execute("SELECT * FROM trade_proposals WHERE proposal_id = ?", (proposal.proposal_id,)).fetchone()


def _proposal_model(row: sqlite3.Row) -> TradeProposal:
    fields = {k: row[k] for k in TradeProposal.model_fields if k not in ("schema_version", "exit_rules")}
    return TradeProposal(schema_version=SCHEMA_VERSION, exit_rules=strategy.EXIT_RULES, **fields)


def evaluate_risk(conn, run, proposal_row: sqlite3.Row, clock: str) -> sqlite3.Row:
    """Persist a risk decision bound to the current account revision."""
    run_id = run["run_id"]
    account = conn.execute("SELECT * FROM accounts WHERE run_id = ?", (run_id,)).fetchone()
    snap = compute_snapshot(conn, account["account_id"])
    contract_row = conn.execute("SELECT * FROM option_contracts WHERE contract_id = ?",
                                (proposal_row["contract_id"],)).fetchone()
    contract = None
    if contract_row is not None:
        contract = OptionContract(schema_version=SCHEMA_VERSION, **{
            **{k: contract_row[k] for k in OptionContract.model_fields if k != "schema_version"},
            "adjusted": bool(contract_row["adjusted"])})
    pos_row = _open_position(conn, run_id)
    inputs = risk.RiskInputs(
        clock=parse_utc(clock),
        account_revision=account["account_revision"],
        available_cash_cents=snap.available_cash_cents,
        entry_risk_limit_cents=run["entry_risk_limit_cents"],
        fee_per_contract_cents=run["fee_per_contract_cents"],
        contract=contract,
        current_quote=_latest_quotes(conn, run_id).get(proposal_row["contract_id"]),
        position=_position(pos_row) if pos_row is not None and pos_row["contract_id"] == proposal_row["contract_id"]
        else None,
        has_open_position=pos_row is not None,
        has_open_entry_order=conn.execute(
            """SELECT COUNT(*) FROM orders WHERE run_id = ? AND intent = 'BUY_TO_OPEN'
                AND status IN ('PENDING','OPEN')""", (run_id,)).fetchone()[0] > 0,
    )
    verdict = risk.evaluate(_proposal_model(proposal_row), inputs)
    decision = RiskDecision(
        schema_version=SCHEMA_VERSION, risk_decision_id=new_id("rsk"), run_id=run_id,
        proposal_id=proposal_row["proposal_id"], evaluated_at=clock, policy_version=run["risk_policy_version"],
        account_revision=account["account_revision"], decision=verdict.decision,
        reason_codes=list(verdict.reason_codes), required_cash_cents=verdict.required_cash_cents,
        available_cash_cents=snap.available_cash_cents, entry_risk_cents=verdict.entry_risk_cents,
        entry_risk_limit_cents=run["entry_risk_limit_cents"],
    )
    conn.execute(
        """INSERT INTO risk_decisions (risk_decision_id, schema_version, run_id, proposal_id, evaluated_at,
               policy_version, account_revision, decision, reason_codes_json, required_cash_cents,
               available_cash_cents, entry_risk_cents, entry_risk_limit_cents) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (decision.risk_decision_id, SCHEMA_VERSION, run_id, decision.proposal_id, clock, decision.policy_version,
         decision.account_revision, decision.decision, json.dumps(decision.reason_codes),
         decision.required_cash_cents, decision.available_cash_cents, decision.entry_risk_cents,
         decision.entry_risk_limit_cents),
    )
    append_run_event(conn, run_id, f"RISK_{decision.decision}", clock, {
        "risk_decision_id": decision.risk_decision_id, "proposal_id": decision.proposal_id,
        "reason_codes": decision.reason_codes, "required_cash_cents": decision.required_cash_cents,
        "account_revision": decision.account_revision,
    })
    return conn.execute("SELECT * FROM risk_decisions WHERE risk_decision_id = ?",
                        (decision.risk_decision_id,)).fetchone()


def _propose_and_route(conn, run, draft: strategy.ProposalDraft, clock: str) -> dict:
    proposal = _persist_proposal(conn, run, draft, clock)
    decision = evaluate_risk(conn, run, proposal, clock)
    result = {"proposal_id": proposal["proposal_id"], "decision": decision["decision"], "order": None}
    if decision["decision"] == "APPROVED":
        require_reconciled(conn, run["run_id"])  # no order acceptance on books that do not reconcile
        generating = conn.execute("SELECT source_sequence FROM market_quotes WHERE quote_id = ?",
                                  (proposal["quote_id"],)).fetchone()[0]
        submitted = broker.submit(conn, run, proposal, decision, clock, generating)
        result["order"] = {"order_id": submitted.order_id, "status": submitted.status,
                           "terminal_reason": submitted.terminal_reason}
    return result


def _evaluate_exit(conn, run_id: str, clock: str) -> Optional[dict]:
    """Exit rules for the open position; route any closing proposal through risk and the broker."""
    run = _run(conn, run_id)
    now = parse_utc(clock)
    latest = _latest_quotes(conn, run_id)
    pos_row = _open_position(conn, run_id)

    if pos_row is not None:
        pos = _position(pos_row)
        intent = conn.execute("SELECT * FROM exit_intents WHERE position_id = ?", (pos.position_id,)).fetchone()
        state = strategy.ExitState(
            clock=now, position=pos, latest_quote=latest.get(pos.contract_id),
            has_pending_close=conn.execute(
                """SELECT COUNT(*) FROM orders WHERE position_id = ? AND intent = 'SELL_TO_CLOSE'
                    AND status IN ('PENDING','OPEN')""", (pos.position_id,)).fetchone()[0] > 0,
            intent_reason=intent["reason_code"] if intent else None,
            prior_close_proposals=conn.execute(
                "SELECT COUNT(*) FROM trade_proposals WHERE position_id = ? AND intent = 'SELL_TO_CLOSE'",
                (pos.position_id,)).fetchone()[0],
        )
        new_intent, draft = strategy.evaluate_exit(state)
        if new_intent is not None:
            q = latest.get(pos.contract_id)
            conn.execute(
                """INSERT INTO exit_intents (position_id, run_id, reason_code, requested_by, created_at,
                       trigger_quote_id) VALUES (?,?,?,?,?,?)""",
                (pos.position_id, run_id, new_intent, "STRATEGY", clock, q.quote_id if q else None),
            )
            append_run_event(conn, run_id, "EXIT_INTENT_CREATED", clock,
                             {"position_id": pos.position_id, "reason_code": new_intent, "requested_by": "STRATEGY"})
        return _propose_and_route(conn, run, draft, clock) if draft else None

    return None


def _entry(conn, run_id, clock, event_quote: MarketQuote) -> Optional[dict]:
    run = _run(conn, run_id)
    state = strategy.EntryState(
        clock=parse_utc(clock),
        session_timezone=run["session_timezone"],
        session_reference_cents=run["session_reference_cents"],
        contracts=_contracts(conn, run_id),
        latest_quotes=_latest_quotes(conn, run_id),
        has_open_position=_open_position(conn, run_id) is not None,
        has_pending_entry=conn.execute(
            """SELECT COUNT(*) FROM orders WHERE run_id = ? AND intent = 'BUY_TO_OPEN'
                AND status IN ('PENDING','OPEN')""", (run_id,)).fetchone()[0] > 0,
        has_completed_trade=conn.execute("SELECT COUNT(*) FROM closed_trades WHERE run_id = ?",
                                         (run_id,)).fetchone()[0] > 0,
        last_entry_rejection_at=_last_entry_rejections(conn, run_id, clock),
    )
    draft = strategy.evaluate_entry(state, event_quote)
    return _propose_and_route(conn, run, draft, clock) if draft else None


# --- event hooks -----------------------------------------------------------


def before_event(conn, run_id: str, clock: str) -> None:
    broker.expire_due(conn, run_id, clock)


def on_accepted_quote(conn, run_id: str, quote: MarketQuote, clock: str) -> dict:
    run = _run(conn, run_id)
    now = parse_utc(clock)
    fills = []
    consumed = {"BUY_TO_OPEN": 0, "SELL_TO_CLOSE": 0}
    for order in conn.execute(
        """SELECT * FROM orders WHERE run_id = ? AND status = 'OPEN' AND contract_id = ?
            ORDER BY submitted_at, order_id""", (run_id, quote.contract_id)
    ).fetchall():
        price = broker.fill_price(order, quote, now, consumed[order["intent"]])
        if price is not None:
            fills.append(apply_fill(conn, run, order, quote, price, clock).fill_id)
            consumed[order["intent"]] += order["quantity"]
    mark_positions(conn, run_id, quote)
    if _open_position(conn, run_id) is not None:
        routed = _evaluate_exit(conn, run_id, clock)
    else:
        routed = _entry(conn, run_id, clock, quote)
    return {"fills": fills, "routed": routed}


def after_event(conn, run_id: str, clock: str, event_type: str) -> None:
    if event_type == "SESSION_CLOSE":
        broker.expire_all(conn, run_id, clock, "SESSION_END")
    refresh_staleness(conn, run_id, clock)


def on_exhausted(conn, run_id: str, clock: str) -> str:
    """Finish the run: never fabricate a closing fill or realized profit."""
    open_positions = conn.execute(
        "SELECT position_id, contract_id, quantity, remaining_cost_basis_cents, market_value_cents, "
        "valuation_status FROM positions WHERE run_id = ? AND status = 'OPEN'", (run_id,)
    ).fetchall()
    if open_positions:
        exposure = [dict(p) for p in open_positions]
        reason = f"Fixture ended with {len(exposure)} open position(s); exposure remains and no close was invented."
        conn.execute("UPDATE runs SET status = 'INCOMPLETE', status_reason = ? WHERE run_id = ?", (reason, run_id))
        append_run_event(conn, run_id, "RUN_INCOMPLETE", clock, {"open_positions": exposure, "reason": reason})
        return "INCOMPLETE"
    conn.execute("UPDATE runs SET status = 'COMPLETED', status_reason = ? WHERE run_id = ?",
                 ("Session ended flat; all fixture events processed.", run_id))
    append_run_event(conn, run_id, "RUN_COMPLETED", clock, {})
    return "COMPLETED"


# --- guards and commands ---------------------------------------------------


def require_trading_run(run: sqlite3.Row) -> None:
    if not run["trading_enabled"]:
        raise NotTradingRunError("this is a replay-only run; create a trading run (init-sample --trading)")


def require_reconciled(conn, run_id: str) -> None:
    """Read-only check inside the caller's transaction: raise if the books do not reconcile.

    Called before every order acceptance and before starting a run, so no trading
    mutation proceeds on books that do not reconcile, even mid-event.
    """
    result = reconcile(conn, run_id)
    if not result.ok:
        raise ReconciliationFailedError("Reconciliation failed: " + "; ".join(result.discrepancies))


def record_reconciliation_failure(conn, run_id: str, reason: str) -> bool:
    """Pause a RUNNING trading run and record why (caller commits).

    Runs in any other status are left untouched, so refused commands on an
    already-paused run write nothing. Returns True if the run was paused.
    """
    run = _run(conn, run_id)
    if run is None or not run["trading_enabled"] or run["status"] != "RUNNING":
        return False
    conn.execute("UPDATE runs SET status = 'PAUSED', status_reason = ? WHERE run_id = ?", (reason, run_id))
    conn.execute("UPDATE replay_state SET status = 'PAUSED' WHERE run_id = ? AND status = 'ACTIVE'", (run_id,))
    discrepancies = reconcile(conn, run_id).discrepancies
    append_run_event(conn, run_id, "RECONCILIATION_FAILED", run["simulated_clock"],
                     {"reason": reason, "discrepancies": discrepancies})
    return True


def start(conn, run_id: str) -> dict:
    run = _run(conn, run_id)
    require_trading_run(run)
    if run["status"] != "READY":
        raise RunStateError(f"run is {run['status']}; only a READY run can be started")
    state = conn.execute("SELECT * FROM replay_state WHERE run_id = ?", (run_id,)).fetchone()
    if state is None:
        raise RunStateError("load a fixture before starting the run")
    require_reconciled(conn, run_id)
    conn.execute("UPDATE runs SET status = 'RUNNING', status_reason = NULL WHERE run_id = ?", (run_id,))
    append_run_event(conn, run_id, "RUN_STARTED", run["simulated_clock"], {"fixture_id": run["fixture_id"]})
    return {"run_status": "RUNNING"}


def request_close(conn, run_id: str) -> dict:
    """Record a MANUAL_CLOSE exit intent; propose now if a current quote exists."""
    run = _run(conn, run_id)
    require_trading_run(run)
    if run["status"] not in ("RUNNING", "PAUSED"):
        raise RunStateError(f"run is {run['status']}; manual close needs a RUNNING or PAUSED run")
    pos = _open_position(conn, run_id)
    if pos is None:
        raise NoOpenPositionError("there is no open position to close")
    clock = run["simulated_clock"]
    intent = conn.execute("SELECT * FROM exit_intents WHERE position_id = ?", (pos["position_id"],)).fetchone()
    created = intent is None
    if created:
        conn.execute(
            """INSERT INTO exit_intents (position_id, run_id, reason_code, requested_by, created_at)
               VALUES (?,?,?,?,?)""", (pos["position_id"], run_id, "MANUAL_CLOSE", "USER", clock))
        append_run_event(conn, run_id, "EXIT_INTENT_CREATED", clock,
                         {"position_id": pos["position_id"], "reason_code": "MANUAL_CLOSE", "requested_by": "USER"})
    routed = _evaluate_exit(conn, run_id, clock) if run["status"] == "RUNNING" else None
    reason = intent["reason_code"] if intent else "MANUAL_CLOSE"
    pending = conn.execute(
        """SELECT COUNT(*) FROM orders WHERE position_id = ? AND intent = 'SELL_TO_CLOSE'
            AND status IN ('PENDING','OPEN')""", (pos["position_id"],)).fetchone()[0]
    if routed:
        note = None
    elif pending:
        note = "A closing order is already open; no duplicate closing proposal was made."
    elif run["status"] == "PAUSED":
        note = "Run is paused; the closing proposal will be made on the next valid quote after resume."
    else:
        note = "Closing proposal will be made on the next valid quote."
    return {"position_id": pos["position_id"], "intent_created": created, "exit_intent": reason,
            "proposal": routed, "note": note}


def cancel_order(conn, run_id: str, order_id: str) -> dict:
    run = _run(conn, run_id)
    require_trading_run(run)
    order = broker.cancel(conn, run_id, order_id, run["simulated_clock"])
    return {"order_id": order_id, "status": order["status"], "terminal_reason": order["terminal_reason"],
            "note": "A persisted exit intent remains active and will retry on the next valid quote."
            if order["intent"] == "SELL_TO_CLOSE" else None}


def reconcile_running_runs(conn) -> list[str]:
    """Startup check: pause any RUNNING trading run whose books do not reconcile."""
    from paper_trading.storage.db import transaction

    paused = []
    for r in conn.execute("SELECT run_id FROM runs WHERE trading_enabled = 1 AND status = 'RUNNING'").fetchall():
        with transaction(conn):
            result = reconcile(conn, r["run_id"])
            if not result.ok and record_reconciliation_failure(
                    conn, r["run_id"], "Reconciliation failed at startup: " + "; ".join(result.discrepancies)):
                paused.append(r["run_id"])
    return paused
