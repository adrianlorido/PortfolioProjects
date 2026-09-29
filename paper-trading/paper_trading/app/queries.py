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


def _page(limit: Optional[int], offset: int) -> tuple[str, tuple]:
    """SQL LIMIT/OFFSET clause. ``limit=None`` means every row (Python callers); the API always bounds it."""
    if limit is None:
        return (" LIMIT -1 OFFSET ?", (offset,)) if offset else ("", ())
    return " LIMIT ? OFFSET ?", (limit, offset)


def count_rows(conn: sqlite3.Connection, table: str, run_id: str) -> int:
    """Row count for one run (tables listed in PAGED_TABLES).

    replay_events and run_events are numbered 1..N without gaps (enforced by the
    replay cursor trigger and by ``append_run_event``), so their counts are read
    from the run's cursor and checkpoint in O(1) instead of counting rows.
    """
    if table not in PAGED_TABLES:
        raise ValueError(f"not a paged table: {table}")
    if table == "replay_events":
        row = conn.execute("SELECT next_position - 1 FROM replay_state WHERE run_id = ?", (run_id,)).fetchone()
        return 0 if row is None else row[0]
    if table == "run_events":
        row = conn.execute("SELECT checkpoint_event_sequence FROM runs WHERE run_id = ?", (run_id,)).fetchone()
        return 0 if row is None else row[0]
    return conn.execute(f"SELECT COUNT(*) FROM {table} WHERE run_id = ?", (run_id,)).fetchone()[0]


def _keyset(column: str, limit: Optional[int], offset: int) -> tuple[str, tuple]:
    """Page a gap-free 1..N column by key range: O(limit) however deep the page is."""
    clause, args = f" AND {column} > ?", (offset,)
    if limit is not None:
        clause += f" AND {column} <= ?"
        args += (offset + limit,)
    return clause, args


PAGED_TABLES = frozenset({"replay_events", "market_quotes", "rejected_inputs", "trade_proposals", "risk_decisions",
                          "orders", "fills", "cash_ledger_entries", "run_events", "positions", "closed_trades"})


def _rows(conn, table: str, run_id: str, order_by: str, limit: Optional[int] = None,
          offset: int = 0) -> list[sqlite3.Row]:
    clause, args = _page(limit, offset)
    return conn.execute(f"SELECT * FROM {table} WHERE run_id = ? ORDER BY {order_by}{clause}",
                        (run_id, *args)).fetchall()


def display_positions(conn: sqlite3.Connection, run_id: str, limit: Optional[int] = None,
                      offset: int = 0) -> list[dict]:
    return _display_records(Position, _rows(conn, "positions", run_id, "opened_at, position_id", limit, offset))


def display_orders(conn: sqlite3.Connection, run_id: str, limit: Optional[int] = None, offset: int = 0) -> list[dict]:
    return _display_records(Order, _rows(conn, "orders", run_id, "submitted_at, order_id", limit, offset))


def display_closed_trades(conn: sqlite3.Connection, run_id: str, limit: Optional[int] = None,
                          offset: int = 0) -> list[dict]:
    return _display_records(ClosedTrade,
                            _rows(conn, "closed_trades", run_id, "closed_at, closed_trade_id", limit, offset))


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


def list_run_events(conn: sqlite3.Connection, run_id: str, limit: Optional[int] = None, offset: int = 0) -> list[dict]:
    clause, args = _keyset("event_sequence", limit, offset)
    return [
        {
            "event_sequence": r["event_sequence"],
            "event_type": r["event_type"],
            "simulated_at": r["simulated_at"],
            "payload": json.loads(r["payload_json"]),
        }
        for r in conn.execute(
            f"SELECT * FROM run_events WHERE run_id = ?{clause} ORDER BY event_sequence", (run_id, *args))
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
    # Bounded lists (FA-1a): each shows at most DASHBOARD_PAGE of the latest rows;
    # pages[name] = {"total", "offset", "shown"}. Full lists are paged via the API.
    pages: dict = field(default_factory=dict)


DASHBOARD_PAGE = 50
RUN_SWITCHER_LIMIT = 50


def _latest_page(conn, table: str, run_id: str) -> dict:
    total = count_rows(conn, table, run_id)
    offset = max(0, total - DASHBOARD_PAGE)
    return {"total": total, "offset": offset, "shown": total - offset}


def get_dashboard(conn: sqlite3.Connection, init_key: str) -> Dashboard:
    run = get_run(conn, init_key)
    account = get_account(conn, run.run_id)
    rid = run.run_id
    pages = {name: _latest_page(conn, table, rid) for name, table in (
        ("replay_events", "replay_events"), ("rejected_inputs", "rejected_inputs"),
        ("proposals", "trade_proposals"), ("fills", "fills"), ("orders", "orders"),
        ("positions", "positions"), ("closed_trades", "closed_trades"))}

    def page(name):
        return {"limit": DASHBOARD_PAGE, "offset": pages[name]["offset"]}

    return Dashboard(
        run=run,
        account=account,
        snapshot=compute_snapshot(conn, account.account_id),
        session_local_date=session_local_date(run),
        positions=display_positions(conn, rid, **page("positions")),
        orders=display_orders(conn, rid, **page("orders")),
        closed_trades=display_closed_trades(conn, rid, **page("closed_trades")),
        reconciliation=reconcile(conn, rid),
        replay=get_replay_state(conn, rid),
        replay_events=list_replay_events(conn, rid, **page("replay_events")),
        rejected_inputs=list_rejected_inputs(conn, rid, **page("rejected_inputs")),
        market=latest_market_state(conn, rid),
        trading_activity=trading_activity_counts(conn, rid),
        proposals=list_proposals(conn, rid, **page("proposals")),
        fills=list_fills(conn, rid, **page("fills")),
        exit_intents=list_exit_intents(conn, rid),
        runs=list_runs(conn, limit=RUN_SWITCHER_LIMIT),
        pages=pages,
    )


# --- Step 4: sample-data replay read models --------------------------------

FRESHNESS_LIMIT_SECONDS = 2  # SPEC.md Section 2 rule 9 / Section 3 quote validation


def get_replay_state(conn: sqlite3.Connection, run_id: str) -> Optional[dict]:
    """Replay progress and dataset provenance. Constant cost: primary-key reads only."""
    row = conn.execute(
        """SELECT s.*, d.checksum, d.session_reference_cents, d.data_class, d.source, d.label, d.calendar_id,
                  d.checksum_scheme, m.manifest_json
             FROM replay_state s
             JOIN datasets d ON d.dataset_id = s.fixture_id AND d.dataset_version = s.fixture_version
             JOIN dataset_manifests m ON m.manifest_checksum = d.manifest_checksum
            WHERE s.run_id = ?""",
        (run_id,),
    ).fetchone()
    if row is None:
        return None
    processed = row["next_position"] - 1
    upcoming = None
    if processed < row["total_events"]:
        upcoming = conn.execute(
            """SELECT event_type, at, ref FROM dataset_events
                WHERE dataset_id = ? AND dataset_version = ? AND position = ?""",
            (row["fixture_id"], row["fixture_version"], row["next_position"]),
        ).fetchone()
    manifest = json.loads(row["manifest_json"])
    return {
        "fixture_id": row["fixture_id"],
        "fixture_version": row["fixture_version"],
        "fixture_checksum": row["checksum"],
        "data_label": row["label"],
        "data_class": row["data_class"],
        "source": row["source"],
        "calendar_id": row["calendar_id"],
        "checksum_scheme": row["checksum_scheme"],
        "provenance": _provenance_summary(manifest),
        "session_reference_cents": row["session_reference_cents"],
        "status": row["status"],
        "processed_events": processed,
        "total_events": row["total_events"],
        "next_position": row["next_position"] if upcoming else None,
        "next_event": (
            {"event_type": upcoming["event_type"], "at": upcoming["at"], "ref": upcoming["ref"]}
            if upcoming else None
        ),
        "loaded_at": row["loaded_at"],
        "updated_at": row["updated_at"],
    }


def _provenance_summary(manifest: dict) -> dict:
    """What the dashboard shows about where the data came from; never invents fields."""
    if manifest.get("data_class") == "SYNTHETIC":
        return {"kind": "SYNTHETIC", "generator": manifest.get("generator"),
                "description": manifest.get("description")}
    return {"kind": "HISTORICAL", "importer": manifest.get("importer"), "vendor": manifest.get("vendor"),
            "vendor_dataset": manifest.get("vendor_dataset"), "retrieved_at": manifest.get("retrieved_at"),
            "license_reference": manifest.get("license_reference"), "description": manifest.get("description")}


def list_replay_events(conn: sqlite3.Connection, run_id: str, limit: Optional[int] = None,
                       offset: int = 0) -> list[dict]:
    clause, args = _keyset("e.replay_position", limit, offset)
    rows = conn.execute(
        """SELECT e.*, r.reason_codes_json, q.source_sequence AS quote_source_sequence,
                  r.source_sequence AS rejected_source_sequence
             FROM replay_events e
             LEFT JOIN rejected_inputs r ON r.rejection_id = e.rejection_id
             LEFT JOIN market_quotes q ON q.quote_id = e.quote_id
            WHERE e.run_id = ?""" + clause + " ORDER BY e.replay_position",
        (run_id, *args),
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


_QUOTE_SELECT = """SELECT q.*, p.snapshot_at, p.ingested_at FROM market_quotes q
                   LEFT JOIN quote_provenance p ON p.quote_id = q.quote_id"""


def list_quotes(conn: sqlite3.Connection, run_id: str, limit: Optional[int] = None,
                offset: int = 0) -> list[MarketQuote]:
    clause, args = _page(limit, offset)
    rows = conn.execute(
        f"{_QUOTE_SELECT} WHERE q.run_id = ? ORDER BY q.event_sequence{clause}", (run_id, *args)
    ).fetchall()
    return [_record(MarketQuote, r, is_sample=bool(r["is_sample"])) for r in rows]


def list_rejected_inputs(conn: sqlite3.Connection, run_id: str, limit: Optional[int] = None,
                         offset: int = 0) -> list[dict]:
    rows = _rows(conn, "rejected_inputs", run_id, "replay_position", limit, offset)
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


def _dataset_contract_ids(conn: sqlite3.Connection, run_id: str) -> list[str]:
    row = conn.execute(
        """SELECT d.contracts_json FROM replay_state s
             JOIN datasets d ON d.dataset_id = s.fixture_id AND d.dataset_version = s.fixture_version
            WHERE s.run_id = ?""", (run_id,)).fetchone()
    return [] if row is None else [c["contract_id"] for c in json.loads(row["contracts_json"])]


def latest_market_state(conn: sqlite3.Connection, run_id: str) -> dict:
    """Latest ACCEPTED quote per contract, most recent first. Rejected inputs are never consulted.

    One indexed probe per dataset contract (quotes exist only for dataset contracts),
    so the cost does not grow with the number of quotes replayed.
    """
    clock = conn.execute("SELECT simulated_clock FROM runs WHERE run_id = ?", (run_id,)).fetchone()[0]
    rows = []
    for contract_id in _dataset_contract_ids(conn, run_id):
        r = conn.execute(
            f"""{_QUOTE_SELECT} WHERE q.run_id = ? AND q.contract_id = ?
                ORDER BY q.event_sequence DESC LIMIT 1""", (run_id, contract_id)).fetchone()
        if r is not None:
            rows.append(r)
    rows.sort(key=lambda r: r["event_sequence"], reverse=True)
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


def list_runs(conn: sqlite3.Connection, limit: Optional[int] = None) -> list[dict]:
    """Runs in creation order; with ``limit``, the most recent ``limit`` runs (still in creation order)."""
    clause, args = ("", ()) if limit is None else (" LIMIT ?", (limit,))
    rows = conn.execute(
        """SELECT run_id, init_key, status, trading_enabled, created_at, fixture_id, status_reason, mode
             FROM runs ORDER BY created_at DESC, run_id DESC""" + clause, args).fetchall()
    return [dict(r) for r in reversed(rows)]


def list_proposals(conn: sqlite3.Connection, run_id: str, limit: Optional[int] = None,
                   offset: int = 0) -> list[dict]:
    """Proposals with their risk decision and resulting order, in creation order."""
    clause, args = _page(limit, offset)
    rows = conn.execute(
        """SELECT p.*, d.risk_decision_id, d.decision, d.reason_codes_json, d.account_revision, d.required_cash_cents,
                  d.available_cash_cents, d.entry_risk_cents, d.entry_risk_limit_cents,
                  o.order_id, o.status AS order_status, o.terminal_reason, o.expires_at, o.after_source_sequence,
                  q.source_sequence AS quote_source_sequence
             FROM trade_proposals p
             LEFT JOIN risk_decisions d ON d.proposal_id = p.proposal_id
             LEFT JOIN orders o ON o.proposal_id = p.proposal_id
             LEFT JOIN market_quotes q ON q.quote_id = p.quote_id
            WHERE p.run_id = ? ORDER BY p.created_at, p.rowid""" + clause, (run_id, *args)
    ).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        d["risk_reason_codes"] = json.loads(d.pop("reason_codes_json")) if d.get("reason_codes_json") else []
        out.append(d)
    return out


def list_risk_decisions(conn: sqlite3.Connection, run_id: str, limit: Optional[int] = None,
                        offset: int = 0) -> list[dict]:
    rows = _rows(conn, "risk_decisions", run_id, "evaluated_at, rowid", limit, offset)
    out = []
    for r in rows:
        d = dict(r)
        d["reason_codes"] = json.loads(d.pop("reason_codes_json"))
        out.append(d)
    return out


def list_fills(conn: sqlite3.Connection, run_id: str, limit: Optional[int] = None, offset: int = 0) -> list[dict]:
    clause, args = _page(limit, offset)
    return [dict(r) for r in conn.execute(
        """SELECT f.*, o.intent, q.source_sequence AS quote_source_sequence, l.net_cash_delta_cents,
                  l.balance_after_cents
             FROM fills f JOIN orders o USING (order_id) JOIN market_quotes q ON q.quote_id = f.quote_id
             JOIN cash_ledger_entries l ON l.fill_id = f.fill_id
            WHERE f.run_id = ? ORDER BY f.filled_at, f.rowid""" + clause, (run_id, *args))]


def list_exit_intents(conn: sqlite3.Connection, run_id: str) -> list[dict]:
    return [dict(r) for r in conn.execute(
        "SELECT * FROM exit_intents WHERE run_id = ? ORDER BY created_at, rowid", (run_id,))]


def list_ledger(conn: sqlite3.Connection, run_id: str, limit: Optional[int] = None, offset: int = 0) -> list[dict]:
    return [dict(r) for r in _rows(conn, "cash_ledger_entries", run_id, "ledger_sequence", limit, offset)]
