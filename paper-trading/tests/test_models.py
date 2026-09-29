"""Shared contracts: SPEC.md examples validate, and invalid money/shape is rejected."""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest
from pydantic import ValidationError

from paper_trading.contracts import (
    AccountSnapshot,
    CashLedgerEntry,
    ClosedTrade,
    Fill,
    MarketQuote,
    OptionContract,
    Order,
    Position,
    RiskDecision,
    TradeProposal,
)
from paper_trading.contracts.types import INT64_MAX

SPEC = Path(__file__).resolve().parent.parent / "SPEC.md"
EXAMPLE_MODELS = [
    OptionContract, MarketQuote, TradeProposal, RiskDecision, Order,
    Fill, Position, AccountSnapshot, CashLedgerEntry, ClosedTrade,
]


def spec_examples() -> list[dict]:
    blocks = re.findall(r"```json\n(.*?)```", SPEC.read_text(encoding="utf-8"), re.S)
    return [json.loads(b) for b in blocks]


def example(model) -> dict:
    return dict(spec_examples()[EXAMPLE_MODELS.index(model)])


def test_every_spec_example_validates():
    examples = spec_examples()
    assert len(examples) == len(EXAMPLE_MODELS)
    for model, data in zip(EXAMPLE_MODELS, examples):
        model.model_validate(data)


def test_worked_example_money_is_consistent():
    trade = ClosedTrade.model_validate(example(ClosedTrade))
    assert trade.realized_pnl_cents == 7870
    assert 10_000_000 + trade.realized_pnl_cents == 10_007_870  # $100,078.70


@pytest.mark.parametrize("model", EXAMPLE_MODELS)
def test_unknown_fields_rejected(model):
    with pytest.raises(ValidationError, match="Extra inputs"):
        model.model_validate({**example(model), "surprise": 1})


@pytest.mark.parametrize("model", EXAMPLE_MODELS)
def test_unsupported_schema_version_rejected(model):
    with pytest.raises(ValidationError):
        model.model_validate({**example(model), "schema_version": "2.0"})


@pytest.mark.parametrize("bad", [400.0, 400.5, "400", True, None])
def test_cents_must_be_integers(bad):
    with pytest.raises(ValidationError):
        MarketQuote.model_validate({**example(MarketQuote), "ask_cents": bad})


def test_negative_price_rejected():
    with pytest.raises(ValidationError):
        MarketQuote.model_validate({**example(MarketQuote), "bid_cents": -1})


def test_int64_overflow_rejected():
    with pytest.raises(ValidationError):
        CashLedgerEntry.model_validate({**example(CashLedgerEntry), "balance_after_cents": INT64_MAX + 1})


def test_crossed_quote_rejected():
    with pytest.raises(ValidationError, match="bid_cents must not exceed"):
        MarketQuote.model_validate({**example(MarketQuote), "bid_cents": 401})


def test_quote_reference_price_optional():
    data = example(MarketQuote)
    del data["session_reference_cents"]
    assert MarketQuote.model_validate(data).session_reference_cents is None


@pytest.mark.parametrize("ts", ["2026-09-29T14:00:00", "2026-09-29T14:00:00+00:00", "2026-09-29 14:00:00Z",
                                "2026-13-29T14:00:00Z"])
def test_timestamps_must_be_utc_z(ts):
    with pytest.raises(ValidationError):
        MarketQuote.model_validate({**example(MarketQuote), "observed_at": ts})


def test_ledger_net_must_equal_premium_plus_fee():
    with pytest.raises(ValidationError, match="net_cash_delta_cents"):
        CashLedgerEntry.model_validate({**example(CashLedgerEntry), "net_cash_delta_cents": -40000})


def test_ledger_fee_delta_nonpositive():
    with pytest.raises(ValidationError):
        CashLedgerEntry.model_validate(
            {**example(CashLedgerEntry), "fee_cash_delta_cents": 65, "net_cash_delta_cents": -39935}
        )


def test_fill_gross_must_match():
    with pytest.raises(ValidationError, match="gross_cents"):
        Fill.model_validate({**example(Fill), "gross_cents": 40001})


def test_snapshot_equity_and_available_must_add_up():
    with pytest.raises(ValidationError, match="equity_cents"):
        AccountSnapshot.model_validate({**example(AccountSnapshot), "equity_cents": 9998936})
    with pytest.raises(ValidationError, match="available_cash_cents"):
        AccountSnapshot.model_validate({**example(AccountSnapshot), "reserved_cash_cents": 1})


def test_snapshot_unavailable_valuation_is_null_not_zero():
    data = {**example(AccountSnapshot), "valuation_status": "UNAVAILABLE"}
    with pytest.raises(ValidationError):
        AccountSnapshot.model_validate(data)
    AccountSnapshot.model_validate(
        {**data, "market_value_cents": None, "equity_cents": None, "unrealized_pnl_cents": None}
    )


def test_rejected_risk_decision_needs_reason():
    with pytest.raises(ValidationError, match="reason code"):
        RiskDecision.model_validate({**example(RiskDecision), "decision": "REJECTED"})


def test_closing_proposal_requires_position():
    data = {**example(TradeProposal), "intent": "SELL_TO_CLOSE", "reason_code": "PROFIT_TARGET"}
    with pytest.raises(ValidationError, match="position_id"):
        TradeProposal.model_validate(data)


def test_terminal_order_keeps_no_reservation():
    with pytest.raises(ValidationError, match="reservations"):
        Order.model_validate({**example(Order), "status": "FILLED"})


def test_closed_position_must_be_zeroed():
    data = {**example(Position), "status": "CLOSED", "closed_at": "2026-09-29T14:10:01Z"}
    with pytest.raises(ValidationError):
        Position.model_validate(data)


def test_closed_trade_pnl_must_match():
    with pytest.raises(ValidationError, match="realized_pnl_cents"):
        ClosedTrade.model_validate({**example(ClosedTrade), "realized_pnl_cents": 7871})
