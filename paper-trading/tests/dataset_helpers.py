"""Builders for FA-1a dataset tests. All data is SYNTHETIC and labeled so."""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import Iterator, Optional

from trading_helpers import DAY, contract
from conftest import WORKED_FIXTURE

STREAM_SOURCE = "synthetic_stream_v1"
SESSION_START, SESSION_END = DAY + "13:30:00Z", DAY + "20:00:00Z"
WORKED_CONTRACTS = json.loads(WORKED_FIXTURE.read_text(encoding="utf-8"))["contracts"]
LABEL = "SYNTHETIC SAMPLE DATA - EVENT STREAM TEST - NOT REAL MARKET DATA"


def synthetic_manifest(dataset_id: str, version: str = "1.0.0", *, label: str = LABEL,
                       source: str = STREAM_SOURCE, calendar_id: Optional[str] = None, **extra) -> dict:
    m = {
        "manifest_schema_version": "1.0", "dataset_id": dataset_id, "dataset_version": version,
        "data_class": "SYNTHETIC", "source": source, "label": label,
        "description": "Synthetic test stream exercising the dataset interfaces.",
        "generator": {"name": "tests.dataset_helpers", "version": "1"},
        "checksum_scheme": "event_stream_v1", "calendar_id": calendar_id,
    }
    m.update(extra)
    return m


def worked_events(source: str = STREAM_SOURCE) -> list[dict]:
    """The worked-example fixture's events, re-sourced for an event-stream dataset."""
    events = json.loads(WORKED_FIXTURE.read_text(encoding="utf-8"))["events"]
    for e in events:
        if e.get("input"):
            e["input"]["source"] = source
    return events


def store_kwargs(dataset_id: str, events, *, version: str = "1.0.0", contracts=None, **over) -> dict:
    kw = dict(dataset_id=dataset_id, dataset_version=version, data_class="SYNTHETIC", source=STREAM_SOURCE,
              label=LABEL, session_start=SESSION_START, session_end=SESSION_END, session_reference_cents=59700,
              contracts=contracts or [contract()], events=events,
              manifest=synthetic_manifest(dataset_id, version))
    kw.update(over)
    return kw


def _ts(dt: datetime) -> str:
    s = dt.strftime("%Y-%m-%dT%H:%M:%S.%f").rstrip("0").rstrip(".")
    return s + "Z"


def large_contracts(n: int = 4) -> list[dict]:
    return [contract(f"SPY_20261030_C_{60000 + 100 * i}", strike=60000 + 100 * i) for i in range(n)]


def large_events(n_quotes: int, *, n_contracts: int = 4, source: str = STREAM_SOURCE) -> Iterator[dict]:
    """A generator of events: one trade near the start, a rejected input every 97th, a long tail."""
    start = datetime(2026, 9, 29, 14, tzinfo=timezone.utc)
    step = min(1.0, 5.5 * 3600 / n_quotes)
    yield {"event_type": "SESSION_OPEN", "at": SESSION_START, "ref": "open"}
    for k in range(n_quotes):
        t = _ts(start + timedelta(seconds=k * step))
        i = k % n_contracts
        if i == 0:
            bid, ask = (390, 400) if k < 40 * n_contracts else (480, 490)
        else:
            bid, ask = 300 - 20 * i, 310 - 20 * i
        if k % 97 == 50:
            bid, ask = ask + 5, ask
        yield {"event_type": "QUOTE", "at": t, "ref": f"q{k + 1}", "input": {
            "source": source, "is_sample": True, "source_sequence": k + 1,
            "contract_id": f"SPY_20261030_C_{60000 + 100 * i}", "observed_at": t, "bid_cents": bid,
            "ask_cents": ask, "bid_size": 10, "ask_size": 10, "underlying_price_cents": 60000,
            "underlying_observed_at": t, "session_reference_cents": 59700}}
    yield {"event_type": "SESSION_CLOSE", "at": SESSION_END, "ref": "close"}
