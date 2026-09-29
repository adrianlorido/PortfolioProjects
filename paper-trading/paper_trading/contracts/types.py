"""Primitive field types shared by every record (SPEC.md Section 5)."""

from __future__ import annotations

import re
from datetime import date, datetime, timezone
from typing import Annotated, Literal

from pydantic import AfterValidator, Field, StrictBool, StrictInt, StrictStr

INT64_MIN = -(2**63)
INT64_MAX = 2**63 - 1

SchemaVersion = Literal["1.0"]
SCHEMA_VERSION = "1.0"

# RFC 3339 in UTC, "Z" suffix required, optional fractional seconds.
_UTC_TS = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$")
_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def parse_utc(ts: str) -> datetime:
    return datetime.fromisoformat(ts).astimezone(timezone.utc)


def format_utc(dt: datetime) -> str:
    if dt.tzinfo is None:
        raise ValueError("naive datetime; UTC required")
    dt = dt.astimezone(timezone.utc)
    if dt.microsecond:
        return dt.strftime("%Y-%m-%dT%H:%M:%S.%fZ")
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def validate_utc_timestamp(v: str) -> str:
    if not _UTC_TS.match(v):
        raise ValueError("timestamp must be RFC 3339 UTC ending in 'Z' (e.g. 2026-09-29T14:00:00Z)")
    try:
        parse_utc(v)
    except ValueError as exc:
        raise ValueError(f"invalid timestamp: {v}") from exc
    return v


def _validate_date(v: str) -> str:
    if not _DATE.match(v):
        raise ValueError("date must be YYYY-MM-DD")
    date.fromisoformat(v)
    return v


UtcTimestamp = Annotated[StrictStr, AfterValidator(validate_utc_timestamp)]
IsoDate = Annotated[StrictStr, AfterValidator(_validate_date)]
Id = Annotated[StrictStr, Field(min_length=1, max_length=200)]

# Money in integer cents, signed 64-bit. Nonnegative unless a field says otherwise.
Cents = Annotated[StrictInt, Field(ge=0, le=INT64_MAX)]
SignedCents = Annotated[StrictInt, Field(ge=INT64_MIN, le=INT64_MAX)]
PositiveCents = Annotated[StrictInt, Field(gt=0, le=INT64_MAX)]
NonPositiveCents = Annotated[StrictInt, Field(ge=INT64_MIN, le=0)]

Count = Annotated[StrictInt, Field(ge=0, le=INT64_MAX)]
PositiveInt = Annotated[StrictInt, Field(gt=0, le=INT64_MAX)]
BasisPoints = Annotated[StrictInt, Field(gt=0, le=INT64_MAX)]

Bool = StrictBool
