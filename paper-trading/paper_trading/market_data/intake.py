"""Quote intake validation (SPEC.md Section 3 "Quote validation", clarification 2).

``validate_quote_input`` is a pure function: given one raw provider input and
the intake context (simulated clock, session, pinned reference price, fixture
contracts, and already-accepted source sequences) it returns either a
validated field set or a non-empty, deterministically ordered list of reason
codes. Nothing here touches the database.

Two stages:

1. Shape. Unknown fields, missing fields, wrong types, negative or
   non-positive values, and malformed timestamps. If any fail, validation stops
   there, because later checks need well-formed values.
2. Semantics. All applicable reasons are collected: source and sample flag,
   contract, crossed market, observation freshness against the simulated
   clock, session window, reference price, and source sequence.

Source-sequence rule (per run and source), using only ACCEPTED quotes:

    H = highest accepted source_sequence so far (none before the first accept)
    s already accepted                 -> DUPLICATE_SEQUENCE
    H exists and s < H (not accepted)  -> OUT_OF_ORDER_SEQUENCE
    otherwise (s > H, gaps allowed)    -> sequence OK

Rejected inputs never advance H, so an invalid input (even one with a huge
sequence number) cannot block later valid quotes, and a rejected sequence
number may be reused by a later valid input. Replay event numbers
(``replay_position`` and ``run_events.event_sequence``) are assigned by the
replay engine and are unrelated to provider source sequences.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any, Optional

from paper_trading.contracts.types import INT64_MAX, parse_utc, validate_utc_timestamp

MAX_OBSERVATION_AGE_SECONDS = 2

# Canonical order for reporting reasons.
REASON_CODES = (
    "UNKNOWN_FIELD",
    "MISSING_FIELD",
    "MISSING_SIZE",
    "INVALID_TYPE",
    "INVALID_TIMESTAMP",
    "NEGATIVE_VALUE",
    "NONPOSITIVE_PRICE",
    "SOURCE_MISMATCH",
    "NOT_SAMPLE_DATA",
    "UNKNOWN_CONTRACT",
    "CROSSED_QUOTE",
    "FUTURE_OBSERVATION",
    "STALE_QUOTE",
    "FUTURE_UNDERLYING_OBSERVATION",
    "STALE_UNDERLYING",
    "OUTSIDE_SESSION",
    "REFERENCE_PRICE_MISMATCH",
    "DUPLICATE_SEQUENCE",
    "OUT_OF_ORDER_SEQUENCE",
)
_ORDER = {code: i for i, code in enumerate(REASON_CODES)}

_STR_FIELDS = ("source", "contract_id")
_TS_FIELDS = ("observed_at", "underlying_observed_at")
_SIZE_FIELDS = ("bid_size", "ask_size")
_NONNEG_INT_FIELDS = ("source_sequence", "bid_cents")
_POSITIVE_INT_FIELDS = ("ask_cents", "underlying_price_cents")
REQUIRED_FIELDS = frozenset(
    _STR_FIELDS + _TS_FIELDS + _SIZE_FIELDS + _NONNEG_INT_FIELDS + _POSITIVE_INT_FIELDS + ("is_sample",)
)
OPTIONAL_FIELDS = frozenset({"session_reference_cents"})


@dataclass(frozen=True)
class IntakeContext:
    clock: datetime
    session_start: datetime
    session_end: datetime
    source: str
    contract_ids: frozenset[str]
    session_reference_cents: int
    accepted_sequences: frozenset[int]


@dataclass(frozen=True)
class IntakeResult:
    fields: Optional[dict[str, Any]]
    reasons: tuple[str, ...]

    @property
    def accepted(self) -> bool:
        return not self.reasons


def _is_int(v: Any) -> bool:
    # bool is an int subclass in Python; it is never a valid count or price.
    return isinstance(v, int) and not isinstance(v, bool)


def _sorted(reasons: set[str]) -> tuple[str, ...]:
    return tuple(sorted(reasons, key=_ORDER.__getitem__))


def _shape(raw: Any) -> set[str]:
    if not isinstance(raw, dict):
        return {"INVALID_TYPE"}
    reasons: set[str] = set()
    if set(raw) - REQUIRED_FIELDS - OPTIONAL_FIELDS:
        reasons.add("UNKNOWN_FIELD")
    for f in REQUIRED_FIELDS:
        if raw.get(f) is None:
            reasons.add("MISSING_SIZE" if f in _SIZE_FIELDS else "MISSING_FIELD")
    for f in _STR_FIELDS:
        if f in raw and raw[f] is not None and (not isinstance(raw[f], str) or not raw[f]):
            reasons.add("INVALID_TYPE")
    if "is_sample" in raw and raw["is_sample"] is not None and not isinstance(raw["is_sample"], bool):
        reasons.add("INVALID_TYPE")
    for f in _TS_FIELDS:
        v = raw.get(f)
        if v is None:
            continue
        if not isinstance(v, str):
            reasons.add("INVALID_TYPE")
            continue
        try:
            validate_utc_timestamp(v)
        except ValueError:
            reasons.add("INVALID_TIMESTAMP")
    ints = _SIZE_FIELDS + _NONNEG_INT_FIELDS + _POSITIVE_INT_FIELDS + ("session_reference_cents",)
    for f in ints:
        v = raw.get(f)
        if v is None:
            continue
        if not _is_int(v) or v > INT64_MAX:
            reasons.add("INVALID_TYPE")
        elif v < 0:
            reasons.add("NEGATIVE_VALUE")
        elif v == 0 and f in _POSITIVE_INT_FIELDS + ("session_reference_cents",):
            reasons.add("NONPOSITIVE_PRICE")
    return reasons


def validate_quote_input(raw: Any, ctx: IntakeContext) -> IntakeResult:
    shape = _shape(raw)
    if shape:
        return IntakeResult(None, _sorted(shape))

    reasons: set[str] = set()
    if raw["source"] != ctx.source:
        reasons.add("SOURCE_MISMATCH")
    if raw["is_sample"] is not True:
        reasons.add("NOT_SAMPLE_DATA")
    if raw["contract_id"] not in ctx.contract_ids:
        reasons.add("UNKNOWN_CONTRACT")
    if raw["bid_cents"] > raw["ask_cents"]:
        reasons.add("CROSSED_QUOTE")

    observed = parse_utc(raw["observed_at"])
    underlying_observed = parse_utc(raw["underlying_observed_at"])
    if observed > ctx.clock:
        reasons.add("FUTURE_OBSERVATION")
    elif (ctx.clock - observed).total_seconds() > MAX_OBSERVATION_AGE_SECONDS:
        reasons.add("STALE_QUOTE")
    if underlying_observed > ctx.clock:
        reasons.add("FUTURE_UNDERLYING_OBSERVATION")
    elif (ctx.clock - underlying_observed).total_seconds() > MAX_OBSERVATION_AGE_SECONDS:
        reasons.add("STALE_UNDERLYING")
    window = (ctx.session_start, ctx.session_end)
    if not (window[0] <= observed <= window[1] and window[0] <= underlying_observed <= window[1]
            and window[0] <= ctx.clock <= window[1]):
        reasons.add("OUTSIDE_SESSION")

    ref = raw.get("session_reference_cents")
    if ref is not None and ref != ctx.session_reference_cents:
        reasons.add("REFERENCE_PRICE_MISMATCH")

    seq = raw["source_sequence"]
    if seq in ctx.accepted_sequences:
        reasons.add("DUPLICATE_SEQUENCE")
    elif ctx.accepted_sequences and seq < max(ctx.accepted_sequences):
        reasons.add("OUT_OF_ORDER_SEQUENCE")

    if reasons:
        return IntakeResult(None, _sorted(reasons))
    return IntakeResult(dict(raw), ())
