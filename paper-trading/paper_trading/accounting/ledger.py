"""Cash truth, account snapshots, and reconciliation.

Cash is always the sum of immutable ledger deltas. Nothing else stores a cash
balance; snapshots are computed from the ledger, open-order reservations,
positions, and closed trades.
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass, field

from paper_trading.contracts.models import AccountSnapshot
from paper_trading.contracts.types import SCHEMA_VERSION

_VALUATION_RANK = {"CURRENT": 0, "STALE": 1, "UNAVAILABLE": 2}


def ledger_cash_cents(conn: sqlite3.Connection, account_id: str) -> int:
    row = conn.execute(
        "SELECT COALESCE(SUM(net_cash_delta_cents), 0) AS cash FROM cash_ledger_entries WHERE account_id = ?",
        (account_id,),
    ).fetchone()
    return int(row["cash"])


def compute_snapshot(conn: sqlite3.Connection, account_id: str) -> AccountSnapshot:
    acct = conn.execute(
        """SELECT a.*, r.simulated_clock FROM accounts a JOIN runs r USING (run_id)
            WHERE a.account_id = ?""",
        (account_id,),
    ).fetchone()
    if acct is None:
        raise LookupError(f"unknown account {account_id}")

    cash = ledger_cash_cents(conn, account_id)
    reserved = conn.execute(
        """SELECT COALESCE(SUM(reserved_cash_cents), 0) FROM orders
            WHERE account_id = ? AND status IN ('PENDING','OPEN')""",
        (account_id,),
    ).fetchone()[0]
    fees_paid = -conn.execute(
        "SELECT COALESCE(SUM(fee_cash_delta_cents), 0) FROM cash_ledger_entries WHERE account_id = ?",
        (account_id,),
    ).fetchone()[0]
    realized = conn.execute(
        """SELECT COALESCE(SUM(ct.realized_pnl_cents), 0) FROM closed_trades ct
             JOIN positions p ON p.position_id = ct.position_id
            WHERE p.account_id = ?""",
        (account_id,),
    ).fetchone()[0]

    open_positions = conn.execute(
        """SELECT market_value_cents, unrealized_pnl_cents, valuation_status
             FROM positions WHERE account_id = ? AND status = 'OPEN'""",
        (account_id,),
    ).fetchall()
    valuation = "CURRENT"
    for p in open_positions:
        if _VALUATION_RANK[p["valuation_status"]] > _VALUATION_RANK[valuation]:
            valuation = p["valuation_status"]

    if valuation == "UNAVAILABLE":
        # Never substitute zero for an unknown mark (SPEC.md Section 3).
        market_value = equity = unrealized = None
    else:
        market_value = sum(p["market_value_cents"] for p in open_positions)
        unrealized = sum(p["unrealized_pnl_cents"] for p in open_positions)
        equity = cash + market_value

    return AccountSnapshot(
        schema_version=SCHEMA_VERSION,
        snapshot_id=f"{account_id}:r{acct['account_revision']}",
        run_id=acct["run_id"],
        account_id=account_id,
        account_revision=acct["account_revision"],
        as_of=acct["simulated_clock"],
        currency=acct["currency"],
        starting_cash_cents=acct["starting_cash_cents"],
        cash_cents=cash,
        reserved_cash_cents=reserved,
        available_cash_cents=cash - reserved,
        market_value_cents=market_value,
        equity_cents=equity,
        realized_pnl_cents=realized,
        unrealized_pnl_cents=unrealized,
        fees_paid_cents=fees_paid,
        valuation_status=valuation,
    )


@dataclass
class ReconciliationResult:
    run_id: str
    ok: bool
    cash_cents: int | None = None
    discrepancies: list[str] = field(default_factory=list)


def reconcile(conn: sqlite3.Connection, run_id: str) -> ReconciliationResult:
    """Check that cash, ledger chain, fills, and equity agree. Read-only."""
    problems: list[str] = []
    run = conn.execute("SELECT * FROM runs WHERE run_id = ?", (run_id,)).fetchone()
    if run is None:
        return ReconciliationResult(run_id, False, None, [f"unknown run {run_id}"])
    acct = conn.execute("SELECT * FROM accounts WHERE run_id = ?", (run_id,)).fetchone()
    if acct is None:
        return ReconciliationResult(run_id, False, None, ["run has no account"])
    account_id = acct["account_id"]

    if acct["starting_cash_cents"] != run["starting_cash_cents"]:
        problems.append("account starting cash differs from the run's pinned starting cash")

    entries = conn.execute(
        "SELECT * FROM cash_ledger_entries WHERE account_id = ? ORDER BY ledger_sequence", (account_id,)
    ).fetchall()
    fundings = [e for e in entries if e["entry_type"] == "INITIAL_FUNDING"]
    if len(fundings) != 1:
        problems.append(f"expected exactly one INITIAL_FUNDING entry, found {len(fundings)}")
    elif fundings[0]["net_cash_delta_cents"] != run["starting_cash_cents"]:
        problems.append("initial funding does not equal starting cash")
    elif fundings[0]["ledger_sequence"] != 1:
        problems.append("initial funding is not the first ledger entry")

    running = 0
    for expected_seq, e in enumerate(entries, start=1):
        if e["ledger_sequence"] != expected_seq:
            problems.append(f"ledger sequence gap: expected {expected_seq}, found {e['ledger_sequence']}")
        if e["run_id"] != run_id:
            problems.append(f"ledger entry {e['ledger_entry_id']} belongs to a different run")
        running += e["net_cash_delta_cents"]
        if e["balance_after_cents"] != running:
            problems.append(
                f"ledger entry {e['ledger_sequence']} balance_after {e['balance_after_cents']} != running sum {running}"
            )

    cash = ledger_cash_cents(conn, account_id)
    if entries and entries[-1]["balance_after_cents"] != cash:
        problems.append("last ledger balance does not equal the sum of ledger deltas")

    # Every fill has exactly one matching ledger entry.
    for f in conn.execute(
        """SELECT f.*, o.intent, l.premium_cash_delta_cents, l.fee_cash_delta_cents, l.entry_type
             FROM fills f JOIN orders o USING (order_id)
             LEFT JOIN cash_ledger_entries l ON l.fill_id = f.fill_id
            WHERE f.run_id = ?""",
        (run_id,),
    ):
        if f["entry_type"] is None:
            problems.append(f"fill {f['fill_id']} has no ledger entry")
            continue
        sign = -1 if f["intent"] == "BUY_TO_OPEN" else 1
        if f["premium_cash_delta_cents"] != sign * f["gross_cents"] or f["fee_cash_delta_cents"] != -f["fee_cents"]:
            problems.append(f"fill {f['fill_id']} does not match its ledger entry")

    snap = compute_snapshot(conn, account_id)
    if snap.available_cash_cents < 0:
        problems.append("reserved cash exceeds cash")
    if snap.equity_cents is not None:
        expected = snap.starting_cash_cents + snap.realized_pnl_cents + snap.unrealized_pnl_cents
        if snap.equity_cents != expected:
            problems.append(
                f"equity {snap.equity_cents} != starting cash + realized + unrealized ({expected})"
            )

    return ReconciliationResult(run_id, not problems, cash, problems)
