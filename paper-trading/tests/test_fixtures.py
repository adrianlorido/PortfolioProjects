"""Fixture format, checksum, scope validation, and loading/pinning rules."""

from __future__ import annotations

import json
import sqlite3

import pytest

from paper_trading.app import queries, replay
from paper_trading.market_data.fixtures import (
    FixtureValidationError,
    bundled_fixtures,
    compute_checksum,
    parse_fixture,
    read_fixture_file,
)
from paper_trading.storage.db import connect

from conftest import INVALID_FIXTURE, WORKED_FIXTURE, fixture_variant, load_path, make_settings


def test_bundled_worked_fixture_matches_spec_example():
    doc, _ = read_fixture_file(WORKED_FIXTURE)
    assert doc.fixture_id == "sample_spy_worked_trade" and doc.fixture_version == "1.0.0"
    assert doc.source == "synthetic_fixture_v1" and doc.is_sample is True
    assert "SYNTHETIC" in doc.data_label
    assert doc.session.timezone == "America/New_York"
    assert (doc.session.start, doc.session.end) == ("2026-09-29T13:30:00Z", "2026-09-29T20:00:00Z")
    assert doc.session_reference_cents == 59700
    (c,) = doc.contracts
    assert (c.underlying, c.option_type, c.strike_cents, c.expiration_date, c.multiplier) == (
        "SPY", "CALL", 60000, "2026-10-30", 100)
    quotes = [e for e in doc.events if e.event_type == "QUOTE"]
    assert [(e.ref, e.at, e.input["bid_cents"], e.input["ask_cents"]) for e in quotes] == [
        ("q1", "2026-09-29T14:00:00Z", 390, 400),
        ("q2", "2026-09-29T14:00:01Z", 390, 400),
        ("q3", "2026-09-29T14:10:00Z", 480, 490),
        ("q4", "2026-09-29T14:10:01Z", 480, 490),
    ]
    assert quotes[0].input["underlying_price_cents"] == 60000  # SPY $600 vs $597 reference
    assert doc.checksum == compute_checksum(json.loads(WORKED_FIXTURE.read_text(encoding="utf-8")))


def test_bundled_registry_excludes_test_fixtures():
    assert set(bundled_fixtures()) == {"sample_spy_worked_trade"}


def test_checksum_ignores_formatting_but_not_values(tmp_path):
    compact = fixture_variant(tmp_path, lambda d: None, recompute=False, name="same.json")
    assert read_fixture_file(compact)[0].checksum == read_fixture_file(WORKED_FIXTURE)[0].checksum

    def tamper(d):
        d["events"][1]["input"]["ask_cents"] = 401

    with pytest.raises(FixtureValidationError, match="checksum mismatch"):
        read_fixture_file(fixture_variant(tmp_path, tamper, recompute=False))


@pytest.mark.parametrize("mutate, message", [
    (lambda d: d.update(source="live_feed"), "source"),
    (lambda d: d.update(is_sample=False), "is_sample"),
    (lambda d: d.update(data_label="Sample data"), "SYNTHETIC"),
    (lambda d: d["session"].update(timezone="UTC"), "timezone"),
    (lambda d: d["session"].update(start="2026-09-29T13:30:00+00:00"), "start"),
    (lambda d: d.update(session_reference_cents=0), "session_reference_cents"),
    (lambda d: d.update(surprise=True), "Extra inputs"),
    (lambda d: d["events"].pop(0), "SESSION_OPEN"),
    (lambda d: d["events"].pop(), "SESSION_CLOSE"),
    (lambda d: d["events"][2].update(at="2026-09-29T13:59:00Z"), "non-decreasing"),
    (lambda d: d["events"][1].pop("input"), "input"),
    (lambda d: d["contracts"].append(dict(d["contracts"][0])), "duplicate contract_id"),
])
def test_malformed_fixture_rejected(tmp_path, mutate, message):
    with pytest.raises(FixtureValidationError, match=message):
        read_fixture_file(fixture_variant(tmp_path, mutate))


@pytest.mark.parametrize("change, message", [
    ({"option_type": "PUT"}, "only CALL"),
    ({"adjusted": True}, "adjusted"),
    ({"multiplier": 10}, "multiplier must be 100"),
    ({"deliverable": "150_SPY_SHARES"}, "deliverable"),
    ({"underlying": "QQQ", "deliverable": "100_QQQ_SHARES"}, "underlying"),
    ({"expiration_date": "2026-10-05"}, "7 days"),
])
def test_unsupported_contract_scope_rejected(tmp_path, change, message):
    path = fixture_variant(tmp_path, lambda d: d["contracts"][0].update(change))
    with pytest.raises(FixtureValidationError, match=message):
        read_fixture_file(path)


def test_invalid_json_rejected():
    with pytest.raises(FixtureValidationError, match="not valid JSON"):
        parse_fixture("{not json")


def test_load_pins_fixture_to_run(conn, initialized, settings):
    result = load_path(conn, initialized.run_id, WORKED_FIXTURE)
    assert result.created and result.total_events == 6
    run = queries.get_run(conn, settings.sample_run_key)
    assert run.fixture_id == "sample_spy_worked_trade" and run.fixture_version == "1.0.0"
    assert run.fixture_checksum == result.checksum
    assert run.session_reference_cents == 59700
    assert run.status == "READY"  # no trading workflow has started
    state = queries.get_replay_state(conn, initialized.run_id)
    assert (state["status"], state["processed_events"], state["total_events"]) == ("ACTIVE", 0, 6)


def test_repeated_load_is_idempotent(conn, initialized):
    def counts():
        return [conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
                for t in ("fixtures", "option_contracts", "replay_state", "run_events")]

    first = load_path(conn, initialized.run_id, WORKED_FIXTURE)
    before = counts()
    second = load_path(conn, initialized.run_id, WORKED_FIXTURE)
    assert first.created and not second.created
    assert second.checksum == first.checksum
    assert counts() == before


def test_replacing_pinned_fixture_rejected(conn, worked, tmp_path):
    other = fixture_variant(tmp_path, lambda d: d.update(fixture_version="1.0.1"))
    with pytest.raises(replay.FixtureConflictError, match="new run"):
        load_path(conn, worked.run_id, other)
    with pytest.raises(replay.FixtureConflictError, match="new run"):
        load_path(conn, worked.run_id, INVALID_FIXTURE)
    assert queries.get_replay_state(conn, worked.run_id)["fixture_id"] == "sample_spy_worked_trade"


def test_same_version_different_content_rejected(conn, worked, tmp_path):
    # A second run tries to store different content under the same id/version.
    s2 = make_settings(tmp_path, sample_run_key="run-two")
    from paper_trading.app.coordinator import init_sample

    r2 = init_sample(conn, s2)
    edited = fixture_variant(tmp_path, lambda d: d.update(description="edited without a version bump"))
    with pytest.raises(replay.FixtureConflictError, match="new fixture_version"):
        load_path(conn, r2.run_id, edited)
    assert queries.get_replay_state(conn, r2.run_id) is None


def test_second_run_can_load_same_fixture(conn, worked, tmp_path):
    from paper_trading.app.coordinator import init_sample

    r2 = init_sample(conn, make_settings(tmp_path, sample_run_key="run-two"))
    assert load_path(conn, r2.run_id, WORKED_FIXTURE).created
    assert conn.execute("SELECT COUNT(*) FROM fixtures").fetchone()[0] == 1
    assert conn.execute("SELECT COUNT(*) FROM option_contracts").fetchone()[0] == 1


def test_session_mismatch_rejected(tmp_path):
    s = make_settings(tmp_path, session_end="2026-09-29T19:00:00Z")
    c = connect(s.db_path, create=True)
    from paper_trading.app.coordinator import init_sample

    r = init_sample(c, s)
    with pytest.raises(replay.FixtureConflictError, match="session_end"):
        load_path(c, r.run_id, WORKED_FIXTURE)
    assert queries.get_replay_state(c, r.run_id) is None
    c.close()


def test_pinned_fixture_protected_by_database(conn, worked):
    with pytest.raises(sqlite3.IntegrityError, match="pinned"):
        conn.execute("UPDATE runs SET fixture_checksum = 'sha256:' || hex(randomblob(32))")
    with pytest.raises(sqlite3.IntegrityError, match="pinned"):
        conn.execute("UPDATE runs SET session_reference_cents = 1")
    with pytest.raises(sqlite3.IntegrityError, match="immutable"):
        conn.execute("UPDATE fixtures SET content_json = '{}'")
    with pytest.raises(sqlite3.IntegrityError, match="immutable"):
        conn.execute("UPDATE option_contracts SET strike_cents = 1")


def test_stored_fixture_tampering_detected_on_replay(conn, worked, key):
    # Even if the stored copy were altered underneath (triggers dropped), replay re-verifies it.
    conn.execute("DROP TRIGGER tr_fixtures_no_update")
    conn.execute("UPDATE fixtures SET content_json = json_set(content_json, '$.description', 'x')")
    replay._parse_stored.cache_clear()
    with pytest.raises(FixtureValidationError, match="checksum mismatch"):
        replay.step(conn, worked.run_id, key())
