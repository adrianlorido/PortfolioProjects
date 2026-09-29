"""Sample-data replay: fixture loading and replay commands (Step 4).

Commands: ``load_fixture``, ``step``, ``pause``, ``resume``, ``run_to_end``, and for
trading runs ``start_trading``, ``request_close``, ``cancel_order``.

- Serialized: every state change runs inside ``BEGIN IMMEDIATE``, which holds
  SQLite's single write lock, so commands from any thread or process apply
  one at a time.
- Idempotent: ``step``/``pause``/``resume``/``run_to_end`` take an idempotency
  key. The same key with the same payload returns the stored result without
  re-executing; the same key with a different payload is a conflict.
  ``load_fixture`` is idempotent by content: the same fixture is a no-op, and a
  different fixture for a run that already has one is refused.
- Atomic: one step commits the event's result (accepted quote or rejected
  input), its run event, its replay_events row, the simulated clock, the
  checkpoint, the replay cursor, and the command record together, or none of
  them.
- Deterministic: the clock moves only to each event's scheduled ``at``; wall
  clock time is used only for audit ``recorded_at``/``updated_at`` fields.

Replay never creates proposals, risk decisions, orders, fills, positions,
ledger entries, or closed trades, and never changes the account revision.
Exhausting the fixture is recorded as ``REPLAY_EXHAUSTED``; it does not mean a
trading workflow ran or completed, so the run status is left unchanged.
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
from dataclasses import dataclass
from functools import lru_cache
from typing import Callable, Optional

from paper_trading.app.coordinator import IdempotencyConflictError, new_id, utc_now
from paper_trading.app import trading
from paper_trading.app.events import append_run_event
from paper_trading.accounting.ledger import reconcile
from paper_trading.contracts.models import MarketQuote
from paper_trading.contracts.types import SCHEMA_VERSION, parse_utc
from paper_trading.market_data.fixtures import (
    FixtureDocument,
    FixtureValidationError,
    canonical_json,
    parse_fixture,
)
from paper_trading.market_data.intake import IntakeContext, validate_quote_input
from paper_trading.storage.db import transaction


class ReplayError(RuntimeError):
    code = "REPLAY_ERROR"


class FixtureConflictError(ReplayError):
    code = "FIXTURE_CONFLICT"


class ReplayNotLoadedError(ReplayError):
    code = "REPLAY_NOT_LOADED"


class ReplayPausedError(ReplayError):
    code = "REPLAY_PAUSED"


class ReplayExhaustedError(ReplayError):
    code = "REPLAY_EXHAUSTED"


@dataclass(frozen=True)
class LoadResult:
    fixture_id: str
    fixture_version: str
    checksum: str
    total_events: int
    created: bool


# --- helpers ---------------------------------------------------------------


@lru_cache(maxsize=16)
def _parse_stored(content_json: str) -> FixtureDocument:
    # Stored content is re-verified (checksum, structure, scope) before use.
    return parse_fixture(content_json)


def stored_fixture(conn: sqlite3.Connection, run_id: str) -> tuple[sqlite3.Row, FixtureDocument]:
    state = conn.execute("SELECT * FROM replay_state WHERE run_id = ?", (run_id,)).fetchone()
    if state is None:
        raise ReplayNotLoadedError("no fixture is loaded for this run; run: python -m paper_trading load-fixture")
    row = conn.execute(
        "SELECT content_json FROM fixtures WHERE fixture_id = ? AND fixture_version = ?",
        (state["fixture_id"], state["fixture_version"]),
    ).fetchone()
    return state, _parse_stored(row["content_json"])


def _payload_hash(command_type: str, run_id: str, payload: dict) -> str:
    body = canonical_json({"command_type": command_type, "run_id": run_id, "payload": payload})
    return hashlib.sha256(body.encode("utf-8")).hexdigest()


def _prior_result(conn: sqlite3.Connection, key: str, payload_hash: str) -> Optional[dict]:
    prior = conn.execute(
        "SELECT payload_hash, result_json FROM command_log WHERE idempotency_key = ?", (key,)
    ).fetchone()
    if prior is None:
        return None
    if prior["payload_hash"] != payload_hash:
        raise IdempotencyConflictError(
            f"idempotency key {key!r} was already used for a different command; use a new key"
        )
    return {**json.loads(prior["result_json"]), "idempotent_replay": True}


def _record(conn, key, command_type, run_id, payload_hash, result) -> dict:
    conn.execute(
        """INSERT INTO command_log (idempotency_key, run_id, command_type, payload_hash, result_json, recorded_at)
           VALUES (?,?,?,?,?,?)""",
        (key, run_id, command_type, payload_hash, json.dumps(result, sort_keys=True), utc_now()),
    )
    return {**result, "idempotent_replay": False}


def _check_key(key: str) -> str:
    if not isinstance(key, str) or not key.strip() or len(key) > 200:
        raise ValueError("idempotency_key must be a non-empty string of at most 200 characters")
    return key


def _command(conn: sqlite3.Connection, key: str, command_type: str, run_id: str,
             action: Callable[[], dict], payload: Optional[dict] = None) -> dict:
    """Run ``action`` and record its result under ``key`` in one transaction."""
    key = _check_key(key)
    h = _payload_hash(command_type, run_id, payload or {})
    with transaction(conn):
        prior = _prior_result(conn, key, h)
        if prior is not None:
            return prior
        return _record(conn, key, command_type, run_id, h, action())


# --- load ------------------------------------------------------------------


def load_fixture(conn: sqlite3.Connection, run_id: str, doc: FixtureDocument, content_json: str) -> LoadResult:
    """Validate the fixture against the run, store it, pin it, and open replay."""
    if parse_fixture(content_json).checksum != doc.checksum:
        raise FixtureValidationError("fixture content does not match the parsed document")

    with transaction(conn):
        run = conn.execute("SELECT * FROM runs WHERE run_id = ?", (run_id,)).fetchone()
        if run is None:
            raise ReplayNotLoadedError(f"unknown run {run_id}")
        result = LoadResult(doc.fixture_id, doc.fixture_version, doc.checksum, len(doc.events), False)

        if run["fixture_checksum"] is not None:
            if run["fixture_checksum"] == doc.checksum:
                return result  # same fixture again: no-op
            raise FixtureConflictError(
                f"run {run_id} is pinned to fixture {run['fixture_id']} {run['fixture_version']} "
                f"({run['fixture_checksum']}); a different fixture requires a new run "
                "(set PAPER_SAMPLE_RUN_KEY to a new value and run init-sample)"
            )

        mismatches = [
            name for name, run_value, fixture_value in (
                ("session_timezone", run["session_timezone"], doc.session.timezone),
                ("session_start", run["session_start"], doc.session.start),
                ("session_end", run["session_end"], doc.session.end),
            ) if run_value != fixture_value
        ]
        if mismatches:
            raise FixtureConflictError(
                f"fixture session does not match the run's pinned session ({', '.join(mismatches)}); "
                "create a run configured with the fixture's session"
            )
        watchlist = {r[0] for r in conn.execute("SELECT symbol FROM watchlist_items WHERE run_id = ?", (run_id,))}
        if doc.underlying not in watchlist:
            raise FixtureConflictError(f"fixture underlying {doc.underlying} is not on the run's watchlist")

        stored = conn.execute(
            "SELECT checksum FROM fixtures WHERE fixture_id = ? AND fixture_version = ?",
            (doc.fixture_id, doc.fixture_version),
        ).fetchone()
        if stored is not None and stored["checksum"] != doc.checksum:
            raise FixtureConflictError(
                f"fixture {doc.fixture_id} version {doc.fixture_version} is already stored with different "
                "content; publish the change as a new fixture_version"
            )
        now = utc_now()
        if stored is None:
            conn.execute(
                """INSERT INTO fixtures (fixture_id, fixture_version, checksum, fixture_schema_version, source,
                       is_sample, session_timezone, session_start, session_end, session_reference_cents,
                       event_count, content_json, stored_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (doc.fixture_id, doc.fixture_version, doc.checksum, doc.fixture_schema_version, doc.source, 1,
                 doc.session.timezone, doc.session.start, doc.session.end, doc.session_reference_cents,
                 len(doc.events), content_json, now),
            )

        for c in doc.contracts:
            existing = conn.execute(
                "SELECT * FROM option_contracts WHERE contract_id = ?", (c.contract_id,)
            ).fetchone()
            values = c.model_dump()
            if existing is not None:
                stored_values = {k: existing[k] for k in values}
                stored_values["adjusted"] = bool(stored_values["adjusted"])
                if stored_values != values:
                    raise FixtureConflictError(
                        f"contract {c.contract_id} already exists with different terms; contract IDs are immutable"
                    )
                continue
            try:
                conn.execute(
                    """INSERT INTO option_contracts (contract_id, schema_version, underlying, expiration_date,
                           option_type, strike_cents, currency, multiplier, deliverable, exercise_style,
                           settlement_type, adjusted) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
                    (c.contract_id, c.schema_version, c.underlying, c.expiration_date, c.option_type,
                     c.strike_cents, c.currency, c.multiplier, c.deliverable, c.exercise_style,
                     c.settlement_type, int(c.adjusted)),
                )
            except sqlite3.IntegrityError as exc:
                raise FixtureConflictError(
                    f"contract {c.contract_id} duplicates the economic identity of an existing contract"
                ) from exc

        conn.execute(
            """UPDATE runs SET fixture_id = ?, fixture_version = ?, fixture_checksum = ?,
                   session_reference_cents = ? WHERE run_id = ?""",
            (doc.fixture_id, doc.fixture_version, doc.checksum, doc.session_reference_cents, run_id),
        )
        conn.execute(
            """INSERT INTO replay_state (run_id, fixture_id, fixture_version, status, next_position,
                   total_events, loaded_at, updated_at) VALUES (?,?,?,?,?,?,?,?)""",
            (run_id, doc.fixture_id, doc.fixture_version, "ACTIVE", 1, len(doc.events), now, now),
        )
        append_run_event(conn, run_id, "FIXTURE_LOADED", run["simulated_clock"], {
            "fixture_id": doc.fixture_id,
            "fixture_version": doc.fixture_version,
            "checksum": doc.checksum,
            "total_events": len(doc.events),
            "session_reference_cents": doc.session_reference_cents,
        })
        return LoadResult(doc.fixture_id, doc.fixture_version, doc.checksum, len(doc.events), True)


# --- step ------------------------------------------------------------------


def _step_in_transaction(conn: sqlite3.Connection, run_id: str) -> dict:
    """Process the next fixture event. Caller holds the write transaction."""
    state, doc = stored_fixture(conn, run_id)
    if state["status"] == "EXHAUSTED":
        raise ReplayExhaustedError("replay has already reached the end of the fixture")
    if state["status"] == "PAUSED":
        raise ReplayPausedError("replay is paused; resume it before stepping")

    position = state["next_position"]
    event = doc.events[position - 1]
    run = conn.execute("SELECT * FROM runs WHERE run_id = ?", (run_id,)).fetchone()
    is_trading = bool(run["trading_enabled"])
    if is_trading and run["status"] != "RUNNING":
        if run["status"] == "PAUSED":
            raise ReplayPausedError(f"run is paused: {run['status_reason'] or 'resume it before stepping'}")
        raise trading.RunStateError(f"trading run is {run['status']}; start it before replaying")
    clock = event.at  # the clock advances to the scheduled time, never to an observation time
    if parse_utc(clock) < parse_utc(run["simulated_clock"]):
        raise ReplayError("fixture event is scheduled before the current simulated clock")
    if is_trading:
        trading.before_event(conn, run_id, clock)  # 1. expirations due at or before this event

    result = {
        "replay_position": position,
        "event_type": event.event_type,
        "fixture_ref": event.ref,
        "scheduled_at": event.at,
        "quote_id": None,
        "rejection_id": None,
        "reason_codes": [],
    }

    if event.event_type != "QUOTE":
        seq = append_run_event(conn, run_id, event.event_type, clock, {"replay_position": position})
        outcome = "BOUNDARY"
    else:
        raw = event.input
        source = doc.source
        accepted = frozenset(r[0] for r in conn.execute(
            "SELECT source_sequence FROM market_quotes WHERE run_id = ? AND source = ?", (run_id, source)
        ))
        ctx = IntakeContext(
            clock=parse_utc(clock),
            session_start=parse_utc(run["session_start"]),
            session_end=parse_utc(run["session_end"]),
            source=source,
            contract_ids=frozenset(c.contract_id for c in doc.contracts),
            session_reference_cents=run["session_reference_cents"],
            accepted_sequences=accepted,
        )
        verdict = validate_quote_input(raw, ctx)
        if verdict.accepted:
            quote = MarketQuote(
                schema_version=SCHEMA_VERSION,
                quote_id=new_id("quo"),
                run_id=run_id,
                received_at=clock,
                **verdict.fields,
            )
            seq = append_run_event(conn, run_id, "QUOTE_ACCEPTED", clock, {
                "replay_position": position, "quote_id": quote.quote_id, "contract_id": quote.contract_id,
                "source_sequence": quote.source_sequence,
            })
            conn.execute(
                """INSERT INTO market_quotes (quote_id, schema_version, run_id, event_sequence, contract_id, source,
                       is_sample, source_sequence, observed_at, received_at, bid_cents, ask_cents, bid_size,
                       ask_size, underlying_price_cents, underlying_observed_at, session_reference_cents)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (quote.quote_id, quote.schema_version, run_id, seq, quote.contract_id, quote.source, 1,
                 quote.source_sequence, quote.observed_at, quote.received_at, quote.bid_cents, quote.ask_cents,
                 quote.bid_size, quote.ask_size, quote.underlying_price_cents, quote.underlying_observed_at,
                 quote.session_reference_cents),
            )
            outcome = "ACCEPTED"
            result["quote_id"] = quote.quote_id
            if is_trading:
                # 3-6. open orders vs this quote, fills and accounting, strategy, risk, acceptance
                result["trading"] = trading.on_accepted_quote(conn, run_id, quote, clock)
        else:
            rejection_id = new_id("rej")
            reasons = list(verdict.reasons)
            seq = append_run_event(conn, run_id, "INPUT_REJECTED", clock, {
                "replay_position": position, "rejection_id": rejection_id, "reason_codes": reasons,
            })
            as_dict = raw if isinstance(raw, dict) else {}

            def text_or_none(v):
                return v if isinstance(v, str) else None

            seq_value = as_dict.get("source_sequence")
            conn.execute(
                """INSERT INTO rejected_inputs (rejection_id, run_id, event_sequence, replay_position, received_at,
                       source, source_sequence, contract_id, raw_input_json, reason_codes_json)
                   VALUES (?,?,?,?,?,?,?,?,?,?)""",
                (rejection_id, run_id, seq, position, clock, text_or_none(as_dict.get("source")),
                 seq_value if isinstance(seq_value, int) and not isinstance(seq_value, bool)
                 and -(2**63) <= seq_value < 2**63 else None,
                 text_or_none(as_dict.get("contract_id")), canonical_json(raw), json.dumps(reasons)),
            )
            outcome = "REJECTED"
            result["rejection_id"] = rejection_id
            result["reason_codes"] = reasons

    conn.execute(
        """INSERT INTO replay_events (run_id, replay_position, event_sequence, event_type, fixture_ref,
               scheduled_at, outcome, quote_id, rejection_id) VALUES (?,?,?,?,?,?,?,?,?)""",
        (run_id, position, seq, event.event_type, event.ref, event.at, outcome,
         result["quote_id"], result["rejection_id"]),
    )
    if is_trading:
        trading.after_event(conn, run_id, clock, event.event_type)
    exhausted = position == state["total_events"]
    conn.execute(
        "UPDATE replay_state SET next_position = ?, status = ?, updated_at = ? WHERE run_id = ?",
        (position + 1, "EXHAUSTED" if exhausted else "ACTIVE", utc_now(), run_id),
    )
    if exhausted:
        append_run_event(conn, run_id, "REPLAY_EXHAUSTED", clock, {
            "total_events": state["total_events"],
            "note": ("All fixture events were replayed; the trading outcome is recorded separately as "
                     "RUN_COMPLETED or RUN_INCOMPLETE." if is_trading else
                     "All fixture events were replayed. No trading workflow ran; this is not a completed trade."),
        })
        if is_trading:
            result["run_status"] = trading.on_exhausted(conn, run_id, clock)
    if is_trading:
        check = reconcile(conn, run_id)
        if not check.ok:  # rolls the whole event back; the caller then pauses the run
            raise trading.ReconciliationFailedError("; ".join(check.discrepancies))

    result.update(
        outcome=outcome,
        simulated_clock=clock,
        next_position=position + 1,
        total_events=state["total_events"],
        replay_status="EXHAUSTED" if exhausted else "ACTIVE",
    )
    return result


def _pre_step_reconcile(conn: sqlite3.Connection, run_id: str) -> None:
    """Trading runs reconcile before every event (so also on the first event after a restart)."""
    with transaction(conn):
        run = conn.execute("SELECT trading_enabled, status FROM runs WHERE run_id = ?", (run_id,)).fetchone()
        reason = None
        if run is not None and run["trading_enabled"] and run["status"] == "RUNNING":
            reason = trading.pause_if_unreconciled(conn, run_id)
    if reason:
        raise trading.ReconciliationFailedError(reason)


def _pause_after_failed_event(conn: sqlite3.Connection, run_id: str) -> None:
    with transaction(conn):
        trading.pause_if_unreconciled(conn, run_id)
        run = conn.execute("SELECT status FROM runs WHERE run_id = ?", (run_id,)).fetchone()
        if run["status"] == "RUNNING":  # books still fine: the event itself would have broken them
            conn.execute("UPDATE runs SET status = 'PAUSED', status_reason = ? WHERE run_id = ?",
                         ("Paused: an event would have left the books unreconciled and was rolled back.", run_id))
            conn.execute("UPDATE replay_state SET status = 'PAUSED' WHERE run_id = ? AND status = 'ACTIVE'", (run_id,))


def step(conn: sqlite3.Connection, run_id: str, idempotency_key: str) -> dict:
    _pre_step_reconcile(conn, run_id)
    try:
        return _command(conn, idempotency_key, "REPLAY_STEP", run_id, lambda: _step_in_transaction(conn, run_id))
    except trading.ReconciliationFailedError:
        _pause_after_failed_event(conn, run_id)
        raise


def _set_paused(conn: sqlite3.Connection, run_id: str, paused: bool) -> dict:
    state, _ = stored_fixture(conn, run_id)
    if state["status"] == "EXHAUSTED":
        raise ReplayExhaustedError("replay has already reached the end of the fixture")
    target = "PAUSED" if paused else "ACTIVE"
    run = conn.execute("SELECT * FROM runs WHERE run_id = ?", (run_id,)).fetchone()
    if run["trading_enabled"]:
        # Trading runs pause and resume the run itself; resuming requires reconciled books.
        if run["status"] not in ("RUNNING", "PAUSED"):
            raise trading.RunStateError(f"trading run is {run['status']}; start it first")
        run_target = "PAUSED" if paused else "RUNNING"
        if run["status"] != run_target:
            if not paused:
                check = reconcile(conn, run_id)
                if not check.ok:
                    raise trading.ReconciliationFailedError("cannot resume: " + "; ".join(check.discrepancies))
            conn.execute("UPDATE runs SET status = ?, status_reason = ? WHERE run_id = ?",
                         (run_target, "Paused by user." if paused else None, run_id))
    changed = state["status"] != target
    if changed:
        conn.execute(
            "UPDATE replay_state SET status = ?, updated_at = ? WHERE run_id = ?", (target, utc_now(), run_id)
        )
        clock = conn.execute("SELECT simulated_clock FROM runs WHERE run_id = ?", (run_id,)).fetchone()[0]
        append_run_event(conn, run_id, "REPLAY_PAUSED" if paused else "REPLAY_RESUMED", clock,
                          {"next_position": state["next_position"]})
    return {"replay_status": target, "changed": changed, "next_position": state["next_position"]}


def pause(conn: sqlite3.Connection, run_id: str, idempotency_key: str) -> dict:
    return _command(conn, idempotency_key, "REPLAY_PAUSE", run_id, lambda: _set_paused(conn, run_id, True))


def resume(conn: sqlite3.Connection, run_id: str, idempotency_key: str) -> dict:
    return _command(conn, idempotency_key, "REPLAY_RESUME", run_id, lambda: _set_paused(conn, run_id, False))


def run_to_end(conn: sqlite3.Connection, run_id: str, idempotency_key: str) -> dict:
    """Step until the fixture is exhausted or replay is paused.

    Each event commits in its own transaction, so an interruption keeps every
    completed event and a retry with the same key resumes from the checkpoint.
    The command's result is recorded once, after the loop finishes.
    """
    key = _check_key(idempotency_key)
    h = _payload_hash("REPLAY_RUN_TO_END", run_id, {})
    with transaction(conn):
        prior = _prior_result(conn, key, h)
        if prior is not None:
            return prior
        state, _ = stored_fixture(conn, run_id)
        if state["status"] == "EXHAUSTED":
            raise ReplayExhaustedError("replay has already reached the end of the fixture")
        if state["status"] == "PAUSED":
            raise ReplayPausedError("replay is paused; resume it before replaying to the end")

    steps = 0
    stopped = "EXHAUSTED"
    while True:
        _pre_step_reconcile(conn, run_id)
        try:
            with transaction(conn):
                state, _ = stored_fixture(conn, run_id)
                if state["status"] != "ACTIVE":
                    stopped = state["status"]
                    break
                _step_in_transaction(conn, run_id)
                steps += 1
        except trading.ReconciliationFailedError:
            _pause_after_failed_event(conn, run_id)
            raise

    with transaction(conn):
        prior = _prior_result(conn, key, h)
        if prior is not None:
            return prior
        final, _ = stored_fixture(conn, run_id)
        return _record(conn, key, "REPLAY_RUN_TO_END", run_id, h, {
            "steps_executed": steps,
            "stopped_because": stopped,
            "replay_status": final["status"],
            "next_position": final["next_position"],
            "total_events": final["total_events"],
        })


# --- trading-run commands (Step 5) -----------------------------------------


def start_trading(conn: sqlite3.Connection, run_id: str, idempotency_key: str) -> dict:
    """READY -> RUNNING for a trading run with a loaded fixture and reconciled books."""
    return _command(conn, idempotency_key, "TRADING_START", run_id, lambda: trading.start(conn, run_id))


def request_close(conn: sqlite3.Connection, run_id: str, idempotency_key: str) -> dict:
    return _command(conn, idempotency_key, "TRADING_REQUEST_CLOSE", run_id,
                    lambda: trading.request_close(conn, run_id))


def cancel_order(conn: sqlite3.Connection, run_id: str, order_id: str, idempotency_key: str) -> dict:
    return _command(conn, idempotency_key, "TRADING_CANCEL_ORDER", run_id,
                    lambda: trading.cancel_order(conn, run_id, order_id), payload={"order_id": order_id})
