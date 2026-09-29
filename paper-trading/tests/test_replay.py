"""Deterministic replay: stepping, validation outcomes, idempotency, atomicity, restart, determinism."""

from __future__ import annotations

import json
import sqlite3

import pytest

from paper_trading.accounting import compute_snapshot, ledger_cash_cents, reconcile
from paper_trading.app import queries, replay
from paper_trading.app.coordinator import IdempotencyConflictError, init_sample
from paper_trading.storage.db import connect

from conftest import INVALID_FIXTURE, WORKED_FIXTURE, load_path, make_settings

INVALID_EXPECTED = [
    # (position, fixture ref, outcome, reasons)
    (1, "open", "BOUNDARY", []),
    (2, "valid_1", "ACCEPTED", []),
    (3, "stale", "REJECTED", ["STALE_QUOTE"]),
    (4, "future", "REJECTED", ["FUTURE_OBSERVATION"]),
    (5, "crossed", "REJECTED", ["CROSSED_QUOTE"]),
    (6, "duplicate", "REJECTED", ["DUPLICATE_SEQUENCE"]),
    (7, "valid_5", "ACCEPTED", []),
    (8, "out_of_order", "REJECTED", ["OUT_OF_ORDER_SEQUENCE"]),
    (9, "missing_size", "REJECTED", ["MISSING_SIZE"]),
    (10, "reference_mismatch", "REJECTED", ["REFERENCE_PRICE_MISMATCH"]),
    (11, "valid_8_no_reference", "ACCEPTED", []),
    (12, "close", "BOUNDARY", []),
]


def table_counts(conn) -> dict:
    tables = ("market_quotes", "rejected_inputs", "replay_events", "run_events", "command_log")
    return {t: conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] for t in tables}


def clock(conn, run_id) -> str:
    return conn.execute("SELECT simulated_clock FROM runs WHERE run_id = ?", (run_id,)).fetchone()[0]


def assert_account_untouched(conn, init):
    snap = compute_snapshot(conn, init.account_id)
    assert snap.cash_cents == snap.equity_cents == snap.available_cash_cents == 10_000_000
    assert snap.realized_pnl_cents == snap.unrealized_pnl_cents == snap.fees_paid_cents == 0
    assert snap.reserved_cash_cents == 0 and snap.market_value_cents == 0
    assert snap.account_revision == 1
    assert ledger_cash_cents(conn, init.account_id) == 10_000_000
    assert all(v == 0 for v in queries.trading_activity_counts(conn, init.run_id).values())
    rec = reconcile(conn, init.run_id)
    assert rec.ok, rec.discrepancies


# --- worked example --------------------------------------------------------


def test_worked_fixture_replays_step_by_step(conn, worked, key):
    rid = worked.run_id
    expected = [
        (1, "SESSION_OPEN", "open", "2026-09-29T13:30:00Z", "BOUNDARY"),
        (2, "QUOTE", "q1", "2026-09-29T14:00:00Z", "ACCEPTED"),
        (3, "QUOTE", "q2", "2026-09-29T14:00:01Z", "ACCEPTED"),
        (4, "QUOTE", "q3", "2026-09-29T14:10:00Z", "ACCEPTED"),
        (5, "QUOTE", "q4", "2026-09-29T14:10:01Z", "ACCEPTED"),
        (6, "SESSION_CLOSE", "close", "2026-09-29T20:00:00Z", "BOUNDARY"),
    ]
    for position, event_type, ref, at, outcome in expected:
        result = replay.step(conn, rid, key())
        assert (result["replay_position"], result["event_type"], result["fixture_ref"], result["outcome"]) == (
            position, event_type, ref, outcome)
        assert result["simulated_clock"] == at == clock(conn, rid)
        assert result["reason_codes"] == []
    assert result["replay_status"] == "EXHAUSTED"

    quotes = queries.list_quotes(conn, rid)
    assert [(q.source_sequence, q.bid_cents, q.ask_cents, q.underlying_price_cents) for q in quotes] == [
        (1, 390, 400, 60000), (2, 390, 400, 60000), (3, 480, 490, 60150), (4, 480, 490, 60150)]
    assert all(q.received_at == q.observed_at for q in quotes)
    assert all(q.is_sample and q.source == "synthetic_fixture_v1" for q in quotes)
    assert queries.list_rejected_inputs(conn, rid) == []

    market = queries.latest_market_state(conn, rid)
    (latest,) = market["latest_quotes"]
    assert latest["source_sequence"] == 4 and latest["bid_cents"] == 480
    # At session close (20:00) the last quote (14:10:01) is hours old on the simulated clock.
    assert latest["freshness"] == "STALE" and latest["age_seconds"] == 20999.0
    assert_account_untouched(conn, worked)


def test_freshness_uses_simulated_clock(conn, worked, key):
    for _ in range(3):  # open, q1, q2
        replay.step(conn, worked.run_id, key())
    (latest,) = queries.latest_market_state(conn, worked.run_id)["latest_quotes"]
    assert (latest["source_sequence"], latest["age_seconds"], latest["freshness"]) == (2, 0.0, "FRESH")


def test_run_event_numbers_are_distinct_from_source_sequences(conn, worked, key):
    replay.run_to_end(conn, worked.run_id, key())
    events = queries.list_replay_events(conn, worked.run_id)
    # Init wrote events 1-3 and FIXTURE_LOADED is 4, so replay events are 5..10 while source seqs are 1..4.
    assert [e["event_sequence"] for e in events] == [5, 6, 7, 8, 9, 10]
    assert [e["source_sequence"] for e in events] == [None, 1, 2, 3, 4, None]
    types = [e["event_type"] for e in queries.list_run_events(conn, worked.run_id)]
    assert types == ["RUN_CREATED", "WATCHLIST_SET", "ACCOUNT_FUNDED", "FIXTURE_LOADED", "SESSION_OPEN",
                     "QUOTE_ACCEPTED", "QUOTE_ACCEPTED", "QUOTE_ACCEPTED", "QUOTE_ACCEPTED", "SESSION_CLOSE",
                     "REPLAY_EXHAUSTED"]
    run = conn.execute("SELECT * FROM runs WHERE run_id = ?", (worked.run_id,)).fetchone()
    assert run["checkpoint_event_sequence"] == 11


def test_exhaustion_is_not_trade_completion(conn, worked, key):
    result = replay.run_to_end(conn, worked.run_id, key())
    assert result["replay_status"] == "EXHAUSTED" and result["steps_executed"] == 6
    run = queries.get_run(conn, "sample-run-001")
    assert run.status == "READY"  # never COMPLETED: no trading workflow ran
    last = queries.list_run_events(conn, worked.run_id)[-1]
    assert last["event_type"] == "REPLAY_EXHAUSTED" and "not a completed trade" in last["payload"]["note"]
    assert queries.list_closed_trades(conn, worked.run_id) == []
    with pytest.raises(replay.ReplayExhaustedError):
        replay.step(conn, worked.run_id, key())
    with pytest.raises(replay.ReplayExhaustedError):
        replay.run_to_end(conn, worked.run_id, key())
    assert_account_untouched(conn, worked)


# --- invalid inputs --------------------------------------------------------


def test_invalid_inputs_get_expected_reasons(conn, invalid, key):
    replay.run_to_end(conn, invalid.run_id, key())
    events = queries.list_replay_events(conn, invalid.run_id)
    assert [(e["replay_position"], e["fixture_ref"], e["outcome"], e["reason_codes"]) for e in events] == [
        (p, ref, outcome, list(reasons)) for p, ref, outcome, reasons in INVALID_EXPECTED]

    rejected = queries.list_rejected_inputs(conn, invalid.run_id)
    assert [r["replay_position"] for r in rejected] == [3, 4, 5, 6, 8, 9, 10]
    by_pos = {r["replay_position"]: r for r in rejected}
    assert by_pos[6]["source_sequence"] == 1 and by_pos[8]["source_sequence"] == 4
    assert "ask_size" not in by_pos[9]["raw_input"]  # raw input stored exactly as received
    assert by_pos[10]["raw_input"]["session_reference_cents"] == 59800
    assert_account_untouched(conn, invalid)


def test_rejected_inputs_never_become_or_replace_market_state(conn, invalid, key):
    rid = invalid.run_id
    latest_after = {}
    for p, ref, outcome, _ in INVALID_EXPECTED:
        replay.step(conn, rid, key())
        latest = queries.latest_market_state(conn, rid)["latest_quotes"]
        latest_after[p] = latest[0]["source_sequence"] if latest else None
    # Valid state only moves on ACCEPTED events (positions 2, 7, 11).
    assert latest_after == {1: None, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1, 7: 5, 8: 5, 9: 5, 10: 5, 11: 8, 12: 8}

    accepted_bids = sorted(q.bid_cents for q in queries.list_quotes(conn, rid))
    assert accepted_bids == [390, 395, 396]
    rejected_bids = {r["raw_input"].get("bid_cents") for r in queries.list_rejected_inputs(conn, rid)}
    assert rejected_bids.isdisjoint(accepted_bids)
    # Rejected inputs live only in rejected_inputs, never in market_quotes.
    assert conn.execute("SELECT COUNT(*) FROM market_quotes").fetchone()[0] == 3


def test_rejected_sequence_does_not_advance_high_water_mark(conn, initialized, key, tmp_path):
    from conftest import fixture_variant

    def mutate(d):
        # A crossed quote with a huge sequence must not block the next valid quote (seq 2).
        q = d["events"][1]
        bad = json.loads(json.dumps(q))
        bad["ref"], bad["at"] = "crossed_big_seq", "2026-09-29T14:00:00Z"
        bad["input"].update(source_sequence=999, bid_cents=500)
        d["events"].insert(1, bad)

    load_path(conn, initialized.run_id, fixture_variant(tmp_path, mutate))
    replay.run_to_end(conn, initialized.run_id, key())
    outcomes = [(e["fixture_ref"], e["outcome"]) for e in queries.list_replay_events(conn, initialized.run_id)]
    assert outcomes[1:4] == [("crossed_big_seq", "REJECTED"), ("q1", "ACCEPTED"), ("q2", "ACCEPTED")]


# --- commands: idempotency, pause/resume -----------------------------------


def test_step_retry_with_same_key_does_not_repeat(conn, worked):
    first = replay.step(conn, worked.run_id, "retry-me")
    before = table_counts(conn)
    again = replay.step(conn, worked.run_id, "retry-me")
    assert again["idempotent_replay"] is True and first["idempotent_replay"] is False
    assert {k: v for k, v in again.items() if k != "idempotent_replay"} == \
        {k: v for k, v in first.items() if k != "idempotent_replay"}
    assert table_counts(conn) == before
    assert queries.get_replay_state(conn, worked.run_id)["processed_events"] == 1


def test_key_reuse_for_different_command_is_conflict(conn, worked):
    replay.step(conn, worked.run_id, "k")
    before = table_counts(conn)
    with pytest.raises(IdempotencyConflictError):
        replay.pause(conn, worked.run_id, "k")
    with pytest.raises(IdempotencyConflictError):
        replay.run_to_end(conn, worked.run_id, "k")
    assert table_counts(conn) == before


def test_run_to_end_retry_is_idempotent(conn, worked):
    first = replay.run_to_end(conn, worked.run_id, "all")
    before = table_counts(conn)
    again = replay.run_to_end(conn, worked.run_id, "all")
    assert again["idempotent_replay"] and again["steps_executed"] == first["steps_executed"] == 6
    assert table_counts(conn) == before


def test_pause_blocks_stepping_until_resume(conn, worked, key):
    rid = worked.run_id
    replay.step(conn, rid, key())
    assert replay.pause(conn, rid, key())["changed"] is True
    assert replay.pause(conn, rid, key())["changed"] is False  # already paused: no-op
    before = table_counts(conn)
    with pytest.raises(replay.ReplayPausedError):
        replay.step(conn, rid, key())
    with pytest.raises(replay.ReplayPausedError):
        replay.run_to_end(conn, rid, key())
    assert {k: v for k, v in table_counts(conn).items() if k != "command_log"} == \
        {k: v for k, v in before.items() if k != "command_log"}
    assert replay.resume(conn, rid, key())["changed"] is True
    assert replay.step(conn, rid, key())["replay_position"] == 2
    types = [e["event_type"] for e in queries.list_run_events(conn, rid)]
    assert "REPLAY_PAUSED" in types and "REPLAY_RESUMED" in types


def test_run_to_end_stops_when_paused_mid_way(conn, worked, key, monkeypatch):
    rid = worked.run_id
    real = replay._step_in_transaction
    calls = {"n": 0}

    def step_then_pause(c, run_id):
        result = real(c, run_id)
        calls["n"] += 1
        if calls["n"] == 2:  # simulate a pause command arriving between events
            c.execute("UPDATE replay_state SET status = 'PAUSED' WHERE run_id = ?", (run_id,))
        return result

    monkeypatch.setattr(replay, "_step_in_transaction", step_then_pause)
    result = replay.run_to_end(conn, rid, key())
    assert result["steps_executed"] == 2 and result["stopped_because"] == "PAUSED"
    assert result["next_position"] == 3


def test_commands_before_load_are_rejected(conn, initialized, key):
    for fn in (replay.step, replay.pause, replay.resume, replay.run_to_end):
        with pytest.raises(replay.ReplayNotLoadedError):
            fn(conn, initialized.run_id, key())


@pytest.mark.parametrize("bad", ["", "   ", "x" * 201])
def test_idempotency_key_validated(conn, worked, bad):
    with pytest.raises(ValueError):
        replay.step(conn, worked.run_id, bad)


# --- atomicity and restart -------------------------------------------------


def test_failure_before_commit_leaves_no_partial_event(conn, worked, key, monkeypatch):
    rid = worked.run_id
    replay.step(conn, rid, key())  # SESSION_OPEN
    before_counts = table_counts(conn)
    before_clock = clock(conn, rid)
    before_checkpoint = conn.execute("SELECT checkpoint_event_sequence FROM runs").fetchone()[0]

    real_execute_calls = []

    class Boom(RuntimeError):
        pass

    original = replay.append_run_event

    def append_then_crash(c, run_id, event_type, simulated_at, payload):
        seq = original(c, run_id, event_type, simulated_at, payload)
        real_execute_calls.append(event_type)
        raise Boom("crash after writing the event but before commit")

    monkeypatch.setattr(replay, "append_run_event", append_then_crash)
    with pytest.raises(Boom):
        replay.step(conn, rid, "crashing-step")
    assert real_execute_calls == ["QUOTE_ACCEPTED"]

    assert table_counts(conn) == before_counts
    assert clock(conn, rid) == before_clock
    assert conn.execute("SELECT checkpoint_event_sequence FROM runs").fetchone()[0] == before_checkpoint
    assert queries.get_replay_state(conn, rid)["processed_events"] == 1

    monkeypatch.setattr(replay, "append_run_event", original)
    retried = replay.step(conn, rid, "crashing-step")  # same key: nothing was recorded, so it runs now
    assert retried["replay_position"] == 2 and retried["outcome"] == "ACCEPTED"


def test_restart_resumes_at_next_event_without_duplicates(settings, key):
    c1 = connect(settings.db_path, create=True)
    init = init_sample(c1, settings)
    load_path(c1, init.run_id, INVALID_FIXTURE)
    for _ in range(4):
        replay.step(c1, init.run_id, key())
    counts = table_counts(c1)
    c1.close()  # "restart"

    c2 = connect(settings.db_path)
    replay._parse_stored.cache_clear()
    state = queries.get_replay_state(c2, init.run_id)
    assert (state["processed_events"], state["next_position"]) == (4, 5)
    assert table_counts(c2) == counts
    load_path(c2, init.run_id, INVALID_FIXTURE)  # reloading after restart is a no-op
    assert table_counts(c2) == counts
    nxt = replay.step(c2, init.run_id, key())
    assert (nxt["replay_position"], nxt["fixture_ref"]) == (5, "crossed")
    replay.run_to_end(c2, init.run_id, key())
    assert c2.execute("SELECT COUNT(*) FROM replay_events").fetchone()[0] == 12
    assert c2.execute("SELECT COUNT(*) FROM rejected_inputs").fetchone()[0] == 7
    assert c2.execute("SELECT COUNT(*) FROM market_quotes").fetchone()[0] == 3
    c2.close()


# --- determinism -----------------------------------------------------------


def _replay_projection(tmp_path, name, fixture) -> dict:
    s = make_settings(tmp_path / name)
    c = connect(s.db_path, create=True)
    init = init_sample(c, s)
    load_path(c, init.run_id, fixture)
    replay.run_to_end(c, init.run_id, f"{name}-all")

    def strip_ids(d):
        return {k: v for k, v in d.items() if not k.endswith("_id") and k not in ("recorded_at",)}

    projection = {
        "events": [(e["event_sequence"], e["event_type"], e["simulated_at"], strip_ids(e["payload"]))
                   for e in queries.list_run_events(c, init.run_id)],
        "replay": [strip_ids(e) for e in queries.list_replay_events(c, init.run_id)],
        "quotes": [strip_ids(q.model_dump()) for q in queries.list_quotes(c, init.run_id)],
        "rejected": [strip_ids(r) for r in queries.list_rejected_inputs(c, init.run_id)],
        "market": [strip_ids(q) for q in queries.latest_market_state(c, init.run_id)["latest_quotes"]],
        "clock": clock(c, init.run_id),
        "snapshot": strip_ids(compute_snapshot(c, init.account_id).model_dump()),
        "ids": (init.run_id, [q.quote_id for q in queries.list_quotes(c, init.run_id)]),
    }
    c.close()
    return projection


@pytest.mark.parametrize("fixture", [WORKED_FIXTURE, INVALID_FIXTURE], ids=["worked", "invalid"])
def test_identical_inputs_give_identical_results(tmp_path, fixture):
    a = _replay_projection(tmp_path, "a", fixture)
    b = _replay_projection(tmp_path, "b", fixture)
    assert a.pop("ids") != b.pop("ids")  # record IDs are globally unique per run
    assert a == b


# --- database guards -------------------------------------------------------


def test_replay_records_are_immutable_and_cursor_guarded(conn, worked, key):
    replay.run_to_end(conn, worked.run_id, key())
    for sql in ("UPDATE market_quotes SET bid_cents = 1", "DELETE FROM market_quotes",
                "UPDATE replay_events SET outcome = 'REJECTED'", "DELETE FROM replay_events"):
        with pytest.raises(sqlite3.IntegrityError, match="immutable"):
            conn.execute(sql)
    with pytest.raises(sqlite3.IntegrityError, match="final"):
        conn.execute("UPDATE replay_state SET status = 'ACTIVE'")
    with pytest.raises(sqlite3.IntegrityError, match="backward"):
        conn.execute("UPDATE runs SET simulated_clock = '2026-09-29T13:00:00Z'")
    with pytest.raises(sqlite3.IntegrityError, match="backward"):
        conn.execute("UPDATE runs SET checkpoint_event_sequence = 1")


def test_cursor_cannot_skip_events(conn, worked):
    with pytest.raises(sqlite3.IntegrityError, match="one event at a time"):
        conn.execute("UPDATE replay_state SET next_position = 3")


def test_step_3_account_still_reconciles_after_invalid_replay(conn, invalid, key):
    replay.run_to_end(conn, invalid.run_id, key())
    assert_account_untouched(conn, invalid)
