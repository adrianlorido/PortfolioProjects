"""Strategy ``sample_spy_long_call`` v1.0.0 (SPEC.md Section 2).

DEMONSTRATION RULES ONLY. These rules exist to exercise the paper-trading
infrastructure. They are not a tested or profitable trading strategy.

Pure functions: the coordinator gathers the state visible at the current
event and passes it in; nothing here reads or writes the database. All
arithmetic is integer (cents, basis points, seconds).

Entry (while flat), numbered as in SPEC.md Section 2:
  1  underlying is SPY
  2  underlying price >= reference * 1.005  (integer: price * 10000 >= ref * 10050)
  3  standard, unadjusted CALL, multiplier 100
  4  expiration 30-45 calendar days after the simulated America/New_York date
  5  strike = lowest eligible strike at or above the underlying price
  6  ties: earliest expiration, then lowest strike, then contract_id
  7  bid > 0 and ask >= bid
  8  spread <= 5% of ask             (integer: (ask - bid) * 10000 <= ask * 500)
  9  quote and underlying observations <= 2 simulated seconds old
  10 quantity 1, buy limit = observed ask
  11 entry cost + fee within available cash and the entry-risk ceiling: enforced by
     the risk decision (risk_v1) so a failing entry is recorded as a rejection and
     starts the clarification-1 cooldown; the strategy does not pre-filter it
  plus: no entry during a 60 s per-contract cooldown after a rejected entry
  (clarification 1), no re-entry after a completed trade, one position or
  pending entry at a time.

Exit (position open, first applicable condition, premium prices before fees):
  PROFIT_TARGET   bid * 10000 >= entry * (10000 + 2000)
  LOSS_THRESHOLD  bid * 10000 <= entry * (10000 - 1000)
  TIME_EXIT       clock >= opened_at + 1800 s
  MANUAL_CLOSE    user request (persisted as an exit intent)
  Once an intent exists it is never re-decided; while a close order is
  PENDING/OPEN no new closing proposal is made (clarification 3), and later
  proposals for the same intent use EXIT_RETRY.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Optional
from zoneinfo import ZoneInfo

from paper_trading.contracts.models import ExitRules, MarketQuote, OptionContract, Position
from paper_trading.contracts.types import parse_utc

STRATEGY_ID = "sample_spy_long_call"
STRATEGY_VERSION = "1.0.0"
DEMONSTRATION_NOTICE = "Demonstration rules only; not a tested or profitable trading strategy."

UNDERLYING = "SPY"
ENTRY_THRESHOLD_BPS = 50          # 0.5%
MIN_DAYS_TO_EXPIRATION = 30
MAX_DAYS_TO_EXPIRATION = 45
MAX_SPREAD_BPS = 500              # 5% of ask
MAX_OBSERVATION_AGE_SECONDS = 2
ENTRY_QUANTITY = 1
REJECTION_COOLDOWN_SECONDS = 60   # clarification 1
EXIT_RULES = ExitRules(profit_target_bps=2000, loss_threshold_bps=1000, max_hold_seconds=1800)


@dataclass(frozen=True)
class ProposalDraft:
    intent: str                  # BUY_TO_OPEN | SELL_TO_CLOSE
    contract_id: str
    quote_id: str
    quantity: int
    limit_cents: int
    reason_code: str
    reason: str
    position_id: Optional[str] = None


@dataclass(frozen=True)
class EntryState:
    """Everything the entry rules may look at, as of the current event."""

    clock: datetime
    session_timezone: str
    session_reference_cents: int
    contracts: tuple[OptionContract, ...]
    latest_quotes: dict[str, MarketQuote]        # latest ACCEPTED quote per contract
    has_open_position: bool
    has_pending_entry: bool
    has_completed_trade: bool
    last_entry_rejection_at: dict[str, datetime]  # per contract


@dataclass(frozen=True)
class ExitState:
    clock: datetime
    position: Position
    latest_quote: Optional[MarketQuote]           # latest ACCEPTED quote for the position's contract
    has_pending_close: bool
    intent_reason: Optional[str]                  # persisted exit intent, if any
    prior_close_proposals: int                    # closing proposals already made for this position


def _age_seconds(clock: datetime, ts: str) -> float:
    return (clock - parse_utc(ts)).total_seconds()


def is_fresh(quote: MarketQuote, clock: datetime) -> bool:
    return all(0 <= _age_seconds(clock, ts) <= MAX_OBSERVATION_AGE_SECONDS
               for ts in (quote.observed_at, quote.underlying_observed_at))


def _local_date(clock: datetime, tz: str) -> date:
    return clock.astimezone(ZoneInfo(tz)).date()


def contract_in_scope(c: OptionContract) -> bool:
    """Rule 3 plus the MVP standard-deliverable requirement."""
    return (c.underlying == UNDERLYING and c.option_type == "CALL" and c.multiplier == 100
            and not c.adjusted and c.deliverable == f"100_{UNDERLYING}_SHARES")


def select_entry_contract(state: EntryState, underlying_price_cents: int) -> Optional[OptionContract]:
    """Rules 3-6: eligible terms, then the lowest strike at/above the underlying."""
    today = _local_date(state.clock, state.session_timezone)
    eligible = []
    for c in state.contracts:
        days = (date.fromisoformat(c.expiration_date) - today).days
        if (contract_in_scope(c) and MIN_DAYS_TO_EXPIRATION <= days <= MAX_DAYS_TO_EXPIRATION
                and c.strike_cents >= underlying_price_cents):
            eligible.append(c)
    if not eligible:
        return None
    return min(eligible, key=lambda c: (c.expiration_date, c.strike_cents, c.contract_id))


def evaluate_entry(state: EntryState, event_quote: MarketQuote) -> Optional[ProposalDraft]:
    if state.has_open_position or state.has_pending_entry or state.has_completed_trade:
        return None
    underlying = event_quote.underlying_price_cents
    if underlying * 10_000 < state.session_reference_cents * (10_000 + ENTRY_THRESHOLD_BPS):
        return None                                                     # rule 2
    contract = select_entry_contract(state, underlying)                 # rules 1, 3-6
    if contract is None:
        return None
    rejected_at = state.last_entry_rejection_at.get(contract.contract_id)
    if rejected_at is not None and (state.clock - rejected_at) < timedelta(seconds=REJECTION_COOLDOWN_SECONDS):
        return None                                                     # clarification 1
    quote = state.latest_quotes.get(contract.contract_id)
    if quote is None or not is_fresh(quote, state.clock):
        return None                                                     # rule 9
    if quote.bid_cents <= 0 or quote.ask_cents < quote.bid_cents:
        return None                                                     # rule 7
    if (quote.ask_cents - quote.bid_cents) * 10_000 > quote.ask_cents * MAX_SPREAD_BPS:
        return None                                                     # rule 8
    pct_bps_x100 = (underlying - state.session_reference_cents) * 1_000_000 // state.session_reference_cents
    return ProposalDraft(
        intent="BUY_TO_OPEN",
        contract_id=contract.contract_id,
        quote_id=quote.quote_id,
        quantity=ENTRY_QUANTITY,
        limit_cents=quote.ask_cents,                                    # rule 10
        reason_code="ENTRY_SIGNAL",
        reason=(f"Underlying {underlying} cents is {pct_bps_x100 // 100}.{pct_bps_x100 % 100:02d} bps above the "
                f"{state.session_reference_cents} cents reference (threshold {ENTRY_THRESHOLD_BPS} bps). "
                + DEMONSTRATION_NOTICE),
    )


def exit_trigger(state: ExitState) -> Optional[str]:
    """First applicable automatic exit condition, or None. Requires a current quote."""
    q, pos = state.latest_quote, state.position
    entry = pos.entry_price_cents
    if q is not None and is_fresh(q, state.clock):
        if q.bid_cents * 10_000 >= entry * (10_000 + EXIT_RULES.profit_target_bps):
            return "PROFIT_TARGET"
        if q.bid_cents * 10_000 <= entry * (10_000 - EXIT_RULES.loss_threshold_bps):
            return "LOSS_THRESHOLD"
    if state.clock >= parse_utc(pos.opened_at) + timedelta(seconds=EXIT_RULES.max_hold_seconds):
        return "TIME_EXIT"
    return None


_EXIT_TEXT = {
    "PROFIT_TARGET": "Bid reached 120% of the entry fill price.",
    "LOSS_THRESHOLD": "Bid fell to 90% of the entry fill price.",
    "TIME_EXIT": "Position held for 30 simulated minutes.",
    "MANUAL_CLOSE": "User requested a close.",
    "EXIT_RETRY": "Retrying the persisted exit intent after the previous closing order ended unfilled.",
}


def evaluate_exit(state: ExitState) -> tuple[Optional[str], Optional[ProposalDraft]]:
    """Return (new intent reason to persist, closing proposal) for an open position.

    The intent is decided once; proposals need a current quote with a positive
    bid (a sell limit must be positive), otherwise the intent waits for the next
    valid quote.
    """
    pos = state.position
    if pos.status != "OPEN" or state.has_pending_close:
        return None, None
    new_intent = None
    reason = state.intent_reason
    if reason is None:
        reason = exit_trigger(state)
        if reason is None:
            return None, None
        new_intent = reason
    q = state.latest_quote
    if q is None or not is_fresh(q, state.clock) or q.bid_cents <= 0:
        return new_intent, None
    code = "EXIT_RETRY" if state.prior_close_proposals > 0 else reason
    return new_intent, ProposalDraft(
        intent="SELL_TO_CLOSE",
        contract_id=pos.contract_id,
        quote_id=q.quote_id,
        quantity=pos.quantity - pos.reserved_contracts,
        limit_cents=q.bid_cents,
        reason_code=code,
        reason=f"{_EXIT_TEXT[code]} Exit intent: {reason}. Sell limit = current bid. {DEMONSTRATION_NOTICE}",
        position_id=pos.position_id,
    )
