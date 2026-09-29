"""FA-1a: upgrading a database created by the Step 7 code (migration 0004).

tests/fixtures/step7_database.sql is a dump of a real Step 7 database: a
replay-only run (exhausted), a completed trading run, and a trading run left
RUNNING with an open position after 3 of 6 events.
"""

import json
import sqlite3
from pathlib import Path

import pytest

from conftest import WORKED_FIXTURE, load_path, make_settings
from paper_trading.accounting import compute_snapshot, reconcile
from paper_trading.app import queries, replay
from paper_trading.app.coordinator import init_sample
from paper_trading.market_data.datasets import fixture_manifest
from paper_trading.market_data.fixtures import read_fixture_file
from paper_trading.storage import migrator
from paper_trading.storage.db import connect

DUMP = Path(__file__).resolve().parent / "fixtures" / "step7_database.sql"
REBUILT = ("runs", "market_quotes", "replay_state")


def step7_db(path: Path) -> Path:
    raw = sqlite3.connect(path)
    raw.executescript(DUMP.read_text(encoding="utf-8"))
    raw.close()
    return path


def snapshot(conn) -> dict:
    """Every row of every Step 7 table, keyed by table, in a stable order."""
    tables = [r[0] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' "
        "AND name NOT IN ('datasets', 'dataset_events', 'dataset_manifests', 'quote_provenance') ORDER BY name")]
    out = {}
    for t in tables:
        cols = [r[1] for r in conn.execute(f"PRAGMA table_info({t})")]
        out[t] = sorted(tuple(r) for r in conn.execute(f"SELECT {', '.join(cols)} FROM {t}"))
    return out


@pytest.fixture
def upgraded(tmp_path):
    path = step7_db(tmp_path / "step7.sqlite3")
    before_conn = sqlite3.connect(path)
    before = snapshot(before_conn)
    triggers_before = {r[0]: r[1] for r in before_conn.execute(
        "SELECT name, sql FROM sqlite_master WHERE type IN ('trigger', 'index') AND sql IS NOT NULL")}
    before_conn.close()
    conn = connect(path)
    assert migrator.status(conn)[0] == 3
    assert migrator.migrate(conn) == [4]
    yield conn, before, triggers_before, path
    conn.close()


def test_every_record_is_preserved(upgraded):
    conn, before, _, _ = upgraded
    after = snapshot(conn)
    after_rows = {t: rows for t, rows in after.items() if t != "schema_migrations"}
    before_rows = {t: rows for t, rows in before.items() if t != "schema_migrations"}
    assert after_rows == before_rows  # same tables, same columns, same values, including rebuilt tables
    assert [r[:3] for r in after["schema_migrations"]][:3] == [r[:3] for r in before["schema_migrations"]]
    assert conn.execute("PRAGMA foreign_key_check").fetchall() == []
    assert conn.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    assert conn.execute("PRAGMA foreign_keys").fetchone()[0] == 1


def test_every_trigger_and_index_is_kept_verbatim(upgraded):
    conn, _, triggers_before, _ = upgraded
    after = {r[0]: r[1] for r in conn.execute(
        "SELECT name, sql FROM sqlite_master WHERE type IN ('trigger', 'index') AND sql IS NOT NULL")}
    assert {k: after.get(k) for k in triggers_before} == triggers_before
    for new in ("tr_runs_data_class_fixed", "tr_quotes_data_class", "tr_replay_state_dataset_class",
                "tr_datasets_seal", "tr_dataset_events_append"):
        assert new in after


def test_results_and_reconciliation_are_unchanged(upgraded):
    conn, *_ = upgraded
    complete = queries.get_run(conn, "legacy-complete")
    assert complete.status == "COMPLETED" and (complete.mode, complete.is_sample) == ("SAMPLE_PAPER", True)
    assert reconcile(conn, complete.run_id).ok
    assert compute_snapshot(conn, queries.get_account(conn, complete.run_id).account_id).cash_cents == 10_007_870
    (trade,) = queries.list_closed_trades(conn, complete.run_id)
    assert (trade.realized_pnl_cents, trade.exit_reason) == (7_870, "PROFIT_TARGET")
    partial = queries.get_run(conn, "legacy-partial")
    assert partial.status == "RUNNING" and reconcile(conn, partial.run_id).ok
    legacy = queries.get_run(conn, "legacy-replay")
    state = queries.get_replay_state(conn, legacy.run_id)
    assert (state["status"], state["data_class"], state["processed_events"]) == ("EXHAUSTED", "SYNTHETIC", 12)


def test_backfilled_datasets_match_what_the_new_code_stores(upgraded):
    conn, *_ = upgraded
    doc, _ = read_fixture_file(WORKED_FIXTURE)
    row = conn.execute(
        """SELECT d.*, m.manifest_json FROM datasets d JOIN dataset_manifests m USING (manifest_checksum)
            WHERE d.dataset_id = ?""", (doc.fixture_id,)).fetchone()
    assert json.loads(row["manifest_json"]) == fixture_manifest(doc)
    assert (row["checksum"], row["checksum_scheme"], row["data_class"], row["label"]) == (
        doc.checksum, "fixture_document_v1", "SYNTHETIC", doc.data_label)
    replay._parse_stored.cache_clear()
    header = replay._parse_stored.get(conn, doc.fixture_id, doc.fixture_version)  # full verification passes
    assert header.event_count == len(doc.events)


def test_partially_replayed_run_resumes_to_the_worked_example(upgraded):
    conn, *_ = upgraded
    replay._parse_stored.cache_clear()
    partial = queries.get_run(conn, "legacy-partial")
    again = replay.step(conn, partial.run_id, "legacy-partial-step-2")  # a pre-upgrade key still replays
    assert again["idempotent_replay"] is True
    result = replay.run_to_end(conn, partial.run_id, "after-upgrade")
    assert result["steps_executed"] == 3
    acct = queries.get_account(conn, partial.run_id).account_id
    snap = compute_snapshot(conn, acct)
    assert (snap.cash_cents, snap.equity_cents) == (10_007_870, 10_007_870)
    assert queries.get_run(conn, "legacy-partial").status == "COMPLETED" and reconcile(conn, partial.run_id).ok


def test_new_runs_work_in_an_upgraded_database(upgraded, tmp_path):
    conn, _, _, path = upgraded
    settings = make_settings(tmp_path).model_copy(update={"db_path": path, "sample_run_key": "post-upgrade"})
    init = init_sample(conn, settings, trading=True)
    assert load_path(conn, init.run_id, WORKED_FIXTURE).created  # pinned to this new run
    replay.start_trading(conn, init.run_id, "pu-start")
    replay.run_to_end(conn, init.run_id, "pu-all")
    assert compute_snapshot(conn, init.account_id).cash_cents == 10_007_870
    assert conn.execute("SELECT COUNT(*) FROM datasets").fetchone()[0] == 2  # stored fixture reused


def test_upgrade_is_idempotent_and_refuses_edits(upgraded):
    conn, *_ = upgraded
    assert migrator.migrate(conn) == []
    assert migrator.require_current(conn) == 4


def test_failed_upgrade_leaves_the_step7_database_untouched(tmp_path):
    path = step7_db(tmp_path / "blocked.sqlite3")
    raw = sqlite3.connect(path)
    raw.execute("CREATE TABLE datasets (x)")  # makes 0004 fail partway through its transaction
    raw.commit()
    before = snapshot(raw)
    raw.close()
    conn = connect(path)
    with pytest.raises(migrator.MigrationError, match="migration 4_datasets_and_data_classes failed"):
        migrator.migrate(conn)
    assert migrator.status(conn)[0] == 3
    assert conn.execute("PRAGMA foreign_keys").fetchone()[0] == 1  # enforcement restored
    assert snapshot(conn) == before
    conn.close()
