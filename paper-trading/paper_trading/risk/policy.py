"""Risk policy ``risk_v1``: approve or reject a proposal (SPEC.md record D).

Pure function over the state visible at the current event. The decision is
bound to ``account_revision``; the broker rechecks that revision and the
available cash or unreserved contracts atomically when accepting the order
(clarification 6).

BUY_TO_OPEN
  UNSUPPORTED_CONTRACT  not a standard unadjusted SPY call x100
  INVALID_QUOTE         proposal quote is not the current, fresh, uncrossed quote for
                        the contract, or the buy limit is not its ask
  POSITION_LIMIT        an open position or an open/pending entry order already exists
  INSUFFICIENT_CASH     limit x multiplier x qty + fee > available cash
  RISK_LIMIT            the same entry cost > entry-risk ceiling (1% of starting cash)
SELL_TO_CLOSE
  INVALID_QUOTE         as above, with the sell limit equal to the current bid
  INSUFFICIENT_POSITION no open position for the contract with enough unreserved contracts
  Required cash and entry risk are zero for closes.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Optional

from paper_trading.contracts.models import MarketQuote, OptionContract, Position, TradeProposal
from paper_trading.strategy.sample_spy_long_call import contract_in_scope, is_fresh

POLICY_VERSION = "risk_v1"


@dataclass(frozen=True)
class RiskInputs:
    clock: datetime
    account_revision: int
    available_cash_cents: int
    entry_risk_limit_cents: int
    fee_per_contract_cents: int
    contract: Optional[OptionContract]
    current_quote: Optional[MarketQuote]      # latest accepted quote for the proposal's contract
    position: Optional[Position]              # open position for the contract, if any
    has_open_position: bool
    has_open_entry_order: bool


@dataclass(frozen=True)
class RiskVerdict:
    decision: str
    reason_codes: tuple[str, ...]
    required_cash_cents: int
    entry_risk_cents: int


_ORDER = ("UNSUPPORTED_CONTRACT", "INVALID_QUOTE", "POSITION_LIMIT", "INSUFFICIENT_POSITION",
          "INSUFFICIENT_CASH", "RISK_LIMIT", "STALE_ACCOUNT_REVISION")


def entry_cost_cents(limit_cents: int, multiplier: int, quantity: int, fee_per_contract_cents: int) -> int:
    """Buy reservation and entry risk: limit x multiplier x quantity + entry fee."""
    return limit_cents * multiplier * quantity + fee_per_contract_cents * quantity


def evaluate(proposal: TradeProposal, inputs: RiskInputs) -> RiskVerdict:
    reasons: set[str] = set()
    c, q = inputs.contract, inputs.current_quote

    if c is None or not contract_in_scope(c):
        reasons.add("UNSUPPORTED_CONTRACT")
    quote_ok = (q is not None and q.quote_id == proposal.quote_id and q.contract_id == proposal.contract_id
                and is_fresh(q, inputs.clock) and q.bid_cents <= q.ask_cents)

    if proposal.intent == "BUY_TO_OPEN":
        if not quote_ok or q.bid_cents <= 0 or proposal.limit_cents != q.ask_cents:
            reasons.add("INVALID_QUOTE")
        if inputs.has_open_position or inputs.has_open_entry_order:
            reasons.add("POSITION_LIMIT")
        multiplier = c.multiplier if c is not None else 100
        required = entry_cost_cents(proposal.limit_cents, multiplier, proposal.quantity,
                                    inputs.fee_per_contract_cents)
        if required > inputs.available_cash_cents:
            reasons.add("INSUFFICIENT_CASH")
        if required > inputs.entry_risk_limit_cents:
            reasons.add("RISK_LIMIT")
        entry_risk = required
    else:
        if not quote_ok or proposal.limit_cents != q.bid_cents or q.bid_cents <= 0:
            reasons.add("INVALID_QUOTE")
        p = inputs.position
        if (p is None or p.status != "OPEN" or p.position_id != proposal.position_id
                or p.quantity - p.reserved_contracts < proposal.quantity):
            reasons.add("INSUFFICIENT_POSITION")
        required = entry_risk = 0

    ordered = tuple(sorted(reasons, key=_ORDER.index))
    return RiskVerdict("REJECTED" if ordered else "APPROVED", ordered, required, entry_risk)
