"""FA-1a: restart and retry on a larger dataset (5,000 quotes, 5,002 events).

An interrupted replay-to-end retried with the same key, and a process restart
halfway through, must both end exactly where an uninterrupted run ends.
"""

import pytest

from dataset_helpers import large_contracts, large_events, store_kwargs
from paper_trading.accounting import compute_snapshot, reconcile
from paper_trading.app import queries, replay
from paper_trading.app.coordinator import init_sample
from paper_trading.market_data.datasets import store_dataset
from conftest import make_settings
from paper_trading.storage.db import connect
from paper_trading.storage.migrator import migrate

N = 5000
QUOTE_FIELDS = ("contract_id", "source_sequence", "observed_at", "bid_cents", "ask_cents", "event_sequence")


@pytest.fixture(scope="module")
def db(tmp_path_factory):
    """One database holding the stored dataset; each test adds its own runs."""
    path = tmp_path_factory.mktemp("large") / "large.sqlite3"
    c = connect(path, create=True)
    migrate(c)
    store_dataset(c, **store_kwargs("large", large_events(N), contracts=large_contracts()))
    c.close()
    return path


def new_run(conn, settings, key):
    init = init_sample(conn, settings.model_copy(update={"sample_run_key": key}), trading=True)
    replay.attach_dataset(conn, init.run_id, "large", "1.0.0")
    replay.start_trading(conn, init.run_id, f"{key}-start")
    return init


def fingerprint(conn, init) -> dict:
    """Everything that must match across runs, without run-specific IDs or wall-clock times."""
    rid = init.run_id
    snap = compute_snapshot(conn, init.account_id)
    rows = conn.execute(f"SELECT {', '.join(QUOTE_FIELDS)} FROM market_quotes WHERE run_id = ? "
                        "ORDER BY event_sequence", (rid,)).fetchall()
    return {
        "books": (snap.cash_cents, snap.equity_cents, snap.fees_paid_cents, snap.realized_pnl_cents),
        "trades": [(t.realized_pnl_cents, t.exit_reason, t.opened_at, t.closed_at)
                   for t in queries.list_closed_trades(conn, rid)],
        "events": [(e["event_type"], e["simulated_at"]) for e in queries.list_run_events(conn, rid)],
        "quotes": [tuple(r) for r in rows],
        "rejected": [(r["replay_position"], tuple(r["reason_codes"]))
                     for r in queries.list_rejected_inputs(conn, rid)],
        "status": queries.get_run(conn, init_key(conn, rid)).status,
        "reconciled": reconcile(conn, rid).ok,
    }


def init_key(conn, run_id):
    return conn.execute("SELECT init_key FROM runs WHERE run_id = ?", (run_id,)).fetchone()[0]


@pytest.fixture(scope="module")
def reference(db):
    conn = connect(db)
    init = new_run(conn, settings_for(db), "reference")
    replay.run_to_end(conn, init.run_id, "reference-all")
    fp = fingerprint(conn, init)
    conn.close()
    assert fp["reconciled"] and fp["status"] == "COMPLETED"
    assert fp["books"][0] == 10_007_870 and len(fp["quotes"]) == N - len(fp["rejected"])
    return fp


def settings_for(db):
    return make_settings(db.parent).model_copy(update={"db_path": db})


def test_interrupted_replay_to_end_resumes_with_the_same_key(db, reference, monkeypatch):
    conn = connect(db)
    init = new_run(conn, settings_for(db), "interrupted")
    inner = replay._step_in_transaction
    calls = [0]

    def crash_once(c, rid):
        calls[0] += 1
        if calls[0] == 2600:
            raise RuntimeError("simulated crash mid-event")
        return inner(c, rid)

    monkeypatch.setattr(replay, "_step_in_transaction", crash_once)
    with pytest.raises(RuntimeError, match="simulated crash"):
        replay.run_to_end(conn, init.run_id, "interrupted-all")
    state = queries.get_replay_state(conn, init.run_id)
    assert state["processed_events"] == 2599  # the failed event rolled back completely
    assert reconcile(conn, init.run_id).ok
    result = replay.run_to_end(conn, init.run_id, "interrupted-all")  # same key: resumes at the checkpoint
    assert result["replay_status"] == "EXHAUSTED" and result["steps_executed"] == N + 2 - 2599
    again = replay.run_to_end(conn, init.run_id, "interrupted-all")
    assert again["idempotent_replay"] is True
    assert fingerprint(conn, init) == reference
    conn.close()


def test_restart_halfway_matches_an_uninterrupted_run(db, reference):
    c1 = connect(db)
    init = new_run(c1, settings_for(db), "restarted")
    for i in range(2500):
        replay.step(c1, init.run_id, f"restarted-step-{i}")
    last = replay.step(c1, init.run_id, "restarted-last")
    c1.close()                                                  # "process restart"
    replay._parse_stored.cache_clear()
    c2 = connect(db)
    retried = replay.step(c2, init.run_id, "restarted-last")    # retry of the last command after restart
    assert retried["idempotent_replay"] is True and retried["replay_position"] == last["replay_position"] == 2501
    replay.run_to_end(c2, init.run_id, "restarted-rest")
    assert fingerprint(c2, init) == reference
    c2.close()
