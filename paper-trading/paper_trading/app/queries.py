"""Read models for the API and dashboard. Read-only: no function here writes."""

from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass, field
from typing import Optional
from zoneinfo import ZoneInfo

from pydantic import ValidationError

from paper_trading.accounting import compute_snapshot, reconcile
from paper_trading.accounting.ledger import ReconciliationResult
from paper_trading.contracts.models import (
    Account,
    AccountSnapshot,
    ClosedTrade,
    MarketQuote,
    Order,
    Position,
    Run,
)
from paper_trading.contracts.types import SCHEMA_VERSION, parse_utc


class RunNotFoundError(LookupError):
    pass


def _record(model, row: sqlite3.Row, **overrides):
    data = {k: row[k] for k in model.model_fields if k in row.keys()}
    data["schema_version"] = SCHEMA_VERSION
    data.update(overrides)
    return model(**data)


def _display_records(model, rows: list[sqlite3.Row]) -> list[dict]:
    """DIAGNOSTIC DISPLAY ONLY. Every stored row, as a dict, validated where possible.

    A row that no longer passes the record's invariants (corrupted books) is still
    shown, with its stored values, flagged ``untrusted: True`` and the validation
    error, instead of failing the page. These dicts must never feed strategy,
    risk, execution, or accounting: those modules read rows directly and validate
    them strictly, so corrupted data raises there instead of being used.
    """
    out = []
    for row in rows:
        try:
            out.append({**_record(model, row).model_dump(), "untrusted": False, "validation_error": None})
        except ValidationError as exc:
            data = {k: row[k] for k in model.model_fields if k in row.keys()}
            errors = "; ".join(e["msg"] for e in exc.errors())
            out.append({**data, "schema_version": SCHEMA_VERSION, "untrusted": True, "validation_error": errors})
    return out


def get_run(conn: sqlite3.Connection, init_key: str) -> Run:
    row = conn.execute("SELECT * FROM runs WHERE init_key = ?", (init_key,)).fetchone()
    if row is None:
        raise RunNotFoundError(
            f"no sample run for key '{init_key}'; run: python -m paper_trading init-sample"
        )
    watchlist = [r["symbol"] for r in conn.execute(
        "SELECT symbol FROM watchlist_items WHERE run_id = ? ORDER BY position", (row["run_id"],)
    )]
    trading = bool(row["trading_enabled"]) if "trading_enabled" in row.keys() else False
    return _record(Run, row, is_sample=bool(row["is_sample"]), watchlist=watchlist, trading_enabled=trading)


def get_account(conn: sqlite3.Connection, run_id: str) -> Account:
    row = conn.execute("SELECT * FROM accounts WHERE run_id = ?", (run_id,)).fetchone()
    if row is None:
        raise RunNotFoundError(f"run {run_id} has no account")
    return _record(Account, row)


def session_local_date(run: Run) -> str:
    """Session date in the exchange timezone (clarification 5: no fixed offsets)."""
    return parse_utc(run.session_start).astimezone(ZoneInfo(run.session_timezone)).date().isoformat()


def _rows(conn, table: str, run_id: str, order_by: str) -> list[sqlite3.Row]:
    return conn.execute(f"SELECT * FROM {table} WHERE run_id = ? ORDER BY {order_by}", (run_id,)).fetchall()


def display_positions(conn: sqlite3.Connection, run_id: str) -> list[dict]:
    return _display_records(Position, _rows(conn, "positions", run_id, "opened_at, position_id"))


def display_orders(conn: sqlite3.Connection, run_id: str) -> list[dict]:
    return _display_records(Order, _rows(conn, "orders", run_id, "submitted_at, order_id"))


def display_closed_trades(conn: sqlite3.Connection, run_id: str) -> list[dict]:
    return _display_records(ClosedTrade, _rows(conn, "closed_trades", run_id, "closed_at, closed_trade_id"))


def list_positions(conn: sqlite3.Connection, run_id: str) -> list[Position]:
    """Strict: raises if a stored position fails validation. Use display_positions for pages."""
    rows = conn.execute(
        "SELECT * FROM positions WHERE run_id = ? ORDER BY opened_at, position_id", (run_id,)
    ).fetchall()
    return [_record(Position, r) for r in rows]


def list_orders(conn: sqlite3.Connection, run_id: str) -> list[Order]:
    rows = conn.execute(
        "SELECT * FROM orders WHERE run_id = ? ORDER BY submitted_at, order_id", (run_id,)
    ).fetchall()
    return [_record(Order, r) for r in rows]


def list_closed_trades(conn: sqlite3.Connection, run_id: str) -> list[ClosedTrade]:
    rows = conn.execute(
        "SELECT * FROM closed_trades WHERE run_id = ? ORDER BY closed_at, closed_trade_id", (run_id,)
    ).fetchall()
    return [_record(ClosedTrade, r) for r in rows]


def list_run_events(conn: sqlite3.Connection, run_id: str) -> list[dict]:
    return [
        {
            "event_sequence": r["event_sequence"],
            "event_type": r["event_type"],
            "simulated_at": r["simulated_at"],
            "payload": json.loads(r["payload_json"]),
        }
        for r in conn.execute(
            "SELECT * FROM run_events WHERE run_id = ? ORDER BY event_sequence", (run_id,)
        )
    ]


@dataclass(frozen=True)
class Dashboard:
    run: Run
    account: Account
    snapshot: AccountSnapshot
    session_local_date: str
    positions: list[dict]          # display records (see _display_records): may be flagged untrusted
    orders: list[dict]
    closed_trades: list[dict]
    reconciliation: ReconciliationResult
    replay: Optional[dict] = None
    replay_events: list[dict] = field(default_factory=list)
    rejected_inputs: list[dict] = field(default_factory=list)
    market: dict = field(default_factory=dict)
    trading_activity: dict = field(default_factory=dict)
    proposals: list[dict] = field(default_factory=list)
    fills: list[dict] = field(default_factory=list)
    exit_intents: list[dict] = field(default_factory=list)
    runs: list[dict] = field(default_factory=list)


def get_dashboard(conn: sqlite3.Connection, init_key: str) -> Dashboard:
    run = get_run(conn, init_key)
    account = get_account(conn, run.run_id)
    return Dashboard(
        run=run,
        account=account,
        snapshot=compute_snapshot(conn, account.account_id),
        session_local_date=session_local_date(run),
        positions=display_positions(conn, run.run_id),
        orders=display_orders(conn, run.run_id),
        closed_trades=display_closed_trades(conn, run.run_id),
        reconciliation=reconcile(conn, run.run_id),
        replay=get_replay_state(conn, run.run_id),
        replay_events=list_replay_events(conn, run.run_id),
        rejected_inputs=list_rejected_inputs(conn, run.run_id),
        market=latest_market_state(conn, run.run_id),
        trading_activity=trading_activity_counts(conn, run.run_id),
        proposals=list_proposals(conn, run.run_id),
        fills=list_fills(conn, run.run_id),
        exit_intents=list_exit_intents(conn, run.run_id),
        runs=list_runs(conn),
    )


# --- Step 4: sample-data replay read models --------------------------------

FRESHNESS_LIMIT_SECONDS = 2  # SPEC.md Section 2 rule 9 / Section 3 quote validation


def get_replay_state(conn: sqlite3.Connection, run_id: str) -> Optional[dict]:
    row = conn.execute(
        """SELECT s.*, f.checksum, f.session_reference_cents, f.content_json
             FROM replay_state s JOIN fixtures f USING (fixture_id, fixture_version)
            WHERE s.run_id = ?""",
        (run_id,),
    ).fetchone()
    if row is None:
        return None
    content = json.loads(row["content_json"])
    processed = row["next_position"] - 1
    upcoming = content["events"][processed] if processed < row["total_events"] else None
    return {
        "fixture_id": row["fixture_id"],
        "fixture_version": row["fixture_version"],
        "fixture_checksum": row["checksum"],
        "data_label": content["data_label"],
        "session_reference_cents": row["session_reference_cents"],
        "status": row["status"],
        "processed_events": processed,
        "total_events": row["total_events"],
        "next_position": row["next_position"] if upcoming else None,
        "next_event": (
            {"event_type": upcoming["event_type"], "at": upcoming["at"], "ref": upcoming.get("ref")}
            if upcoming else None
        ),
        "loaded_at": row["loaded_at"],
        "updated_at": row["updated_at"],
    }


def list_replay_events(conn: sqlite3.Connection, run_id: str) -> list[dict]:
    rows = conn.execute(
        """SELECT e.*, r.reason_codes_json, q.source_sequence AS quote_source_sequence,
                  r.source_sequence AS rejected_source_sequence
             FROM replay_events e
             LEFT JOIN rejected_inputs r ON r.rejection_id = e.rejection_id
             LEFT JOIN market_quotes q ON q.quote_id = e.quote_id
            WHERE e.run_id = ? ORDER BY e.replay_position""",
        (run_id,),
    ).fetchall()
    return [
        {
            "replay_position": r["replay_position"],
            "event_sequence": r["event_sequence"],
            "event_type": r["event_type"],
            "fixture_ref": r["fixture_ref"],
            "scheduled_at": r["scheduled_at"],
            "outcome": r["outcome"],
            "source_sequence": r["quote_source_sequence"] if r["quote_id"] else r["rejected_source_sequence"],
            "quote_id": r["quote_id"],
            "rejection_id": r["rejection_id"],
            "reason_codes": json.loads(r["reason_codes_json"]) if r["reason_codes_json"] else [],
        }
        for r in rows
    ]


def list_quotes(conn: sqlite3.Connection, run_id: str) -> list[MarketQuote]:
    rows = conn.execute(
        "SELECT * FROM market_quotes WHERE run_id = ? ORDER BY event_sequence", (run_id,)
    ).fetchall()
    return [_record(MarketQuote, r, is_sample=bool(r["is_sample"])) for r in rows]


def list_rejected_inputs(conn: sqlite3.Connection, run_id: str) -> list[dict]:
    rows = conn.execute(
        "SELECT * FROM rejected_inputs WHERE run_id = ? ORDER BY replay_position", (run_id,)
    ).fetchall()
    return [
        {
            "rejection_id": r["rejection_id"],
            "replay_position": r["replay_position"],
            "event_sequence": r["event_sequence"],
            "received_at": r["received_at"],
            "source": r["source"],
            "source_sequence": r["source_sequence"],
            "contract_id": r["contract_id"],
            "reason_codes": json.loads(r["reason_codes_json"]),
            "raw_input": json.loads(r["raw_input_json"]),
        }
        for r in rows
    ]


def freshness(observed_at: str, simulated_clock: str) -> dict:
    """Quote age measured on the simulated clock, never the wall clock."""
    age = (parse_utc(simulated_clock) - parse_utc(observed_at)).total_seconds()
    return {
        "age_seconds": age,
        "freshness": "FRESH" if 0 <= age <= FRESHNESS_LIMIT_SECONDS else "STALE",
        "limit_seconds": FRESHNESS_LIMIT_SECONDS,
    }


def latest_market_state(conn: sqlite3.Connection, run_id: str) -> dict:
    """Latest ACCEPTED quote per contract, most recent first. Rejected inputs are never consulted."""
    clock = conn.execute("SELECT simulated_clock FROM runs WHERE run_id = ?", (run_id,)).fetchone()[0]
    rows = conn.execute(
        """SELECT q.* FROM market_quotes q
            WHERE q.run_id = ? AND q.event_sequence = (
                  SELECT MAX(event_sequence) FROM market_quotes
                   WHERE run_id = q.run_id AND contract_id = q.contract_id)
            ORDER BY q.event_sequence DESC""",
        (run_id,),
    ).fetchall()
    latest = []
    for r in rows:
        quote = _record(MarketQuote, r, is_sample=bool(r["is_sample"])).model_dump()
        latest.append({**quote, **freshness(r["observed_at"], clock)})
    return {"simulated_clock": clock, "latest_quotes": latest}


def trading_activity_counts(conn: sqlite3.Connection, run_id: str) -> dict:
    """Counts of trading/accounting records. All must stay zero in Step 4."""
    tables = ("trade_proposals", "risk_decisions", "orders", "fills", "positions", "closed_trades")
    counts = {t: conn.execute(f"SELECT COUNT(*) FROM {t} WHERE run_id = ?", (run_id,)).fetchone()[0] for t in tables}
    counts["non_funding_ledger_entries"] = conn.execute(
        "SELECT COUNT(*) FROM cash_ledger_entries WHERE run_id = ? AND entry_type <> 'INITIAL_FUNDING'", (run_id,)
    ).fetchone()[0]
    return counts



# --- Step 5: trading read models -------------------------------------------


def list_runs(conn: sqlite3.Connection) -> list[dict]:
    return [dict(r) for r in conn.execute(
        """SELECT run_id, init_key, status, trading_enabled, created_at, fixture_id, status_reason
             FROM runs ORDER BY created_at, run_id""")]


def list_proposals(conn: sqlite3.Connection, run_id: str) -> list[dict]:
    """Proposals with their risk decision and resulting order, in creation order."""
    rows = conn.execute(
        """SELECT p.*, d.risk_decision_id, d.decision, d.reason_codes_json, d.account_revision, d.required_cash_cents,
                  d.available_cash_cents, d.entry_risk_cents, d.entry_risk_limit_cents,
                  o.order_id, o.status AS order_status, o.terminal_reason, o.expires_at, o.after_source_sequence,
                  q.source_sequence AS quote_source_sequence
             FROM trade_proposals p
             LEFT JOIN risk_decisions d ON d.proposal_id = p.proposal_id
             LEFT JOIN orders o ON o.proposal_id = p.proposal_id
             LEFT JOIN market_quotes q ON q.quote_id = p.quote_id
            WHERE p.run_id = ? ORDER BY p.created_at, p.rowid""", (run_id,)
    ).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        d["risk_reason_codes"] = json.loads(d.pop("reason_codes_json")) if d.get("reason_codes_json") else []
        out.append(d)
    return out


def list_risk_decisions(conn: sqlite3.Connection, run_id: str) -> list[dict]:
    rows = conn.execute("SELECT * FROM risk_decisions WHERE run_id = ? ORDER BY evaluated_at, rowid",
                        (run_id,)).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        d["reason_codes"] = json.loads(d.pop("reason_codes_json"))
        out.append(d)
    return out


def list_fills(conn: sqlite3.Connection, run_id: str) -> list[dict]:
    return [dict(r) for r in conn.execute(
        """SELECT f.*, o.intent, q.source_sequence AS quote_source_sequence, l.net_cash_delta_cents,
                  l.balance_after_cents
             FROM fills f JOIN orders o USING (order_id) JOIN market_quotes q ON q.quote_id = f.quote_id
             JOIN cash_ledger_entries l ON l.fill_id = f.fill_id
            WHERE f.run_id = ? ORDER BY f.filled_at, f.rowid""", (run_id,))]


def list_exit_intents(conn: sqlite3.Connection, run_id: str) -> list[dict]:
    return [dict(r) for r in conn.execute(
        "SELECT * FROM exit_intents WHERE run_id = ? ORDER BY created_at, rowid", (run_id,))]


def list_ledger(conn: sqlite3.Connection, run_id: str) -> list[dict]:
    return [dict(r) for r in conn.execute(
        "SELECT * FROM cash_ledger_entries WHERE run_id = ? ORDER BY ledger_sequence", (run_id,))]
