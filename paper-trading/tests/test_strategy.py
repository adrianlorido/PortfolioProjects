"""Strategy sample_spy_long_call v1.0.0 and risk_v1 as pure functions: thresholds and boundaries."""

from __future__ import annotations

from datetime import timedelta

import pytest

from paper_trading.contracts.models import MarketQuote, OptionContract, Position, TradeProposal
from paper_trading.contracts.types import parse_utc
from paper_trading.risk import policy as risk
from paper_trading.strategy import sample_spy_long_call as s

from trading_helpers import contract

CLOCK = "2026-09-29T14:00:00Z"


def C(**kw) -> OptionContract:
    return OptionContract.model_validate(contract(**kw))


def Q(bid=390, ask=400, und=60000, cid="SPY_20261030_C_60000", observed=CLOCK, qid="q", seq=1) -> MarketQuote:
    return MarketQuote(schema_version="1.0", quote_id=qid, run_id="r", contract_id=cid, source="synthetic_fixture_v1",
                       is_sample=True, source_sequence=seq, observed_at=observed, received_at=observed,
                       bid_cents=bid, ask_cents=ask, bid_size=10, ask_size=10, underlying_price_cents=und,
                       underlying_observed_at=observed)


def entry_state(contracts, quotes, clock=CLOCK, **over) -> s.EntryState:
    base = dict(clock=parse_utc(clock), session_timezone="America/New_York", session_reference_cents=59700,
                contracts=tuple(contracts), latest_quotes={q.contract_id: q for q in quotes},
                has_open_position=False, has_pending_entry=False, has_completed_trade=False,
                last_entry_rejection_at={})
    base.update(over)
    return s.EntryState(**base)


def entry(quote=None, contracts=None, **over):
    quote = quote or Q()
    return s.evaluate_entry(entry_state(contracts or [C()], [quote], **over), quote)


# --- entry ---------------------------------------------------------------


def test_worked_example_entry():
    d = entry()
    assert (d.intent, d.quantity, d.limit_cents, d.reason_code, d.contract_id) == (
        "BUY_TO_OPEN", 1, 400, "ENTRY_SIGNAL", "SPY_20261030_C_60000")
    assert "Demonstration rules only" in d.reason and "50.25 bps" in d.reason


@pytest.mark.parametrize("und, expected", [(59998, False), (59999, True)])
def test_entry_threshold_boundary(und, expected):
    # 59700 * 1.005 = 59998.5: 59998 is below the threshold, 59999 is at/above it.
    assert (entry(Q(und=und, ask=400)) is not None) is expected


@pytest.mark.parametrize("bid, expected", [(380, True), (379, False), (0, False)])
def test_spread_boundary_and_positive_bid(bid, expected):
    assert (entry(Q(bid=bid, ask=400)) is not None) is expected   # 20/400 = exactly 5%


def test_stale_quote_or_underlying_blocks_entry():
    assert entry(Q(observed="2026-09-29T13:59:57Z")) is None     # 3 s old
    assert entry(Q(observed="2026-09-29T13:59:58Z")) is not None  # 2 s old is still fresh


@pytest.mark.parametrize("expiration, ok", [
    ("2026-10-28", False),  # 29 days
    ("2026-10-29", True),   # 30 days
    ("2026-11-13", True),   # 45 days
    ("2026-11-14", False),  # 46 days
])
def test_expiration_window(expiration, ok):
    c = C(contract_id="X", expiration=expiration)
    assert (entry(Q(cid="X"), [c]) is not None) is ok


def test_expiration_uses_new_york_date_not_utc():
    # 02:00Z on Sep 30 is still Sep 29 in New York (EDT): Oct 29 is 30 days away, not 29.
    clock = "2026-09-30T02:00:00Z"
    c = C(contract_id="X", expiration="2026-10-29")
    quote = Q(cid="X", observed=clock)
    assert s.evaluate_entry(entry_state([c], [quote], clock=clock), quote) is not None


def test_strike_selection_and_tie_breaks():
    contracts = [C(contract_id="K595", strike=59500), C(contract_id="K600", strike=60000),
                 C(contract_id="K605", strike=60500),
                 C(contract_id="K600_NOV", strike=60000, expiration="2026-11-06")]
    quotes = [Q(cid=c.contract_id, qid=c.contract_id) for c in contracts]
    st = entry_state(contracts, quotes)
    assert s.evaluate_entry(st, quotes[0]).contract_id == "K600"          # lowest strike >= 600, earliest expiry
    st2 = entry_state(contracts, [Q(cid=c.contract_id, qid=c.contract_id, und=60001) for c in contracts])
    assert s.evaluate_entry(st2, Q(und=60001)).contract_id == "K605"       # 600 is now below the underlying


def test_earlier_expiration_beats_lower_strike():
    """Rule 6 ordering is expiration first. SPEC.md §13.20 records this interpretation of rules 5-6."""
    a = C(contract_id="A_OCT30_605", expiration="2026-10-30", strike=60500)   # earlier expiry, higher strike
    b = C(contract_id="B_NOV06_600", expiration="2026-11-06", strike=60000)   # later expiry, lowest strike
    c = C(contract_id="C_OCT30_610", expiration="2026-10-30", strike=61000)   # same expiry as A, higher strike
    quotes = [Q(cid=x.contract_id, qid=x.contract_id) for x in (a, b, c)]
    st = entry_state([b, c, a], quotes)
    assert s.select_entry_contract(st, 60000).contract_id == "A_OCT30_605"
    assert s.evaluate_entry(st, quotes[0]).contract_id == "A_OCT30_605"


def test_selected_contract_needs_its_own_current_quote():
    # The event quote is for another contract; the selected contract has no quote yet -> no entry.
    contracts = [C(contract_id="K600", strike=60000), C(contract_id="K605", strike=60500)]
    quote = Q(cid="K605", qid="k605")
    assert s.evaluate_entry(entry_state(contracts, [quote]), quote) is None


def test_unsupported_contracts_never_selected():
    for bad in (C(contract_id="P", option_type="PUT"), C(contract_id="A", adjusted=True),
                C(contract_id="M", multiplier=10)):
        assert entry(Q(cid=bad.contract_id), [bad]) is None


def test_position_limit_and_no_reentry():
    assert entry(has_open_position=True) is None
    assert entry(has_pending_entry=True) is None
    assert entry(has_completed_trade=True) is None


def test_rejection_cooldown_is_sixty_seconds_per_contract():
    at = parse_utc(CLOCK)
    assert entry(last_entry_rejection_at={"SPY_20261030_C_60000": at - timedelta(seconds=59)}) is None
    assert entry(last_entry_rejection_at={"SPY_20261030_C_60000": at - timedelta(seconds=60)}) is not None
    assert entry(last_entry_rejection_at={"OTHER": at}) is not None  # per contract, not global


# --- exit ----------------------------------------------------------------


def position(opened="2026-09-29T14:00:01Z", entry_price=400, reserved=0) -> Position:
    return Position(schema_version="1.0", position_id="pos", run_id="r", account_id="a",
                    contract_id="SPY_20261030_C_60000", entry_fill_id="f", opened_at=opened, closed_at=None,
                    status="OPEN", quantity=1, reserved_contracts=reserved, entry_price_cents=entry_price,
                    remaining_cost_basis_cents=40065, mark_quote_id="q", market_value_cents=39000,
                    unrealized_pnl_cents=-1065, valuation_status="CURRENT")


def exit_(bid, clock="2026-09-29T14:10:00Z", **over):
    st = dict(clock=parse_utc(clock), position=position(), latest_quote=Q(bid=bid, ask=bid + 10, observed=clock),
              has_pending_close=False, intent_reason=None, prior_close_proposals=0)
    st.update(over)
    return s.evaluate_exit(s.ExitState(**st))


@pytest.mark.parametrize("bid, expected", [
    (480, "PROFIT_TARGET"), (479, None), (361, None), (360, "LOSS_THRESHOLD"), (300, "LOSS_THRESHOLD")])
def test_price_exit_boundaries(bid, expected):
    intent, draft = exit_(bid)
    assert intent == expected
    if expected:
        assert (draft.intent, draft.limit_cents, draft.reason_code, draft.quantity) == (
            "SELL_TO_CLOSE", bid, expected, 1)


def test_time_exit_boundary():
    assert exit_(400, clock="2026-09-29T14:30:00Z") == (None, None)       # 1799 s after 14:00:01
    intent, draft = exit_(400, clock="2026-09-29T14:30:01Z")
    assert intent == "TIME_EXIT" and draft.reason_code == "TIME_EXIT"


def test_profit_checked_before_time():
    assert exit_(480, clock="2026-09-29T15:00:00Z")[0] == "PROFIT_TARGET"


def test_no_closing_proposal_while_close_pending():
    assert exit_(480, has_pending_close=True) == (None, None)
    assert exit_(480, has_pending_close=True, intent_reason="PROFIT_TARGET") == (None, None)


def test_existing_intent_retries_with_exit_retry():
    intent, draft = exit_(470, intent_reason="PROFIT_TARGET", prior_close_proposals=1)
    assert intent is None and draft.reason_code == "EXIT_RETRY" and draft.limit_cents == 470
    intent, draft = exit_(470, intent_reason="MANUAL_CLOSE", prior_close_proposals=0)
    assert draft.reason_code == "MANUAL_CLOSE"


def test_intent_waits_without_current_quote_or_positive_bid():
    stale = Q(bid=480, ask=490, observed="2026-09-29T14:09:50Z")
    assert exit_(480, latest_quote=stale) == (None, None)             # stale quote: no price trigger
    assert exit_(0, intent_reason="MANUAL_CLOSE") == (None, None)     # a sell limit must be positive


# --- risk ----------------------------------------------------------------


def proposal(intent="BUY_TO_OPEN", limit=400, qid="q", position_id=None, reason="ENTRY_SIGNAL") -> TradeProposal:
    return TradeProposal(schema_version="1.0", proposal_id="p", run_id="r", account_id="a",
                         contract_id="SPY_20261030_C_60000", position_id=position_id, quote_id=qid,
                         strategy_id=s.STRATEGY_ID, strategy_version=s.STRATEGY_VERSION, created_at=CLOCK,
                         intent=intent, quantity=1, limit_cents=limit, reason_code=reason, reason="x",
                         exit_rules=s.EXIT_RULES, idempotency_key="k")


def inputs(**over) -> risk.RiskInputs:
    base = dict(clock=parse_utc(CLOCK), account_revision=1, available_cash_cents=10_000_000,
                entry_risk_limit_cents=100_000, fee_per_contract_cents=65, contract=C(), current_quote=Q(),
                position=None, has_open_position=False, has_open_entry_order=False)
    base.update(over)
    return risk.RiskInputs(**base)


def test_risk_approves_worked_entry():
    v = risk.evaluate(proposal(), inputs())
    assert (v.decision, v.reason_codes, v.required_cash_cents, v.entry_risk_cents) == ("APPROVED", (), 40065, 40065)


@pytest.mark.parametrize("over, reasons", [
    ({"available_cash_cents": 40064}, ("INSUFFICIENT_CASH",)),
    ({"entry_risk_limit_cents": 40064}, ("RISK_LIMIT",)),
    ({"has_open_position": True}, ("POSITION_LIMIT",)),
    ({"has_open_entry_order": True}, ("POSITION_LIMIT",)),
    ({"current_quote": Q(observed="2026-09-29T13:59:50Z")}, ("INVALID_QUOTE",)),
    ({"current_quote": Q(qid="newer")}, ("INVALID_QUOTE",)),
    ({"contract": None}, ("UNSUPPORTED_CONTRACT",)),
])
def test_risk_entry_rejections(over, reasons):
    v = risk.evaluate(proposal(), inputs(**over))
    assert v.decision == "REJECTED" and v.reason_codes == reasons


def test_risk_limit_and_cash_boundaries_are_inclusive():
    assert risk.evaluate(proposal(), inputs(available_cash_cents=40065, entry_risk_limit_cents=40065)).decision \
        == "APPROVED"
    # $9.99 ask: 99,900 + 65 = 99,965 <= 100,000. $10.00 ask: 100,065 > 100,000.
    assert risk.evaluate(proposal(limit=999), inputs(current_quote=Q(bid=990, ask=999))).decision == "APPROVED"
    assert risk.evaluate(proposal(limit=1000), inputs(current_quote=Q(bid=990, ask=1000))).reason_codes == (
        "RISK_LIMIT",)


def test_risk_close_checks_unreserved_contracts():
    p = proposal("SELL_TO_CLOSE", limit=390, position_id="pos", reason="MANUAL_CLOSE")
    ok = risk.evaluate(p, inputs(position=position(), has_open_position=True))
    assert (ok.decision, ok.required_cash_cents, ok.entry_risk_cents) == ("APPROVED", 0, 0)
    busy = risk.evaluate(p, inputs(position=position(reserved=1), has_open_position=True))
    assert busy.reason_codes == ("INSUFFICIENT_POSITION",)
    wrong_limit = risk.evaluate(proposal("SELL_TO_CLOSE", limit=380, position_id="pos", reason="MANUAL_CLOSE"),
                                inputs(position=position(), has_open_position=True))
    assert wrong_limit.reason_codes == ("INVALID_QUOTE",)
