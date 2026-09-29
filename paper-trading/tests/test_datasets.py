"""FA-1a: stored datasets, manifests, data classes, and provenance honesty."""

import json
import sqlite3

import pytest

from conftest import WORKED_FIXTURE, load_path
from dataset_helpers import (
    LABEL,
    WORKED_CONTRACTS,
    STREAM_SOURCE,
    store_kwargs,
    synthetic_manifest,
    worked_events,
)
from paper_trading.accounting import compute_snapshot, reconcile
from paper_trading.app import queries, replay
from paper_trading.app.coordinator import init_sample
from paper_trading.market_data import datasets
from paper_trading.market_data.datasets import (
    DatasetConflictError,
    DatasetValidationError,
    fixture_manifest,
    store_dataset,
)
from paper_trading.market_data.fixtures import FixtureValidationError, read_fixture_file
from paper_trading.storage.db import connect
from paper_trading.storage.migrator import migrate

@pytest.fixture
def conn(settings):
    """A fully migrated database (the shared fixture leaves schema creation to init_sample)."""
    c = connect(settings.db_path, create=True)
    migrate(c)
    yield c
    c.close()


def kwargs(dataset_id="stream_worked", events=None, **over):
    return store_kwargs(dataset_id, worked_events() if events is None else events, contracts=WORKED_CONTRACTS,
                        **over)


def trading_run(conn, settings, key):
    init = init_sample(conn, settings.model_copy(update={"sample_run_key": key}), trading=True)
    return init.run_id, init.account_id


def run_all(conn, run_id, prefix):
    replay.start_trading(conn, run_id, f"{prefix}-start")
    replay.run_to_end(conn, run_id, f"{prefix}-all")


def outcome(conn, run_id, account_id):
    snap = compute_snapshot(conn, account_id)
    trades = [(t.realized_pnl_cents, t.exit_reason) for t in queries.list_closed_trades(conn, run_id)]
    events = [e["event_type"] for e in queries.list_run_events(conn, run_id)]
    return snap.cash_cents, snap.equity_cents, snap.fees_paid_cents, trades, events


# --- same economics through either storage path ---------------------------------


def test_event_stream_dataset_reproduces_the_worked_example(conn, settings):
    fx_run, fx_acct = trading_run(conn, settings, "via-fixture")
    load_path(conn, fx_run, WORKED_FIXTURE)
    run_all(conn, fx_run, "fx")

    stored = store_dataset(conn, **kwargs())
    assert stored.created and stored.event_count == 6
    ds_run, ds_acct = trading_run(conn, settings, "via-stream")
    replay.attach_dataset(conn, ds_run, "stream_worked", "1.0.0")
    run_all(conn, ds_run, "ds")

    a, b = outcome(conn, fx_run, fx_acct), outcome(conn, ds_run, ds_acct)
    assert a == b
    assert a[:4] == (10_007_870, 10_007_870, 130, [(7_870, "PROFIT_TARGET")])
    assert reconcile(conn, fx_run).ok and reconcile(conn, ds_run).ok


def test_store_is_streaming_idempotent_and_versioned(conn):
    first = store_dataset(conn, **kwargs(events=iter(worked_events())))  # any iterable, e.g. a generator
    again = store_dataset(conn, **kwargs())
    assert first.created and not again.created and again.checksum == first.checksum
    changed = worked_events()
    changed[1]["input"]["bid_cents"] = 391
    with pytest.raises(DatasetConflictError, match="new dataset_version"):
        store_dataset(conn, **kwargs(events=changed))
    assert store_dataset(conn, **kwargs(events=changed, version="1.0.1",
                                        manifest=synthetic_manifest("stream_worked", "1.0.1"))).created
    assert conn.execute("SELECT COUNT(*) FROM datasets").fetchone()[0] == 2


def test_failed_store_writes_nothing(conn):
    events = worked_events()
    events.insert(3, {"event_type": "QUOTE", "at": "2026-09-29T13:00:00Z", "input": {}})  # time goes backward
    with pytest.raises(DatasetValidationError, match="non-decreasing"):
        store_dataset(conn, **kwargs(events=events))
    for table in ("datasets", "dataset_events", "dataset_manifests"):
        assert conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0] == 0


@pytest.mark.parametrize("mutate, message", [
    (lambda e: e.append({"event_type": "QUOTE", "at": "2026-09-29T20:00:00Z", "input": {}}), "follows SESSION_CLOSE"),
    (lambda e: e.pop(0), "first event must be SESSION_OPEN"),
    (lambda e: e.pop(), "last event must be SESSION_CLOSE"),
    (lambda e: e[1].pop("input"), "QUOTE events require input"),
    (lambda e: e[1].update(extra=1), "must be an object"),
    (lambda e: e[1].update(at="2026-09-29 14:00:00"), "RFC 3339"),
])
def test_event_structure_is_validated(conn, mutate, message):
    events = worked_events()
    mutate(events)
    with pytest.raises(DatasetValidationError, match=message):
        store_dataset(conn, **kwargs(events=events))


# --- manifests and data classes ------------------------------------------------------


@pytest.mark.parametrize("over, message", [
    ({"manifest": synthetic_manifest("stream_worked", vendor="SomeVendor")}, "real-observation fields"),
    ({"manifest": synthetic_manifest("stream_worked", raw_files=[])}, "real-observation fields"),
    ({"manifest": {**synthetic_manifest("stream_worked"), "generator": None}}, "name its generator"),
    ({"manifest": synthetic_manifest("stream_worked", label="SAMPLE DATA"), "label": "SAMPLE DATA"},
     "must say SYNTHETIC"),
    ({"manifest": synthetic_manifest("stream_worked", label="SYNTHETIC HISTORICAL REPLAY"),
      "label": "SYNTHETIC HISTORICAL REPLAY"}, "must not say HISTORICAL"),
    ({"manifest": synthetic_manifest("stream_worked", source="vendor_feed"), "source": "vendor_feed"},
     "unregistered synthetic source"),
    ({"manifest": synthetic_manifest("other_id")}, "manifest dataset_id"),
    ({"label": "SYNTHETIC but different"}, "manifest label"),
])
def test_synthetic_manifest_must_be_honest(conn, over, message):
    with pytest.raises(DatasetValidationError, match=message):
        store_dataset(conn, **kwargs(**over))


def test_historical_datasets_are_refused_until_an_importer_is_approved(conn):
    manifest = {
        "manifest_schema_version": "1.0", "dataset_id": "h", "dataset_version": "1", "data_class": "HISTORICAL",
        "source": "vendor_x_v1", "label": "HISTORICAL MARKET DATA", "description": "d",
        "checksum_scheme": "event_stream_v1", "calendar_id": "xnys_2023_2026_v1",
    }
    assert datasets.APPROVED_HISTORICAL_IMPORTERS == {}
    with pytest.raises(DatasetValidationError) as exc:
        store_dataset(conn, **kwargs("h", version="1", data_class="HISTORICAL", source="vendor_x_v1",
                                     label="HISTORICAL MARKET DATA", manifest=manifest,
                                     calendar_id="xnys_2023_2026_v1"))
    text = str(exc.value)
    assert "no historical importer is approved" in text
    for field in ("vendor", "raw_files", "retrieved_at", "license_reference", "importer", "time_semantics",
                  "price_conversion", "coverage"):
        assert field in text
    assert conn.execute("SELECT COUNT(*) FROM datasets").fetchone()[0] == 0


def test_database_refuses_dishonest_labels_and_sources(conn):
    store_dataset(conn, **kwargs())
    row = dict(conn.execute("SELECT * FROM datasets").fetchone())
    conn.execute("DROP TRIGGER tr_datasets_seal")  # isolate the CHECK constraint
    for change in ({"label": "HISTORICAL SPY DATA", "data_class": "SYNTHETIC"},
                   {"label": "SYNTHETIC SAMPLE", "source": "vendor_feed"},
                   {"label": "SYNTHETIC SAMPLE", "data_class": "HISTORICAL"},
                   {"label": "HISTORICAL DATA", "data_class": "HISTORICAL", "source": "synthetic_stream_v1"}):
        bad = {**row, **change, "dataset_version": "x", "checksum": "sha256:" + "1" * 64}
        with pytest.raises(sqlite3.IntegrityError, match="CHECK"):
            conn.execute(f"INSERT INTO datasets ({', '.join(bad)}) VALUES ({', '.join('?' * len(bad))})",
                         tuple(bad.values()))


def test_database_refuses_synthetic_manifest_with_vendor_fields(conn):
    m = synthetic_manifest("z", vendor="V")
    with pytest.raises(sqlite3.IntegrityError, match="CHECK"):
        conn.execute("INSERT INTO dataset_manifests VALUES (?,?,?,?,?,?)",
                     ("sha256:" + "2" * 64, "z", "1.0.0", "SYNTHETIC", json.dumps(m), "2026-09-29T00:00:00Z"))


def test_stored_datasets_are_immutable_and_sealed(conn):
    store_dataset(conn, **kwargs())
    for sql, message in (
        ("UPDATE datasets SET label = 'SYNTHETIC x'", "immutable"),
        ("DELETE FROM datasets", "immutable"),
        ("UPDATE dataset_events SET at = at", "immutable"),
        ("DELETE FROM dataset_events", "immutable"),
        ("UPDATE dataset_manifests SET stored_at = stored_at", "immutable"),
        ("INSERT INTO dataset_events VALUES ('stream_worked','1.0.0',7,'SESSION_CLOSE','2026-09-29T20:00:00Z',"
         "NULL,NULL)", "sealed"),
    ):
        with pytest.raises(sqlite3.IntegrityError, match=message):
            conn.execute(sql)


def test_run_mode_and_dataset_class_must_match(conn, settings):
    store_dataset(conn, **kwargs())
    hist = init_sample(conn, settings.model_copy(update={"sample_run_key": "hist"}), mode="HISTORICAL_PAPER")
    with pytest.raises(replay.FixtureConflictError, match="SYNTHETIC cannot be replayed by a HISTORICAL_PAPER"):
        replay.attach_dataset(conn, hist.run_id, "stream_worked", "1.0.0")
    with pytest.raises(replay.FixtureConflictError, match="HISTORICAL_PAPER"):
        load_path(conn, hist.run_id, WORKED_FIXTURE)
    # The database enforces it too.
    with pytest.raises(sqlite3.IntegrityError, match="data class does not match the run mode"):
        conn.execute("""INSERT INTO replay_state VALUES (?, 'stream_worked', '1.0.0', 'ACTIVE', 1, 6,
                        '2026-09-29T00:00:00Z', '2026-09-29T00:00:00Z')""", (hist.run_id,))
    assert queries.get_replay_state(conn, hist.run_id) is None


def test_quotes_must_match_the_run_data_class(conn, worked, key):
    replay.step(conn, worked.run_id, key())
    replay.step(conn, worked.run_id, key())
    q = dict(conn.execute("SELECT * FROM market_quotes").fetchone())
    q.update(quote_id="forged", is_sample=0, source_sequence=999)
    with pytest.raises(sqlite3.IntegrityError, match="quote data class must match its run"):
        conn.execute(f"INSERT INTO market_quotes ({', '.join(q)}) VALUES ({', '.join('?' * len(q))})",
                     tuple(q.values()))
    with pytest.raises(sqlite3.IntegrityError, match="data class is fixed"):
        conn.execute("UPDATE runs SET is_sample = 0, mode = 'HISTORICAL_PAPER'")


def test_run_mode_and_sample_flag_agree(conn, initialized):
    copy = """INSERT INTO runs SELECT 'r2', 'k2', init_payload_hash, schema_version, ?, ?,
                  status, created_at, currency, starting_cash_cents, strategy_id, strategy_version,
                  risk_policy_version, execution_model_version, fee_schedule_version, fee_per_contract_cents,
                  entry_risk_limit_cents, session_timezone, session_start, session_end, simulated_clock,
                  session_reference_cents, fixture_id, fixture_version, fixture_checksum,
                  checkpoint_event_sequence, trading_enabled, status_reason FROM runs"""
    for mode, is_sample in (("HISTORICAL_PAPER", 1), ("SAMPLE_PAPER", 0), ("LIVE", 0)):
        with pytest.raises(sqlite3.IntegrityError, match="CHECK"):
            conn.execute(copy, (mode, is_sample))


# --- metadata shown to people ----------------------------------------------------------


def test_synthetic_stream_is_reported_as_synthetic_everywhere(conn, settings):
    store_dataset(conn, **kwargs())
    run_id, _ = trading_run(conn, settings, "labels")
    replay.attach_dataset(conn, run_id, "stream_worked", "1.0.0")
    run_all(conn, run_id, "labels")
    state = queries.get_replay_state(conn, run_id)
    assert (state["data_class"], state["source"], state["data_label"]) == ("SYNTHETIC", STREAM_SOURCE, LABEL)
    assert state["provenance"]["kind"] == "SYNTHETIC" and state["provenance"]["generator"]["name"]
    assert "vendor" not in state["provenance"]
    loaded = [e for e in queries.list_run_events(conn, run_id) if e["event_type"] == "FIXTURE_LOADED"][0]
    assert loaded["payload"]["data_class"] == "SYNTHETIC"
    assert {q.is_sample for q in queries.list_quotes(conn, run_id)} == {True}
    run = queries.get_run(conn, "labels")
    assert (run.mode, run.is_sample) == ("SAMPLE_PAPER", True)


def test_fixture_datasets_record_the_same_manifest_as_the_migration(conn, worked):
    doc, _ = read_fixture_file(WORKED_FIXTURE)
    stored = json.loads(conn.execute("SELECT manifest_json FROM dataset_manifests").fetchone()[0])
    assert stored == fixture_manifest(doc)
    row = conn.execute("SELECT checksum, checksum_scheme, data_class FROM datasets").fetchone()
    assert tuple(row) == (doc.checksum, "fixture_document_v1", "SYNTHETIC")


# --- integrity ------------------------------------------------------------------------


def test_tampered_stream_event_detected_after_restart(conn, settings):
    store_dataset(conn, **kwargs())
    run_id, _ = trading_run(conn, settings, "tamper")
    replay.attach_dataset(conn, run_id, "stream_worked", "1.0.0")
    replay.start_trading(conn, run_id, "tamper-start")
    conn.execute("DROP TRIGGER tr_dataset_events_no_update")
    conn.execute("UPDATE dataset_events SET input_json = json_set(input_json, '$.bid_cents', 1) WHERE position = 3")
    replay._parse_stored.cache_clear()  # a restarted process verifies the dataset again
    with pytest.raises(FixtureValidationError, match="checksum mismatch"):
        replay.step(conn, run_id, "tamper-step")
    assert queries.get_replay_state(conn, run_id)["processed_events"] == 0


def test_tampered_stream_header_detected(conn, settings):
    store_dataset(conn, **kwargs())
    run_id, _ = trading_run(conn, settings, "tamper-h")
    replay.attach_dataset(conn, run_id, "stream_worked", "1.0.0")
    replay.start_trading(conn, run_id, "tamper-h-start")
    conn.execute("DROP TRIGGER tr_datasets_no_update")
    conn.execute("UPDATE datasets SET session_reference_cents = 59000")
    replay._parse_stored.cache_clear()
    with pytest.raises(FixtureValidationError, match="checksum mismatch"):
        replay.step(conn, run_id, "tamper-h-step")


def test_dataset_survives_restart_and_reverifies(settings):
    c1 = connect(settings.db_path, create=True)
    migrate(c1)
    store_dataset(c1, **kwargs())
    run_id, acct = trading_run(c1, settings, "restart")
    replay.attach_dataset(c1, run_id, "stream_worked", "1.0.0")
    replay.start_trading(c1, run_id, "r-start")
    replay.step(c1, run_id, "r-1")
    replay.step(c1, run_id, "r-2")
    c1.close()
    replay._parse_stored.cache_clear()
    c2 = connect(settings.db_path)
    replay.run_to_end(c2, run_id, "r-end")
    assert compute_snapshot(c2, acct).cash_cents == 10_007_870 and reconcile(c2, run_id).ok
    c2.close()
