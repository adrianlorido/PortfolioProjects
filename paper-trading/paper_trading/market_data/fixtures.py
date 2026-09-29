"""Versioned synthetic fixtures: format, checksum, and validation.

A fixture is a JSON document describing one sample session: metadata, the
option contracts it may quote, and an ordered timeline of scheduled events
(``SESSION_OPEN``, ``QUOTE``, ``SESSION_CLOSE``). Each event's ``at`` is its
scheduled simulated arrival time; replay moves the clock to it.

Quote ``input`` objects are raw provider data. Loading checks the fixture's
structure but deliberately does NOT validate quote content; that happens at
intake so invalid inputs are recorded with reason codes instead of silently
failing the load.

Checksum: ``"sha256:" + sha256(canonical JSON of the document without its
"checksum" key)``, where canonical JSON is ``json.dumps(obj, sort_keys=True,
separators=(",", ":"), ensure_ascii=False)`` encoded as UTF-8. Whitespace and
key order in the file do not affect it; any change to a value does.
"""

from __future__ import annotations

import hashlib
import json
from datetime import date, timedelta
from pathlib import Path
from typing import Any, Literal, Optional
from zoneinfo import ZoneInfo

from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

from paper_trading.config import PROJECT_ROOT
from paper_trading.contracts.models import OptionContract
from paper_trading.contracts.types import Id, PositiveCents, UtcTimestamp, parse_utc
from paper_trading.contracts.versions import FIXTURE_SOURCE

FIXTURES_DIR = PROJECT_ROOT / "fixtures"
DEFAULT_FIXTURE_ID = "sample_spy_worked_trade"
MIN_DAYS_BEFORE_EXPIRATION = 7  # SPEC.md Section 4


class FixtureValidationError(ValueError):
    """The fixture or dataset is malformed, fails its checksum, or is out of scope."""


class FixtureModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, frozen=True)


class FixtureSession(FixtureModel):
    timezone: Literal["America/New_York"]
    start: UtcTimestamp
    end: UtcTimestamp


class FixtureEvent(FixtureModel):
    event_type: Literal["SESSION_OPEN", "QUOTE", "SESSION_CLOSE"]
    at: UtcTimestamp
    ref: Optional[Id] = None
    input: Optional[dict[str, Any]] = None

    @model_validator(mode="after")
    def _input_only_on_quotes(self) -> "FixtureEvent":
        if self.event_type == "QUOTE" and self.input is None:
            raise ValueError("QUOTE events require an input object")
        if self.event_type != "QUOTE" and self.input is not None:
            raise ValueError("session boundary events carry no input")
        return self


class FixtureDocument(FixtureModel):
    fixture_schema_version: Literal["1.0"]
    fixture_id: Id
    fixture_version: Id
    checksum: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")
    source: Literal["synthetic_fixture_v1"]
    is_sample: Literal[True]
    data_label: str = Field(min_length=1)
    description: str = Field(min_length=1)
    underlying: Literal["SPY"]
    session: FixtureSession
    session_reference_cents: PositiveCents
    contracts: list[OptionContract] = Field(min_length=1)
    events: list[FixtureEvent] = Field(min_length=2)

    @model_validator(mode="after")
    def _structure(self) -> "FixtureDocument":
        if "SYNTHETIC" not in self.data_label.upper():
            raise ValueError("data_label must identify the data as SYNTHETIC sample data")
        start, end = parse_utc(self.session.start), parse_utc(self.session.end)
        if end <= start:
            raise ValueError("session end must be after session start")

        ids = [c.contract_id for c in self.contracts]
        if len(set(ids)) != len(ids):
            raise ValueError("duplicate contract_id in fixture")

        first, last = self.events[0], self.events[-1]
        if first.event_type != "SESSION_OPEN" or parse_utc(first.at) != start:
            raise ValueError("first event must be SESSION_OPEN at the session start")
        if last.event_type != "SESSION_CLOSE" or parse_utc(last.at) != end:
            raise ValueError("last event must be SESSION_CLOSE at the session end")
        inner = self.events[1:-1]
        if any(e.event_type != "QUOTE" for e in inner):
            raise ValueError("only QUOTE events may appear between SESSION_OPEN and SESSION_CLOSE")

        # The replay clock is driven by these times, so they must never go backward.
        previous = start
        for i, e in enumerate(self.events, start=1):
            t = parse_utc(e.at)
            if t < previous:
                raise ValueError(f"event {i} is scheduled before event {i - 1}; times must be non-decreasing")
            if not start <= t <= end:
                raise ValueError(f"event {i} is scheduled outside the session")
            previous = t
        return self


def canonical_json(obj: Any) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def compute_checksum(document: dict) -> str:
    body = {k: v for k, v in document.items() if k != "checksum"}
    return "sha256:" + hashlib.sha256(canonical_json(body).encode("utf-8")).hexdigest()


def validate_contract_scope(doc: FixtureDocument) -> None:
    """MVP scope (SPEC.md Section 4): standard, unadjusted SPY calls, x100,
    expiring at least seven days after the session's local date."""
    check_contract_scope(doc.contracts, doc.underlying, doc.session.start, doc.session.timezone)


def check_contract_scope(contracts, underlying: str, session_start: str, session_timezone: str) -> None:
    """Contract scope check shared by fixtures and event-stream datasets."""
    session_date = parse_utc(session_start).astimezone(ZoneInfo(session_timezone)).date()
    problems = []
    for c in contracts:
        where = f"contract {c.contract_id}"
        if c.underlying != underlying:
            problems.append(f"{where}: underlying {c.underlying} is not the fixture underlying {underlying}")
        if c.option_type != "CALL":
            problems.append(f"{where}: only CALL contracts are supported")
        if c.adjusted:
            problems.append(f"{where}: adjusted contracts are not supported")
        if c.multiplier != 100:
            problems.append(f"{where}: multiplier must be 100")
        if c.deliverable != f"100_{c.underlying}_SHARES":
            problems.append(f"{where}: non-standard deliverable {c.deliverable}")
        if date.fromisoformat(c.expiration_date) - session_date < timedelta(days=MIN_DAYS_BEFORE_EXPIRATION):
            problems.append(f"{where}: expires less than {MIN_DAYS_BEFORE_EXPIRATION} days after the session")
    if problems:
        raise FixtureValidationError("; ".join(problems))


def parse_fixture(text: str) -> FixtureDocument:
    """Parse and fully validate fixture text: JSON, checksum, structure, scope."""
    try:
        raw = json.loads(text)
    except json.JSONDecodeError as exc:
        raise FixtureValidationError(f"fixture is not valid JSON: {exc}") from exc
    if not isinstance(raw, dict):
        raise FixtureValidationError("fixture must be a JSON object")
    declared = raw.get("checksum")
    actual = compute_checksum(raw)
    if declared != actual:
        raise FixtureValidationError(
            f"checksum mismatch: fixture declares {declared!r} but its content hashes to {actual!r}"
        )
    try:
        doc = FixtureDocument.model_validate(raw)
    except ValidationError as exc:
        raise FixtureValidationError(f"invalid fixture: {exc}") from exc
    if doc.source != FIXTURE_SOURCE:
        raise FixtureValidationError(f"unregistered fixture source {doc.source!r}")
    validate_contract_scope(doc)
    return doc


def read_fixture_file(path: Path) -> tuple[FixtureDocument, str]:
    """Return the validated document and its canonical JSON (what gets stored)."""
    text = Path(path).read_text(encoding="utf-8")
    doc = parse_fixture(text)
    return doc, canonical_json(json.loads(text))


def bundled_fixtures() -> dict[str, Path]:
    """Fixtures shipped in paper-trading/fixtures/, keyed by fixture_id."""
    found = {}
    for path in sorted(FIXTURES_DIR.glob("*.json")):
        fixture_id = json.loads(path.read_text(encoding="utf-8")).get("fixture_id")
        if isinstance(fixture_id, str):
            found[fixture_id] = path
    return found
