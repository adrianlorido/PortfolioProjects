"""Read models for the API and dashboard. Read-only: no function here writes."""

from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass
from zoneinfo import ZoneInfo

from paper_trading.accounting import compute_snapshot, reconcile
from paper_trading.accounting.ledger import ReconciliationResult
from paper_trading.contracts.models import (
    Account,
    AccountSnapshot,
    ClosedTrade,
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


def get_run(conn: sqlite3.Connection, init_key: str) -> Run:
    row = conn.execute("SELECT * FROM runs WHERE init_key = ?", (init_key,)).fetchone()
    if row is None:
        raise RunNotFoundError(
            f"no sample run for key '{init_key}'; run: python -m paper_trading init-sample"
        )
    watchlist = [r["symbol"] for r in conn.execute(
        "SELECT symbol FROM watchlist_items WHERE run_id = ? ORDER BY position", (row["run_id"],)
    )]
    return _record(Run, row, is_sample=bool(row["is_sample"]), watchlist=watchlist)


def get_account(conn: sqlite3.Connection, run_id: str) -> Account:
    row = conn.execute("SELECT * FROM accounts WHERE run_id = ?", (run_id,)).fetchone()
    if row is None:
        raise RunNotFoundError(f"run {run_id} has no account")
    return _record(Account, row)


def session_local_date(run: Run) -> str:
    """Session date in the exchange timezone (clarification 5: no fixed offsets)."""
    return parse_utc(run.session_start).astimezone(ZoneInfo(run.session_timezone)).date().isoformat()


def list_positions(conn: sqlite3.Connection, run_id: str) -> list[Position]:
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
    positions: list[Position]
    orders: list[Order]
    closed_trades: list[ClosedTrade]
    reconciliation: ReconciliationResult


def get_dashboard(conn: sqlite3.Connection, init_key: str) -> Dashboard:
    run = get_run(conn, init_key)
    account = get_account(conn, run.run_id)
    return Dashboard(
        run=run,
        account=account,
        snapshot=compute_snapshot(conn, account.account_id),
        session_local_date=session_local_date(run),
        positions=list_positions(conn, run.run_id),
        orders=list_orders(conn, run.run_id),
        closed_trades=list_closed_trades(conn, run.run_id),
        reconciliation=reconcile(conn, run.run_id),
    )
