"""Display formatting for integer cents. Presentation only; no arithmetic on
balances happens here beyond splitting dollars from cents."""

from __future__ import annotations

from typing import Optional


def format_cents(cents: Optional[int]) -> str:
    if cents is None:
        return "Unavailable"
    sign = "−" if cents < 0 else ""
    dollars, rem = divmod(abs(cents), 100)
    return f"{sign}${dollars:,}.{rem:02d}"


def format_signed_cents(cents: Optional[int]) -> str:
    if cents is None:
        return "Unavailable"
    return ("+" if cents > 0 else "") + format_cents(cents)
