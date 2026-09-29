"""Stored datasets: immutable event streams with manifests and provenance (FA-1a).

A dataset is what a run replays. It is stored once, as rows, and read one
event at a time, so replay cost does not grow with the dataset's size.

- ``dataset_events``: the ordered events (position 1..N).
- ``datasets``: the sealed header (session, reference price, contracts, data
  class, source, label, event count, digests). Inserting it seals the dataset.
- ``dataset_manifests``: the provenance document, keyed by its checksum.

Two data classes (owner decision 2):
- ``SYNTHETIC``: generated or hand-authored sample data. The manifest names its
  generator and may never carry vendor, raw-file, retrieval, license, or
  importer fields. Synthetic data stays labeled synthetic, including when it
  exercises the historical-data interfaces.
- ``HISTORICAL``: real market observations. The manifest must name an approved
  importer, the vendor and vendor dataset, raw files with SHA-256 digests, the
  retrieval time, a license reference, the calendar, transformation rules,
  time semantics, and price conversion. **No importer is approved yet**
  (``APPROVED_HISTORICAL_IMPORTERS`` is empty), so historical datasets cannot be
  stored until FA-1b registers one after the owner's decisions.

Checksums (``"sha256:" + hex``, canonical JSON as in ``fixtures.canonical_json``):
- events digest: SHA-256 over one canonical JSON line per event,
  ``{"at","event_type","input","position","ref"}`` + ``"\\n"``, in position order;
- ``fixture_document_v1``: the dataset checksum is the fixture document's own
  checksum (legacy fixtures and bundled fixtures);
- ``event_stream_v1``: the dataset checksum is the SHA-256 of the canonical
  header, which includes the events digest and the manifest checksum.

Integrity is verified in full (every event row, the manifest, the header, and
for fixture datasets the stored document) the first time a process uses a
dataset; the verified header is then cached per process. Rows are also
protected by immutability triggers.
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
import threading
from collections import OrderedDict
from dataclasses import dataclass
from typing import Any, Iterable, Optional

from pydantic import ValidationError

from paper_trading.contracts.models import OptionContract
from paper_trading.contracts.types import parse_utc, validate_utc_timestamp
from paper_trading.market_data.calendar import CoverageReport, coverage_report, get_calendar
from paper_trading.market_data.fixtures import (
    FixtureDocument,
    FixtureValidationError,
    canonical_json,
    check_contract_scope,
    parse_fixture,
)
from paper_trading.storage.db import transaction

DATA_CLASSES = ("SYNTHETIC", "HISTORICAL")
SYNTHETIC_SOURCES = frozenset({"synthetic_fixture_v1", "synthetic_stream_v1"})
# name -> approved versions. Empty until FA-1b: no historical data can be stored.
APPROVED_HISTORICAL_IMPORTERS: dict[str, frozenset[str]] = {}
MANIFEST_SCHEMA_VERSION = "1.0"
# Fields that describe real-world observations; a synthetic manifest may not carry them.
OBSERVATION_FIELDS = ("vendor", "vendor_dataset", "raw_files", "retrieved_at", "license_reference", "importer")
HISTORICAL_REQUIRED = OBSERVATION_FIELDS + ("transformation_rules", "time_semantics", "price_conversion",
                                            "coverage")
_EVENT_KEYS = frozenset({"event_type", "at", "ref", "input"})
_INSERT_BATCH = 1000


class DatasetValidationError(FixtureValidationError):
    """A dataset, its events, or its manifest is malformed, dishonest, or fails verification."""


class DatasetConflictError(ValueError):
    """The dataset id and version are already stored with different content."""


class DatasetNotFoundError(LookupError):
    pass


@dataclass(frozen=True)
class DatasetHeader:
    dataset_id: str
    dataset_version: str
    checksum: str
    checksum_scheme: str
    events_digest: str
    data_class: str
    source: str
    label: str
    underlying: str
    session_timezone: str
    session_start: str
    session_end: str
    session_reference_cents: int
    calendar_id: Optional[str]
    contracts: tuple[OptionContract, ...]
    contract_ids: frozenset[str]
    event_count: int
    manifest_checksum: str
    manifest: dict

    @property
    def is_sample(self) -> bool:
        return self.data_class == "SYNTHETIC"


@dataclass(frozen=True)
class DatasetEvent:
    position: int
    event_type: str
    at: str
    ref: Optional[str]
    input: Any


@dataclass(frozen=True)
class StoreResult:
    dataset_id: str
    dataset_version: str
    checksum: str
    event_count: int
    created: bool
    coverage: Optional[CoverageReport] = None


# --- digests -----------------------------------------------------------------


def sha256_text(text: str) -> str:
    return "sha256:" + hashlib.sha256(text.encode("utf-8")).hexdigest()


def event_line(position: int, event_type: str, at: str, ref: Optional[str], input_: Any) -> str:
    return canonical_json({"position": position, "event_type": event_type, "at": at, "ref": ref,
                           "input": input_}) + "\n"


def stream_header(*, dataset_id, dataset_version, data_class, source, label, underlying, session_timezone,
                  session_start, session_end, session_reference_cents, calendar_id, contracts: list[dict],
                  event_count, events_digest, manifest_checksum) -> dict:
    return {
        "checksum_scheme": "event_stream_v1",
        "dataset_id": dataset_id, "dataset_version": dataset_version, "data_class": data_class,
        "source": source, "label": label, "underlying": underlying,
        "session": {"timezone": session_timezone, "start": session_start, "end": session_end},
        "session_reference_cents": session_reference_cents, "calendar_id": calendar_id,
        "contracts": contracts, "event_count": event_count, "events_digest": events_digest,
        "manifest_checksum": manifest_checksum,
    }


def fixture_manifest(doc: FixtureDocument) -> dict:
    """Manifest recorded for a synthetic fixture document (same as migration 0004's backfill)."""
    return {
        "manifest_schema_version": MANIFEST_SCHEMA_VERSION,
        "dataset_id": doc.fixture_id,
        "dataset_version": doc.fixture_version,
        "data_class": "SYNTHETIC",
        "source": doc.source,
        "label": doc.data_label,
        "description": doc.description,
        "generator": {"name": "hand_authored_fixture", "fixture_schema_version": doc.fixture_schema_version},
        "checksum_scheme": "fixture_document_v1",
        "document_checksum": doc.checksum,
        "calendar_id": None,
    }


# --- validation ----------------------------------------------------------------


def _label_problems(data_class: str, label: str, source: str) -> list[str]:
    up = label.upper()
    problems = []
    if data_class == "SYNTHETIC":
        if "SYNTHETIC" not in up or "HISTORICAL" in up:
            problems.append("a SYNTHETIC dataset label must say SYNTHETIC and must not say HISTORICAL")
        if source not in SYNTHETIC_SOURCES:
            problems.append(f"unregistered synthetic source {source!r}; registered: {sorted(SYNTHETIC_SOURCES)}")
    elif data_class == "HISTORICAL":
        if "HISTORICAL" not in up or "SYNTHETIC" in up:
            problems.append("a HISTORICAL dataset label must say HISTORICAL and must not say SYNTHETIC")
        if "synthetic" in source.lower():
            problems.append("a HISTORICAL dataset cannot use a synthetic source")
    else:
        problems.append(f"unknown data class {data_class!r}")
    return problems


def manifest_problems(manifest: Any, *, dataset_id: str, dataset_version: str, data_class: str, source: str,
                      label: str, checksum_scheme: str, calendar_id: Optional[str]) -> list[str]:
    """Every reason the manifest does not honestly describe this dataset (empty if none)."""
    if not isinstance(manifest, dict):
        return ["manifest must be a JSON object"]
    p: list[str] = []
    expect = {"manifest_schema_version": MANIFEST_SCHEMA_VERSION, "dataset_id": dataset_id,
              "dataset_version": dataset_version, "data_class": data_class, "source": source, "label": label,
              "checksum_scheme": checksum_scheme, "calendar_id": calendar_id}
    for k, v in expect.items():
        if manifest.get(k, ...) != v:
            p.append(f"manifest {k} must be {v!r}")
    if not isinstance(manifest.get("description"), str) or not manifest["description"].strip():
        p.append("manifest description is required")
    p.extend(_label_problems(data_class, label, source))

    if data_class == "SYNTHETIC":
        gen = manifest.get("generator")
        if not isinstance(gen, dict) or not isinstance(gen.get("name"), str) or not gen["name"]:
            p.append("a SYNTHETIC manifest must name its generator ({\"name\": ...})")
        present = [k for k in OBSERVATION_FIELDS if k in manifest]
        if present:
            p.append(f"a SYNTHETIC manifest must not carry real-observation fields {present}")
    elif data_class == "HISTORICAL":
        if "generator" in manifest:
            p.append("a HISTORICAL manifest must not name a synthetic generator")
        missing = [k for k in HISTORICAL_REQUIRED if k not in manifest or manifest[k] in (None, "", [], {})]
        if missing:
            p.append(f"a HISTORICAL manifest is missing {missing}")
        importer = manifest.get("importer")
        name = importer.get("name") if isinstance(importer, dict) else None
        version = importer.get("version") if isinstance(importer, dict) else None
        if version not in APPROVED_HISTORICAL_IMPORTERS.get(name, frozenset()):
            p.append(f"historical importer {name!r} version {version!r} is not approved; no historical "
                     "importer is approved yet (FA-1b), so historical datasets cannot be stored")
        raw_files = manifest.get("raw_files")
        if isinstance(raw_files, list):
            for i, f in enumerate(raw_files):
                ok = isinstance(f, dict) and isinstance(f.get("name"), str) and f["name"] and \
                    isinstance(f.get("sha256"), str) and len(f["sha256"]) == 64 and \
                    all(ch in "0123456789abcdef" for ch in f["sha256"]) and \
                    isinstance(f.get("bytes"), int) and not isinstance(f.get("bytes"), bool) and f["bytes"] >= 0
                if not ok:
                    p.append(f"raw_files[{i}] needs name, lowercase hex sha256, and bytes")
        if isinstance(manifest.get("retrieved_at"), str):
            try:
                validate_utc_timestamp(manifest["retrieved_at"])
            except ValueError:
                p.append("retrieved_at must be an RFC 3339 UTC timestamp")
        if calendar_id is None:
            p.append("a HISTORICAL dataset must name its exchange calendar")
        if checksum_scheme != "event_stream_v1":
            p.append("a HISTORICAL dataset must use checksum scheme event_stream_v1")
    return p


def _parse_contracts(contracts: Iterable[Any]) -> tuple[OptionContract, ...]:
    out = []
    for c in contracts:
        try:
            out.append(c if isinstance(c, OptionContract) else OptionContract.model_validate(c))
        except ValidationError as exc:
            raise DatasetValidationError(f"invalid contract: {exc}") from exc
    ids = [c.contract_id for c in out]
    if not out or len(set(ids)) != len(ids):
        raise DatasetValidationError("contracts must be non-empty with unique contract_id")
    return tuple(out)


class _EventChecker:
    """Streaming structure check: SESSION_OPEN at start, QUOTEs, SESSION_CLOSE at end, ordered times."""

    def __init__(self, session_start: str, session_end: str):
        self.start, self.end = parse_utc(session_start), parse_utc(session_end)
        self.count = 0
        self.previous = self.start
        self.closed = False
        self.last_type: Optional[str] = None

    def check(self, event: Any) -> DatasetEvent:
        self.count += 1
        n = self.count
        if not isinstance(event, dict) or not {"event_type", "at"} <= set(event) or set(event) - _EVENT_KEYS:
            raise DatasetValidationError(f"event {n} must be an object with event_type, at, optional ref/input")
        et, at, ref = event["event_type"], event["at"], event.get("ref")
        if et not in ("SESSION_OPEN", "QUOTE", "SESSION_CLOSE"):
            raise DatasetValidationError(f"event {n} has unknown event_type {et!r}")
        try:
            validate_utc_timestamp(at)
        except (ValueError, TypeError) as exc:
            raise DatasetValidationError(f"event {n}: {exc}") from exc
        if ref is not None and (not isinstance(ref, str) or not 0 < len(ref) <= 200):
            raise DatasetValidationError(f"event {n} ref must be a string of 1-200 characters")
        if (et == "QUOTE") != ("input" in event and event["input"] is not None):
            raise DatasetValidationError(f"event {n}: QUOTE events require input; boundaries carry none")
        if self.closed:
            raise DatasetValidationError(f"event {n} follows SESSION_CLOSE")
        t = parse_utc(at)
        if n == 1 and (et != "SESSION_OPEN" or t != self.start):
            raise DatasetValidationError("first event must be SESSION_OPEN at the session start")
        if n > 1 and et == "SESSION_OPEN":
            raise DatasetValidationError(f"event {n}: SESSION_OPEN may only be the first event")
        if t < self.previous:
            raise DatasetValidationError(f"event {n} is scheduled before event {n - 1}; times must be non-decreasing")
        if not self.start <= t <= self.end:
            raise DatasetValidationError(f"event {n} is scheduled outside the session")
        if et == "SESSION_CLOSE":
            if t != self.end:
                raise DatasetValidationError("SESSION_CLOSE must be at the session end")
            self.closed = True
        self.previous = t
        self.last_type = et
        return DatasetEvent(n, et, at, ref, event.get("input"))

    def finish(self) -> None:
        if self.count < 2 or not self.closed:
            raise DatasetValidationError("last event must be SESSION_CLOSE at the session end")


# --- storing -------------------------------------------------------------------


def _insert_events(conn, dataset_id, dataset_version, batch: list[DatasetEvent]) -> None:
    conn.executemany(
        """INSERT INTO dataset_events (dataset_id, dataset_version, position, event_type, at, ref, input_json)
           VALUES (?,?,?,?,?,?,?)""",
        [(dataset_id, dataset_version, e.position, e.event_type, e.at, e.ref,
          None if e.input is None else canonical_json(e.input)) for e in batch],
    )


def _insert_manifest(conn, checksum, dataset_id, dataset_version, data_class, manifest_json, now) -> None:
    conn.execute(
        """INSERT OR IGNORE INTO dataset_manifests (manifest_checksum, dataset_id, dataset_version, data_class,
               manifest_json, stored_at) VALUES (?,?,?,?,?,?)""",
        (checksum, dataset_id, dataset_version, data_class, manifest_json, now),
    )


def _insert_header(conn, *, dataset_id, dataset_version, checksum, scheme, events_digest, data_class, source,
                   label, underlying, tz, start, end, reference, calendar_id, contracts_json, event_count,
                   manifest_checksum, now) -> None:
    conn.execute(
        """INSERT INTO datasets (dataset_id, dataset_version, checksum, checksum_scheme, events_digest, data_class,
               source, label, underlying, session_timezone, session_start, session_end, session_reference_cents,
               calendar_id, contracts_json, event_count, manifest_checksum, stored_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (dataset_id, dataset_version, checksum, scheme, events_digest, data_class, source, label, underlying, tz,
         start, end, reference, calendar_id, contracts_json, event_count, manifest_checksum, now),
    )


def store_fixture_dataset(conn: sqlite3.Connection, doc: FixtureDocument, now: str) -> bool:
    """Store a validated fixture document as a SYNTHETIC dataset. Caller holds the transaction.

    Returns True if created, False if the identical dataset already exists.
    """
    existing = conn.execute("SELECT checksum FROM datasets WHERE dataset_id = ? AND dataset_version = ?",
                            (doc.fixture_id, doc.fixture_version)).fetchone()
    if existing is not None:
        if existing["checksum"] != doc.checksum:
            raise DatasetConflictError(
                f"dataset {doc.fixture_id} version {doc.fixture_version} is already stored with different content")
        return False
    manifest = fixture_manifest(doc)
    problems = manifest_problems(manifest, dataset_id=doc.fixture_id, dataset_version=doc.fixture_version,
                                 data_class="SYNTHETIC", source=doc.source, label=doc.data_label,
                                 checksum_scheme="fixture_document_v1", calendar_id=None)
    if problems:
        raise DatasetValidationError("; ".join(problems))
    digest = hashlib.sha256()
    batch = []
    for position, e in enumerate(doc.events, start=1):
        ev = DatasetEvent(position, e.event_type, e.at, e.ref, e.input)
        digest.update(event_line(position, ev.event_type, ev.at, ev.ref, ev.input).encode("utf-8"))
        batch.append(ev)
    _insert_events(conn, doc.fixture_id, doc.fixture_version, batch)
    manifest_json = canonical_json(manifest)
    manifest_checksum = sha256_text(manifest_json)
    _insert_manifest(conn, manifest_checksum, doc.fixture_id, doc.fixture_version, "SYNTHETIC", manifest_json, now)
    _insert_header(conn, dataset_id=doc.fixture_id, dataset_version=doc.fixture_version, checksum=doc.checksum,
                   scheme="fixture_document_v1", events_digest="sha256:" + digest.hexdigest(),
                   data_class="SYNTHETIC", source=doc.source, label=doc.data_label, underlying=doc.underlying,
                   tz=doc.session.timezone, start=doc.session.start, end=doc.session.end,
                   reference=doc.session_reference_cents, calendar_id=None,
                   contracts_json=canonical_json([c.model_dump() for c in doc.contracts]),
                   event_count=len(doc.events), manifest_checksum=manifest_checksum, now=now)
    return True


def store_dataset(conn: sqlite3.Connection, *, dataset_id: str, dataset_version: str, data_class: str,
                  source: str, label: str, session_start: str, session_end: str, session_reference_cents: int,
                  contracts: Iterable[Any], events: Iterable[dict], manifest: dict,
                  calendar_id: Optional[str] = None, underlying: str = "SPY",
                  session_timezone: str = "America/New_York", coverage_gap_seconds: Optional[float] = None,
                  now: Optional[str] = None) -> StoreResult:
    """Validate and store an event-stream dataset in one transaction (streaming, bounded memory).

    ``events`` may be any iterable (for example a generator reading a file);
    events are validated and inserted in batches, and nothing is kept in
    memory beyond one batch. The same id, version, and content again is a
    no-op; different content under the same id and version is a conflict.
    """
    from paper_trading.app.coordinator import utc_now  # local import: app depends on market_data

    now = now or utc_now()
    problems = manifest_problems(manifest, dataset_id=dataset_id, dataset_version=dataset_version,
                                 data_class=data_class, source=source, label=label,
                                 checksum_scheme="event_stream_v1", calendar_id=calendar_id)
    if problems:
        raise DatasetValidationError("; ".join(problems))
    if underlying != "SPY" or session_timezone != "America/New_York":
        raise DatasetValidationError("only SPY in America/New_York is supported")
    for name, value in (("dataset_id", dataset_id), ("dataset_version", dataset_version)):
        if not isinstance(value, str) or not 0 < len(value) <= 200:
            raise DatasetValidationError(f"{name} must be a string of 1-200 characters")
    if not isinstance(session_reference_cents, int) or isinstance(session_reference_cents, bool) \
            or session_reference_cents <= 0:
        raise DatasetValidationError("session_reference_cents must be a positive integer number of cents")
    for ts in (session_start, session_end):
        validate_utc_timestamp(ts)
    if parse_utc(session_end) <= parse_utc(session_start):
        raise DatasetValidationError("session end must be after session start")
    scheduled = None
    if calendar_id is not None:
        # Session boundaries come from the calendar, never from the data (decision 6).
        scheduled = get_calendar(calendar_id).validate_session(session_start, session_end)
    parsed_contracts = _parse_contracts(contracts)
    check_contract_scope(parsed_contracts, underlying, session_start, session_timezone)
    contracts_plain = [c.model_dump() for c in parsed_contracts]
    manifest_json = canonical_json(manifest)
    manifest_checksum = sha256_text(manifest_json)

    with transaction(conn):
        existing = conn.execute("SELECT checksum FROM datasets WHERE dataset_id = ? AND dataset_version = ?",
                                (dataset_id, dataset_version)).fetchone()
        checker = _EventChecker(session_start, session_end)
        digest = hashlib.sha256()
        batch: list[DatasetEvent] = []

        for raw in events:
            ev = checker.check(raw)
            digest.update(event_line(ev.position, ev.event_type, ev.at, ev.ref, ev.input).encode("utf-8"))
            if existing is None:
                batch.append(ev)
                if len(batch) >= _INSERT_BATCH:
                    _insert_events(conn, dataset_id, dataset_version, batch)
                    batch = []
        checker.finish()
        events_digest = "sha256:" + digest.hexdigest()
        header = stream_header(
            dataset_id=dataset_id, dataset_version=dataset_version, data_class=data_class, source=source,
            label=label, underlying=underlying, session_timezone=session_timezone, session_start=session_start,
            session_end=session_end, session_reference_cents=session_reference_cents, calendar_id=calendar_id,
            contracts=contracts_plain, event_count=checker.count, events_digest=events_digest,
            manifest_checksum=manifest_checksum)
        checksum = sha256_text(canonical_json(header))

        def coverage() -> Optional[CoverageReport]:
            # Streams the stored quote schedule; the calendar session is never adjusted to fit it.
            if scheduled is None or coverage_gap_seconds is None:
                return None
            times = (r[0] for r in conn.execute(
                """SELECT at FROM dataset_events WHERE dataset_id = ? AND dataset_version = ?
                      AND event_type = 'QUOTE' ORDER BY position""", (dataset_id, dataset_version)))
            return coverage_report(scheduled, times, gap_threshold_seconds=coverage_gap_seconds)

        if existing is not None:
            if existing["checksum"] != checksum:
                raise DatasetConflictError(
                    f"dataset {dataset_id} version {dataset_version} is already stored with different content; "
                    "publish the change as a new dataset_version")
            return StoreResult(dataset_id, dataset_version, checksum, checker.count, False, coverage())
        if batch:
            _insert_events(conn, dataset_id, dataset_version, batch)
        _insert_manifest(conn, manifest_checksum, dataset_id, dataset_version, data_class, manifest_json, now)
        _insert_header(conn, dataset_id=dataset_id, dataset_version=dataset_version, checksum=checksum,
                       scheme="event_stream_v1", events_digest=events_digest, data_class=data_class, source=source,
                       label=label, underlying=underlying, tz=session_timezone, start=session_start,
                       end=session_end, reference=session_reference_cents, calendar_id=calendar_id,
                       contracts_json=canonical_json(contracts_plain), event_count=checker.count,
                       manifest_checksum=manifest_checksum, now=now)
        return StoreResult(dataset_id, dataset_version, checksum, checker.count, True, coverage())


# --- reading and verification -------------------------------------------------------


def read_event(conn: sqlite3.Connection, dataset_id: str, dataset_version: str, position: int) -> DatasetEvent:
    """One event by primary key: O(log n), independent of how many events were replayed."""
    row = conn.execute(
        """SELECT position, event_type, at, ref, input_json FROM dataset_events
            WHERE dataset_id = ? AND dataset_version = ? AND position = ?""",
        (dataset_id, dataset_version, position),
    ).fetchone()
    if row is None:
        raise DatasetValidationError(f"dataset {dataset_id} {dataset_version} has no event {position}")
    return DatasetEvent(row["position"], row["event_type"], row["at"], row["ref"],
                        None if row["input_json"] is None else json.loads(row["input_json"]))


def verify_dataset(conn: sqlite3.Connection, dataset_id: str, dataset_version: str) -> DatasetHeader:
    """Full integrity and provenance check of a stored dataset. O(events); run once per process."""
    row = conn.execute("SELECT * FROM datasets WHERE dataset_id = ? AND dataset_version = ?",
                       (dataset_id, dataset_version)).fetchone()
    if row is None:
        raise DatasetNotFoundError(f"no stored dataset {dataset_id} {dataset_version}")
    where = f"dataset {dataset_id} {dataset_version}"

    if row["checksum_scheme"] == "fixture_document_v1":
        fx = conn.execute("SELECT content_json FROM fixtures WHERE fixture_id = ? AND fixture_version = ?",
                          (dataset_id, dataset_version)).fetchone()
        if fx is None:
            raise DatasetValidationError(f"{where}: its fixture document is missing")
        doc = parse_fixture(fx["content_json"])  # re-verifies the document checksum, structure, scope

    m = conn.execute("SELECT manifest_json FROM dataset_manifests WHERE manifest_checksum = ?",
                     (row["manifest_checksum"],)).fetchone()
    if m is None or sha256_text(m["manifest_json"]) != row["manifest_checksum"]:
        raise DatasetValidationError(f"{where}: manifest checksum mismatch")
    manifest = json.loads(m["manifest_json"])
    problems = manifest_problems(manifest, dataset_id=dataset_id, dataset_version=dataset_version,
                                 data_class=row["data_class"], source=row["source"], label=row["label"],
                                 checksum_scheme=row["checksum_scheme"], calendar_id=row["calendar_id"])
    if problems:
        raise DatasetValidationError(f"{where}: " + "; ".join(problems))

    digest = hashlib.sha256()
    checker = _EventChecker(row["session_start"], row["session_end"])
    for r in conn.execute(
        """SELECT position, event_type, at, ref, input_json FROM dataset_events
            WHERE dataset_id = ? AND dataset_version = ? ORDER BY position""", (dataset_id, dataset_version)
    ):
        input_ = None if r["input_json"] is None else json.loads(r["input_json"])
        event = {"event_type": r["event_type"], "at": r["at"], "ref": r["ref"]}
        if input_ is not None:
            event["input"] = input_
        ev = checker.check(event)
        if ev.position != r["position"]:
            raise DatasetValidationError(f"{where}: event positions are not contiguous")
        digest.update(event_line(r["position"], r["event_type"], r["at"], r["ref"], input_).encode("utf-8"))
    checker.finish()
    events_digest = "sha256:" + digest.hexdigest()
    if events_digest != row["events_digest"] or checker.count != row["event_count"]:
        raise DatasetValidationError(f"{where}: checksum mismatch in stored events")

    contracts = _parse_contracts(json.loads(row["contracts_json"]))
    check_contract_scope(contracts, row["underlying"], row["session_start"], row["session_timezone"])
    if row["checksum_scheme"] == "event_stream_v1":
        header = stream_header(
            dataset_id=dataset_id, dataset_version=dataset_version, data_class=row["data_class"],
            source=row["source"], label=row["label"], underlying=row["underlying"],
            session_timezone=row["session_timezone"], session_start=row["session_start"],
            session_end=row["session_end"], session_reference_cents=row["session_reference_cents"],
            calendar_id=row["calendar_id"], contracts=[c.model_dump() for c in contracts],
            event_count=row["event_count"], events_digest=events_digest,
            manifest_checksum=row["manifest_checksum"])
        if sha256_text(canonical_json(header)) != row["checksum"]:
            raise DatasetValidationError(f"{where}: checksum mismatch in dataset header")
        if row["calendar_id"] is not None:
            get_calendar(row["calendar_id"]).validate_session(row["session_start"], row["session_end"])
    else:
        doc_digest = hashlib.sha256()
        for i, e in enumerate(doc.events, start=1):
            doc_digest.update(event_line(i, e.event_type, e.at, e.ref, e.input).encode("utf-8"))
        same = (doc.checksum == row["checksum"] and "sha256:" + doc_digest.hexdigest() == events_digest
                and doc.source == row["source"] and doc.data_label == row["label"]
                and doc.underlying == row["underlying"] and doc.session.start == row["session_start"]
                and doc.session.end == row["session_end"] and doc.session.timezone == row["session_timezone"]
                and doc.session_reference_cents == row["session_reference_cents"]
                and list(doc.contracts) == list(contracts) and manifest == fixture_manifest(doc))
        if not same:
            raise DatasetValidationError(f"{where}: checksum mismatch between stored dataset and fixture document")

    return DatasetHeader(
        dataset_id=dataset_id, dataset_version=dataset_version, checksum=row["checksum"],
        checksum_scheme=row["checksum_scheme"], events_digest=events_digest, data_class=row["data_class"],
        source=row["source"], label=row["label"], underlying=row["underlying"],
        session_timezone=row["session_timezone"], session_start=row["session_start"],
        session_end=row["session_end"], session_reference_cents=row["session_reference_cents"],
        calendar_id=row["calendar_id"], contracts=contracts,
        contract_ids=frozenset(c.contract_id for c in contracts), event_count=row["event_count"],
        manifest_checksum=row["manifest_checksum"], manifest=manifest,
    )


class VerifiedDatasetCache:
    """Per-process cache of fully verified dataset headers, keyed by (id, version, checksum).

    The checksum is read on every lookup (one primary-key read), so a changed
    header is re-verified. Verification is O(events) and happens once per
    process per dataset; each replayed event is then read by primary key.
    """

    def __init__(self, maxsize: int = 16):
        self._items: OrderedDict[tuple[str, str, str], DatasetHeader] = OrderedDict()
        self._lock = threading.Lock()
        self._maxsize = maxsize

    def get(self, conn: sqlite3.Connection, dataset_id: str, dataset_version: str) -> DatasetHeader:
        row = conn.execute("SELECT checksum FROM datasets WHERE dataset_id = ? AND dataset_version = ?",
                           (dataset_id, dataset_version)).fetchone()
        if row is None:
            raise DatasetNotFoundError(f"no stored dataset {dataset_id} {dataset_version}")
        key = (dataset_id, dataset_version, row["checksum"])
        with self._lock:
            if key in self._items:
                self._items.move_to_end(key)
                return self._items[key]
        header = verify_dataset(conn, dataset_id, dataset_version)
        with self._lock:
            self._items[key] = header
            while len(self._items) > self._maxsize:
                self._items.popitem(last=False)
        return header

    def cache_clear(self) -> None:
        with self._lock:
            self._items.clear()


VERIFIED = VerifiedDatasetCache()
