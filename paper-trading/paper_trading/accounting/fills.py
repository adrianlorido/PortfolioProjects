"""Fill accounting and position valuation (SPEC.md Section 3 "Cash and positions").

``apply_fill`` runs inside the coordinator's transaction and commits, all
together: the fill, the order's FILLED transition and reservation release, the
ledger entry, the position change, the closed-trade record (for a close), the
exit-intent resolution, and one account-revision increment.

For quantity q, multiplier m, premium p (all integer cents):
  entry cash debit      = p*m*q + entry fee
  closing cash credit   = p*m*q - exit fee
  position cost basis   = entry premium total + entry fee
  realized P&L          = closing credit - cost basis
Marks use the latest valid bid: market value = bid*m*q, unrealized = market
value - cost basis (prospective exit fee excluded). A mark older than 2
simulated seconds is kept and labeled STALE, never replaced with zero.
"""

from __future__ import annotations

import sqlite3

from paper_trading.accounting.revision import bump_account_revision
from paper_trading.app.coordinator import new_id
from paper_trading.app.events import append_run_event
from paper_trading.contracts.models import CashLedgerEntry, ClosedTrade, Fill, MarketQuote, Position
from paper_trading.contracts.types import SCHEMA_VERSION, parse_utc

MARK_STALE_AFTER_SECONDS = 2


class DuplicateFillError(RuntimeError):
    code = "DUPLICATE_FILL"


def _ledger(conn, run_id, account_id, clock, entry_type, fill_id, premium, fee) -> CashLedgerEntry:
    last = conn.execute(
        """SELECT ledger_sequence, balance_after_cents FROM cash_ledger_entries WHERE account_id = ?
            ORDER BY ledger_sequence DESC LIMIT 1""", (account_id,)
    ).fetchone()
    entry = CashLedgerEntry(
        schema_version=SCHEMA_VERSION, ledger_entry_id=new_id("led"), run_id=run_id, account_id=account_id,
        ledger_sequence=last["ledger_sequence"] + 1, recorded_at=clock, entry_type=entry_type, fill_id=fill_id,
        premium_cash_delta_cents=premium, fee_cash_delta_cents=-fee, net_cash_delta_cents=premium - fee,
        balance_after_cents=last["balance_after_cents"] + premium - fee,
    )
    conn.execute(
        """INSERT INTO cash_ledger_entries (ledger_entry_id, schema_version, run_id, account_id, ledger_sequence,
               recorded_at, entry_type, fill_id, premium_cash_delta_cents, fee_cash_delta_cents,
               net_cash_delta_cents, balance_after_cents) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
        (entry.ledger_entry_id, entry.schema_version, run_id, account_id, entry.ledger_sequence, clock,
         entry_type, fill_id, entry.premium_cash_delta_cents, entry.fee_cash_delta_cents,
         entry.net_cash_delta_cents, entry.balance_after_cents),
    )
    return entry


def apply_fill(conn: sqlite3.Connection, run: sqlite3.Row, order: sqlite3.Row, quote: MarketQuote,
               price_cents: int, clock: str) -> Fill:
    if conn.execute("SELECT 1 FROM fills WHERE order_id = ?", (order["order_id"],)).fetchone():
        raise DuplicateFillError(f"order {order['order_id']} already has a fill")
    contract = conn.execute("SELECT * FROM option_contracts WHERE contract_id = ?",
                            (order["contract_id"],)).fetchone()
    qty, mult = order["quantity"], contract["multiplier"]
    fill = Fill(
        schema_version=SCHEMA_VERSION, fill_id=new_id("fil"), run_id=run["run_id"], order_id=order["order_id"],
        quote_id=quote.quote_id, filled_at=clock, quantity=qty, price_cents=price_cents, multiplier=mult,
        gross_cents=price_cents * mult * qty, fee_cents=run["fee_per_contract_cents"] * qty,
        execution_model_version=run["execution_model_version"], fee_schedule_version=run["fee_schedule_version"],
    )
    conn.execute(
        """INSERT INTO fills (fill_id, schema_version, run_id, order_id, quote_id, filled_at, quantity, price_cents,
               multiplier, gross_cents, fee_cents, execution_model_version, fee_schedule_version)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (fill.fill_id, fill.schema_version, fill.run_id, fill.order_id, fill.quote_id, fill.filled_at, qty,
         price_cents, mult, fill.gross_cents, fill.fee_cents, fill.execution_model_version,
         fill.fee_schedule_version),
    )
    conn.execute(
        """UPDATE orders SET status = 'FILLED', updated_at = ?, reserved_cash_cents = 0, reserved_contracts = 0
            WHERE order_id = ?""", (clock, order["order_id"]),
    )
    account_id = order["account_id"]

    if order["intent"] == "BUY_TO_OPEN":
        ledger = _ledger(conn, run["run_id"], account_id, clock, "BUY_FILL", fill.fill_id,
                         -fill.gross_cents, fill.fee_cents)
        basis = fill.gross_cents + fill.fee_cents
        market_value = quote.bid_cents * mult * qty
        pos = Position(
            schema_version=SCHEMA_VERSION, position_id=new_id("pos"), run_id=run["run_id"], account_id=account_id,
            contract_id=order["contract_id"], entry_fill_id=fill.fill_id, opened_at=clock, closed_at=None,
            status="OPEN", quantity=qty, reserved_contracts=0, entry_price_cents=price_cents,
            remaining_cost_basis_cents=basis, mark_quote_id=quote.quote_id, market_value_cents=market_value,
            unrealized_pnl_cents=market_value - basis, valuation_status="CURRENT",
        )
        conn.execute(
            """INSERT INTO positions (position_id, schema_version, run_id, account_id, contract_id, entry_fill_id,
                   opened_at, closed_at, status, quantity, reserved_contracts, entry_price_cents,
                   remaining_cost_basis_cents, mark_quote_id, market_value_cents, unrealized_pnl_cents,
                   valuation_status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (pos.position_id, pos.schema_version, pos.run_id, account_id, pos.contract_id, pos.entry_fill_id,
             clock, None, "OPEN", qty, 0, price_cents, basis, quote.quote_id, market_value,
             pos.unrealized_pnl_cents, "CURRENT"),
        )
        extra = {"position_id": pos.position_id, "cost_basis_cents": basis}
    else:
        pos = conn.execute("SELECT * FROM positions WHERE position_id = ?", (order["position_id"],)).fetchone()
        if pos["quantity"] != qty:
            raise RuntimeError("partial closes are not supported in the MVP")
        ledger = _ledger(conn, run["run_id"], account_id, clock, "SELL_FILL", fill.fill_id,
                         fill.gross_cents, fill.fee_cents)
        entry_fill = conn.execute("SELECT * FROM fills WHERE fill_id = ?", (pos["entry_fill_id"],)).fetchone()
        intent = conn.execute("SELECT * FROM exit_intents WHERE position_id = ?", (pos["position_id"],)).fetchone()
        proposal = conn.execute("SELECT reason_code FROM trade_proposals WHERE proposal_id = ?",
                                (order["proposal_id"],)).fetchone()
        entry_cost = pos["remaining_cost_basis_cents"]
        exit_net = fill.gross_cents - fill.fee_cents
        trade = ClosedTrade(
            schema_version=SCHEMA_VERSION, closed_trade_id=new_id("trd"), run_id=run["run_id"],
            position_id=pos["position_id"], entry_fill_id=pos["entry_fill_id"], exit_fill_id=fill.fill_id,
            strategy_id=run["strategy_id"], strategy_version=run["strategy_version"], opened_at=pos["opened_at"],
            closed_at=clock, quantity=qty, entry_cost_cents=entry_cost, exit_net_proceeds_cents=exit_net,
            total_fees_cents=entry_fill["fee_cents"] + fill.fee_cents, realized_pnl_cents=exit_net - entry_cost,
            # The originating exit intent names why the position closed; retries are visible on the proposals.
            exit_reason=intent["reason_code"] if intent else proposal["reason_code"],
        )
        conn.execute(
            """UPDATE positions SET status = 'CLOSED', closed_at = ?, quantity = 0, reserved_contracts = 0,
                   remaining_cost_basis_cents = 0, market_value_cents = 0, unrealized_pnl_cents = 0,
                   mark_quote_id = ?, valuation_status = 'CURRENT' WHERE position_id = ?""",
            (clock, quote.quote_id, pos["position_id"]),
        )
        conn.execute(
            """INSERT INTO closed_trades (closed_trade_id, schema_version, run_id, position_id, entry_fill_id,
                   exit_fill_id, strategy_id, strategy_version, opened_at, closed_at, quantity, entry_cost_cents,
                   exit_net_proceeds_cents, total_fees_cents, realized_pnl_cents, exit_reason)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (trade.closed_trade_id, SCHEMA_VERSION, run["run_id"], trade.position_id, trade.entry_fill_id,
             trade.exit_fill_id, trade.strategy_id, trade.strategy_version, trade.opened_at, clock, qty,
             entry_cost, exit_net, trade.total_fees_cents, trade.realized_pnl_cents, trade.exit_reason),
        )
        if intent is not None:
            conn.execute("UPDATE exit_intents SET resolved_at = ?, resolved_by_fill_id = ? WHERE position_id = ?",
                         (clock, fill.fill_id, pos["position_id"]))
        extra = {"position_id": pos["position_id"], "closed_trade_id": trade.closed_trade_id,
                 "realized_pnl_cents": trade.realized_pnl_cents}

    revision = bump_account_revision(conn, account_id)
    append_run_event(conn, run["run_id"], "ORDER_FILLED", clock, {
        "order_id": order["order_id"], "fill_id": fill.fill_id, "intent": order["intent"], "quote_id": quote.quote_id,
        "price_cents": price_cents, "gross_cents": fill.gross_cents, "fee_cents": fill.fee_cents,
        "net_cash_delta_cents": ledger.net_cash_delta_cents, "balance_after_cents": ledger.balance_after_cents,
        "account_revision": revision, **extra,
    })
    return fill


def mark_positions(conn: sqlite3.Connection, run_id: str, quote: MarketQuote) -> None:
    """Mark open positions in the quote's contract at its bid (valuation only)."""
    for p in conn.execute("SELECT * FROM positions WHERE run_id = ? AND status = 'OPEN' AND contract_id = ?",
                          (run_id, quote.contract_id)).fetchall():
        mult = conn.execute("SELECT multiplier FROM option_contracts WHERE contract_id = ?",
                            (p["contract_id"],)).fetchone()[0]
        value = quote.bid_cents * mult * p["quantity"]
        conn.execute(
            """UPDATE positions SET mark_quote_id = ?, market_value_cents = ?, unrealized_pnl_cents = ?,
                   valuation_status = 'CURRENT' WHERE position_id = ?""",
            (quote.quote_id, value, value - p["remaining_cost_basis_cents"], p["position_id"]),
        )


def refresh_staleness(conn: sqlite3.Connection, run_id: str, clock: str) -> None:
    """Label marks older than 2 simulated seconds STALE, keeping the last value."""
    now = parse_utc(clock)
    for p in conn.execute(
        """SELECT p.position_id, q.observed_at FROM positions p JOIN market_quotes q ON q.quote_id = p.mark_quote_id
            WHERE p.run_id = ? AND p.status = 'OPEN' AND p.valuation_status = 'CURRENT'""", (run_id,)
    ).fetchall():
        if (now - parse_utc(p["observed_at"])).total_seconds() > MARK_STALE_AFTER_SECONDS:
            conn.execute("UPDATE positions SET valuation_status = 'STALE' WHERE position_id = ?", (p["position_id"],))
