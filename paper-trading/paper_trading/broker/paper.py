"""Paper broker, execution model ``next_quote_touch_v1`` (SPEC.md Section 3).

All functions run inside the caller's write transaction.

Acceptance (``submit``), per clarification 6. The order is inserted PENDING,
then in the same transaction:
  - the risk decision's account_revision must equal the account's current
    revision, else REJECTED STALE_ACCOUNT_REVISION;
  - buys: one position or pending entry, and available cash >= limit x
    multiplier x qty + fee, else REJECTED POSITION_LIMIT / INSUFFICIENT_CASH;
  - sells: the open position's unreserved contracts >= qty, else REJECTED
    INSUFFICIENT_POSITION;
  - otherwise OPEN with its reservation (cash for buys, contracts for sells)
    and the account revision incremented.

Eligibility (``fill_price``): only an ACCEPTED quote (intake already refused
stale, future, crossed, duplicate, out-of-order, and missing-size inputs) for
the order's contract, strictly after the quote that generated the order, not
observed before submission, fresh on the simulated clock, with enough
unconsumed displayed size for the whole order. Buy fills at the ask when
ask <= limit; sell fills at the bid when bid >= limit. No midpoint, no
improvement, no partial fills. The database enforces the same rules on
every fill insert.

TTL: every order expires 60 simulated seconds after submission. Expirations
due at or before an event's time are processed before that event's quote, so
a quote at exactly ``expires_at`` cannot fill and a later quote cannot revive
an expired order.
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Optional

from paper_trading.accounting.ledger import compute_snapshot
from paper_trading.accounting.revision import bump_account_revision
from paper_trading.app.coordinator import IdempotencyConflictError, new_id
from paper_trading.app.events import append_run_event
from paper_trading.contracts.models import MarketQuote, Order
from paper_trading.contracts.types import SCHEMA_VERSION, format_utc, parse_utc
from paper_trading.risk.policy import entry_cost_cents
from paper_trading.strategy.sample_spy_long_call import is_fresh

ORDER_TTL_SECONDS = 60
TERMINAL = ("FILLED", "REJECTED", "CANCELED", "EXPIRED")


class OrderNotFoundError(LookupError):
    code = "ORDER_NOT_FOUND"


class OrderNotOpenError(RuntimeError):
    code = "ORDER_NOT_OPEN"


@dataclass(frozen=True)
class SubmitResult:
    order_id: str
    status: str
    terminal_reason: Optional[str]
    created: bool


def _order_row(conn, order_id):
    return conn.execute("SELECT * FROM orders WHERE order_id = ?", (order_id,)).fetchone()


def submit(conn: sqlite3.Connection, run: sqlite3.Row, proposal: sqlite3.Row, decision: sqlite3.Row,
           clock: str, generating_source_sequence: int) -> SubmitResult:
    """Create the order for an APPROVED decision and accept or reject it atomically."""
    key = f"{run['run_id']}:order:{proposal['proposal_id']}"
    existing = conn.execute("SELECT * FROM orders WHERE idempotency_key = ?", (key,)).fetchone()
    if existing is not None:
        if existing["proposal_id"] != proposal["proposal_id"]:
            raise IdempotencyConflictError(f"order key {key!r} belongs to a different proposal")
        return SubmitResult(existing["order_id"], existing["status"], existing["terminal_reason"], False)
    if decision["decision"] != "APPROVED":
        raise ValueError("only approved proposals can be submitted")

    account = conn.execute("SELECT * FROM accounts WHERE run_id = ?", (run["run_id"],)).fetchone()
    contract = conn.execute("SELECT * FROM option_contracts WHERE contract_id = ?",
                            (proposal["contract_id"],)).fetchone()
    expires = format_utc(parse_utc(clock) + timedelta(seconds=ORDER_TTL_SECONDS))
    order = Order(
        schema_version=SCHEMA_VERSION, order_id=new_id("ord"), run_id=run["run_id"],
        account_id=account["account_id"], proposal_id=proposal["proposal_id"],
        risk_decision_id=decision["risk_decision_id"], contract_id=proposal["contract_id"],
        position_id=proposal["position_id"], intent=proposal["intent"], quantity=proposal["quantity"],
        limit_cents=proposal["limit_cents"], status="PENDING", submitted_at=clock, updated_at=clock,
        expires_at=expires, after_source_sequence=generating_source_sequence, reserved_cash_cents=0,
        reserved_contracts=0, idempotency_key=key, terminal_reason=None,
    )
    conn.execute(
        """INSERT INTO orders (order_id, schema_version, run_id, account_id, proposal_id, risk_decision_id,
               contract_id, position_id, intent, quantity, limit_cents, status, submitted_at, updated_at,
               expires_at, after_source_sequence, reserved_cash_cents, reserved_contracts, idempotency_key,
               terminal_reason) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (order.order_id, order.schema_version, order.run_id, order.account_id, order.proposal_id,
         order.risk_decision_id, order.contract_id, order.position_id, order.intent, order.quantity,
         order.limit_cents, order.status, order.submitted_at, order.updated_at, order.expires_at,
         order.after_source_sequence, 0, 0, order.idempotency_key, None),
    )

    # Atomic revalidation against the state as of now, not as of the decision.
    reject = None
    reserved_cash = reserved_contracts = 0
    if decision["account_revision"] != account["account_revision"]:
        reject = "STALE_ACCOUNT_REVISION"
    elif order.intent == "BUY_TO_OPEN":
        busy = conn.execute(
            """SELECT (SELECT COUNT(*) FROM positions WHERE run_id = ? AND status = 'OPEN')
                    + (SELECT COUNT(*) FROM orders WHERE run_id = ? AND intent = 'BUY_TO_OPEN'
                          AND status IN ('PENDING','OPEN') AND order_id <> ?)""",
            (run["run_id"], run["run_id"], order.order_id),
        ).fetchone()[0]
        reserved_cash = entry_cost_cents(order.limit_cents, contract["multiplier"], order.quantity,
                                         run["fee_per_contract_cents"])
        if busy:
            reject = "POSITION_LIMIT"
        elif reserved_cash > compute_snapshot(conn, account["account_id"]).available_cash_cents:
            reject = "INSUFFICIENT_CASH"
    else:
        pos = conn.execute("SELECT * FROM positions WHERE position_id = ?", (order.position_id,)).fetchone()
        if pos is None or pos["status"] != "OPEN" or pos["quantity"] - pos["reserved_contracts"] < order.quantity:
            reject = "INSUFFICIENT_POSITION"
        reserved_contracts = order.quantity

    if reject:
        conn.execute(
            "UPDATE orders SET status = 'REJECTED', terminal_reason = ?, updated_at = ? WHERE order_id = ?",
            (reject, clock, order.order_id),
        )
        append_run_event(conn, run["run_id"], "ORDER_REJECTED", clock,
                         {"order_id": order.order_id, "proposal_id": order.proposal_id, "reason": reject})
        return SubmitResult(order.order_id, "REJECTED", reject, True)

    conn.execute(
        """UPDATE orders SET status = 'OPEN', reserved_cash_cents = ?, reserved_contracts = ?, updated_at = ?
            WHERE order_id = ?""",
        (reserved_cash if order.intent == "BUY_TO_OPEN" else 0,
         reserved_contracts if order.intent == "SELL_TO_CLOSE" else 0, clock, order.order_id),
    )
    if order.intent == "SELL_TO_CLOSE":
        conn.execute("UPDATE positions SET reserved_contracts = reserved_contracts + ? WHERE position_id = ?",
                     (reserved_contracts, order.position_id))
    revision = bump_account_revision(conn, account["account_id"])
    append_run_event(conn, run["run_id"], "ORDER_ACCEPTED", clock, {
        "order_id": order.order_id, "intent": order.intent, "limit_cents": order.limit_cents,
        "reserved_cash_cents": reserved_cash if order.intent == "BUY_TO_OPEN" else 0,
        "reserved_contracts": reserved_contracts if order.intent == "SELL_TO_CLOSE" else 0,
        "expires_at": expires, "account_revision": revision,
    })
    return SubmitResult(order.order_id, "OPEN", None, True)


def fill_price(order: sqlite3.Row, quote: MarketQuote, clock: datetime, consumed: int) -> Optional[int]:
    """Execution price if ``quote`` can fill the whole ``order``, else None."""
    if order["status"] != "OPEN" or quote.contract_id != order["contract_id"] or quote.run_id != order["run_id"]:
        return None
    if quote.source_sequence <= order["after_source_sequence"]:
        return None                                       # never the generating (or an earlier) quote
    if parse_utc(quote.observed_at) < parse_utc(order["submitted_at"]):
        return None                                       # quote predates submission
    if parse_utc(order["expires_at"]) <= clock or not is_fresh(quote, clock):
        return None
    if order["intent"] == "BUY_TO_OPEN":
        if quote.ask_cents <= order["limit_cents"] and quote.ask_size - consumed >= order["quantity"]:
            return quote.ask_cents
    else:
        if quote.bid_cents >= order["limit_cents"] and quote.bid_size - consumed >= order["quantity"]:
            return quote.bid_cents
    return None


def _close_order(conn, run_id: str, order: sqlite3.Row, status: str, reason: str, at: str, clock: str) -> None:
    """Move an OPEN order to CANCELED/EXPIRED and release its reservation."""
    conn.execute(
        """UPDATE orders SET status = ?, terminal_reason = ?, updated_at = ?, reserved_cash_cents = 0,
               reserved_contracts = 0 WHERE order_id = ?""",
        (status, reason, at, order["order_id"]),
    )
    if order["intent"] == "SELL_TO_CLOSE" and order["reserved_contracts"]:
        conn.execute("UPDATE positions SET reserved_contracts = reserved_contracts - ? WHERE position_id = ?",
                     (order["reserved_contracts"], order["position_id"]))
    revision = bump_account_revision(conn, order["account_id"])
    append_run_event(conn, run_id, f"ORDER_{status}", clock, {
        "order_id": order["order_id"], "intent": order["intent"], "reason": reason, "effective_at": at,
        "released_cash_cents": order["reserved_cash_cents"], "released_contracts": order["reserved_contracts"],
        "account_revision": revision,
    })


def expire_due(conn: sqlite3.Connection, run_id: str, clock: str) -> list[str]:
    """Expire every OPEN order whose TTL ended at or before ``clock``, oldest first."""
    due = conn.execute(
        """SELECT * FROM orders WHERE run_id = ? AND status = 'OPEN' AND julianday(expires_at) <= julianday(?)
            ORDER BY expires_at, submitted_at, order_id""",
        (run_id, clock),
    ).fetchall()
    for o in due:
        _close_order(conn, run_id, o, "EXPIRED", "TTL_ELAPSED", o["expires_at"], clock)
    return [o["order_id"] for o in due]


def expire_all(conn: sqlite3.Connection, run_id: str, clock: str, reason: str = "SESSION_END") -> list[str]:
    rows = conn.execute(
        "SELECT * FROM orders WHERE run_id = ? AND status = 'OPEN' ORDER BY submitted_at, order_id", (run_id,)
    ).fetchall()
    for o in rows:
        _close_order(conn, run_id, o, "EXPIRED", reason, clock, clock)
    return [o["order_id"] for o in rows]


def cancel(conn: sqlite3.Connection, run_id: str, order_id: str, clock: str) -> sqlite3.Row:
    o = _order_row(conn, order_id)
    if o is None or o["run_id"] != run_id:
        raise OrderNotFoundError(f"no order {order_id} in this run")
    if o["status"] != "OPEN":
        raise OrderNotOpenError(f"order {order_id} is {o['status']}; only OPEN orders can be canceled")
    _close_order(conn, run_id, o, "CANCELED", "USER_CANCELED", clock, clock)
    return _order_row(conn, order_id)
