"""FA-1a: data class at intake, and quote provenance times (owner decision 4).

observed_at (market observation time) is the only time used for freshness.
snapshot_at / ingested_at are stored for audit and can never make stale or
missing data look fresh.
"""

import random
import sqlite3
from datetime import datetime, timezone

import pytest

from dataset_helpers import WORKED_CONTRACTS, store_kwargs, worked_events
from paper_trading.app import queries, replay
from paper_trading.app.coordinator import init_sample
from paper_trading.market_data.datasets import store_dataset
from paper_trading.market_data.intake import IntakeContext, validate_quote_input
from paper_trading.storage.migrator import migrate

CLOCK = datetime(2026, 9, 29, 14, 0, 10, tzinfo=timezone.utc)


def ctx(accepted=(), expected_is_sample=True):
    return IntakeContext(
        clock=CLOCK, session_start=datetime(2026, 9, 29, 13, 30, tzinfo=timezone.utc),
        session_end=datetime(2026, 9, 29, 20, tzinfo=timezone.utc), source="synthetic_fixture_v1",
        contract_ids=frozenset({"C"}), session_reference_cents=59700,
        accepted_sequences=frozenset(accepted), expected_is_sample=expected_is_sample)


def raw(**over):
    r = {"source": "synthetic_fixture_v1", "is_sample": True, "source_sequence": 5, "contract_id": "C",
         "observed_at": "2026-09-29T14:00:09Z", "bid_cents": 390, "ask_cents": 400, "bid_size": 1, "ask_size": 1,
         "underlying_price_cents": 60000, "underlying_observed_at": "2026-09-29T14:00:09Z"}
    r.update(over)
    return r


def test_provenance_times_are_optional_and_accepted_when_consistent():
    v = validate_quote_input(raw(snapshot_at="2026-09-29T14:00:10Z", ingested_at="2026-09-30T02:00:00Z"), ctx())
    assert v.accepted and v.fields["snapshot_at"] == "2026-09-29T14:00:10Z"


def test_a_fresh_snapshot_never_refreshes_a_stale_observation():
    # Observed 5 s before the clock, but packaged in a snapshot stamped at the clock: still stale.
    v = validate_quote_input(raw(observed_at="2026-09-29T14:00:05Z", snapshot_at="2026-09-29T14:00:10Z"), ctx())
    assert v.reasons == ("STALE_QUOTE",)


@pytest.mark.parametrize("over, reason", [
    ({"snapshot_at": "2026-09-29T14:00:08Z"}, "INCONSISTENT_PROVENANCE_TIME"),   # snapshot before observation
    ({"ingested_at": "2026-09-29T14:00:08Z"}, "INCONSISTENT_PROVENANCE_TIME"),   # recorded before it happened
    ({"snapshot_at": "2026-09-29T14:00:11Z"}, "FUTURE_SNAPSHOT"),                # snapshot from the future
    ({"snapshot_at": "yesterday"}, "INVALID_TIMESTAMP"),
    ({"snapshot_at": 5}, "INVALID_TYPE"),
])
def test_inconsistent_provenance_times_are_rejected(over, reason):
    assert reason in validate_quote_input(raw(**over), ctx()).reasons


def test_data_class_is_checked_both_ways():
    assert validate_quote_input(raw(is_sample=False), ctx()).reasons == ("NOT_SAMPLE_DATA",)
    assert validate_quote_input(raw(is_sample=True), ctx(expected_is_sample=False)).reasons == (
        "DATA_CLASS_MISMATCH",)
    assert validate_quote_input(raw(is_sample=False), ctx(expected_is_sample=False)).accepted


class Indexed:
    """Stand-in for the replay engine's index-backed view."""

    def __init__(self, values):
        self.values = set(values)

    def __contains__(self, s):
        return s in self.values

    def highest(self):
        return max(self.values, default=None)


def test_index_backed_sequences_decide_exactly_like_a_set():
    rng = random.Random(7)
    for _ in range(300):
        accepted = set(rng.sample(range(50), rng.randint(0, 10)))
        seq = rng.randint(0, 55)
        base = ctx(accepted)
        view = IntakeContext(**{**base.__dict__, "accepted_sequences": Indexed(accepted)})
        assert validate_quote_input(raw(source_sequence=seq), base).reasons == \
            validate_quote_input(raw(source_sequence=seq), view).reasons


def test_provenance_times_are_stored_beside_the_quote(settings):
    from paper_trading.storage.db import connect

    conn = connect(settings.db_path, create=True)
    migrate(conn)
    events = worked_events()
    events[1]["input"].update(snapshot_at="2026-09-29T14:00:00Z", ingested_at="2026-09-29T14:00:00.250Z")
    store_dataset(conn, **store_kwargs("prov", events, contracts=WORKED_CONTRACTS))
    run = init_sample(conn, settings, trading=True)
    replay.attach_dataset(conn, run.run_id, "prov", "1.0.0")
    replay.start_trading(conn, run.run_id, "p-start")
    replay.run_to_end(conn, run.run_id, "p-all")
    quotes = queries.list_quotes(conn, run.run_id)
    assert (quotes[0].snapshot_at, quotes[0].ingested_at) == ("2026-09-29T14:00:00Z", "2026-09-29T14:00:00.250Z")
    assert all(q.snapshot_at is None for q in quotes[1:])
    # The database refuses a provenance time earlier than the observation, and edits.
    with pytest.raises(sqlite3.IntegrityError, match="must not precede"):
        conn.execute("INSERT INTO quote_provenance VALUES (?, '2026-09-29T13:00:00Z', NULL)", (quotes[1].quote_id,))
    with pytest.raises(sqlite3.IntegrityError, match="immutable"):
        conn.execute("UPDATE quote_provenance SET snapshot_at = snapshot_at")
    conn.close()
