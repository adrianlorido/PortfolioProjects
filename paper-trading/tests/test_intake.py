"""Quote intake validation rules, one reason code at a time (pure function)."""

from __future__ import annotations

import pytest

from paper_trading.contracts.types import parse_utc
from paper_trading.market_data.intake import REASON_CODES, IntakeContext, validate_quote_input

CLOCK = "2026-09-29T14:00:10Z"


def ctx(accepted=(), clock=CLOCK) -> IntakeContext:
    return IntakeContext(
        clock=parse_utc(clock),
        session_start=parse_utc("2026-09-29T13:30:00Z"),
        session_end=parse_utc("2026-09-29T20:00:00Z"),
        source="synthetic_fixture_v1",
        contract_ids=frozenset({"C1"}),
        session_reference_cents=59700,
        accepted_sequences=frozenset(accepted),
    )


def raw(**changes) -> dict:
    base = {
        "source": "synthetic_fixture_v1", "is_sample": True, "source_sequence": 5, "contract_id": "C1",
        "observed_at": CLOCK, "bid_cents": 390, "ask_cents": 400, "bid_size": 10, "ask_size": 10,
        "underlying_price_cents": 60000, "underlying_observed_at": CLOCK, "session_reference_cents": 59700,
    }
    for k, v in changes.items():
        if v is ...:
            base.pop(k)
        else:
            base[k] = v
    return base


def reasons(r, **kw):
    return validate_quote_input(r, ctx(**kw)).reasons


def test_valid_quote_accepted():
    result = validate_quote_input(raw(), ctx())
    assert result.accepted and result.fields["bid_cents"] == 390


def test_boundaries_accepted():
    assert reasons(raw(observed_at="2026-09-29T14:00:08Z", underlying_observed_at="2026-09-29T14:00:08Z")) == ()
    assert reasons(raw(bid_cents=400)) == ()  # locked market is not crossed
    assert reasons(raw(bid_cents=0, bid_size=0)) == ()  # zero bid/size is a valid (unfillable) quote
    assert reasons(raw(session_reference_cents=...)) == ()  # reference is optional
    assert reasons(raw(session_reference_cents=None)) == ()


@pytest.mark.parametrize("changes, expected", [
    ({"observed_at": "2026-09-29T14:00:07Z"}, ("STALE_QUOTE",)),
    ({"observed_at": "2026-09-29T14:00:11Z"}, ("FUTURE_OBSERVATION",)),
    ({"underlying_observed_at": "2026-09-29T14:00:07Z"}, ("STALE_UNDERLYING",)),
    ({"underlying_observed_at": "2026-09-29T14:00:11Z"}, ("FUTURE_UNDERLYING_OBSERVATION",)),
    ({"bid_cents": 401}, ("CROSSED_QUOTE",)),
    ({"ask_size": ...}, ("MISSING_SIZE",)),
    ({"bid_size": None}, ("MISSING_SIZE",)),
    ({"contract_id": ...}, ("MISSING_FIELD",)),
    ({"session_reference_cents": 59800}, ("REFERENCE_PRICE_MISMATCH",)),
    ({"source": "live_feed"}, ("SOURCE_MISMATCH",)),
    ({"is_sample": False}, ("NOT_SAMPLE_DATA",)),
    ({"contract_id": "C2"}, ("UNKNOWN_CONTRACT",)),
    ({"bid_cents": -1}, ("NEGATIVE_VALUE",)),
    ({"ask_size": -3}, ("NEGATIVE_VALUE",)),
    ({"ask_cents": 0, "bid_cents": 0}, ("NONPOSITIVE_PRICE",)),
    ({"bid_cents": 390.0}, ("INVALID_TYPE",)),
    ({"bid_size": "10"}, ("INVALID_TYPE",)),
    ({"source_sequence": True}, ("INVALID_TYPE",)),
    ({"observed_at": "2026-09-29 14:00:10"}, ("INVALID_TIMESTAMP",)),
    ({"venue": "X"}, ("UNKNOWN_FIELD",)),
])
def test_single_rejection_reason(changes, expected):
    assert reasons(raw(**changes)) == expected


def test_outside_session():
    early = "2026-09-29T13:29:59Z"
    assert "OUTSIDE_SESSION" in reasons(raw(observed_at=early, underlying_observed_at=early),
                                        clock="2026-09-29T13:30:00Z")


def test_multiple_reasons_reported_in_canonical_order():
    got = reasons(raw(bid_cents=500, observed_at="2026-09-29T14:00:00Z", session_reference_cents=1))
    assert got == ("CROSSED_QUOTE", "STALE_QUOTE", "REFERENCE_PRICE_MISMATCH")
    assert list(got) == sorted(got, key=REASON_CODES.index)


def test_shape_errors_stop_semantic_checks():
    # Crossed AND missing size: only the shape problem is reported, since semantics need all fields.
    assert reasons(raw(bid_cents=500, ask_size=...)) == ("MISSING_SIZE",)


def test_non_object_input():
    assert validate_quote_input(["not", "a", "dict"], ctx()).reasons == ("INVALID_TYPE",)


class TestSourceSequence:
    def test_first_quote_any_sequence(self):
        assert reasons(raw(source_sequence=0)) == ()
        assert reasons(raw(source_sequence=10**6)) == ()

    def test_increasing_with_gaps_allowed(self):
        assert reasons(raw(source_sequence=9), accepted={1, 2, 5}) == ()

    def test_duplicate_of_latest(self):
        assert reasons(raw(source_sequence=5), accepted={1, 5}) == ("DUPLICATE_SEQUENCE",)

    def test_duplicate_of_older(self):
        assert reasons(raw(source_sequence=1), accepted={1, 5}) == ("DUPLICATE_SEQUENCE",)

    def test_backward_unseen(self):
        assert reasons(raw(source_sequence=3), accepted={1, 5}) == ("OUT_OF_ORDER_SEQUENCE",)

    def test_rejected_numbers_are_not_tracked(self):
        # Only accepted sequences are passed in; a number used by a rejected input is reusable.
        assert reasons(raw(source_sequence=6), accepted={1, 5}) == ()
