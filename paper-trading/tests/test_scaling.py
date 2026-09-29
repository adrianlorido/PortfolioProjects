"""FA-1a: hot queries use indexes, and per-event work does not grow with replay length.

The scaling check counts SQLite virtual-machine instructions per event (via a
progress handler), so it is deterministic and independent of machine speed.
Wall-clock numbers are in tools/bench_replay.py and docs/HISTORICAL_DATA_PLAN.md.
"""

import pytest

from dataset_helpers import large_contracts, large_events, store_kwargs
from paper_trading.accounting import reconcile
from paper_trading.app import queries, replay
from paper_trading.app.coordinator import init_sample
from paper_trading.market_data.datasets import store_dataset

HOT_QUERIES = {
    "next event by position": (
        "SELECT * FROM dataset_events WHERE dataset_id = ? AND dataset_version = ? AND position = ?", 3),
    "duplicate source sequence": (
        "SELECT 1 FROM market_quotes WHERE run_id = ? AND source = ? AND source_sequence = ?", 3),
    "highest accepted sequence": (
        "SELECT MAX(source_sequence) FROM market_quotes WHERE run_id = ? AND source = ?", 2),
    "latest quote for a contract": (
        "SELECT * FROM market_quotes WHERE run_id = ? AND contract_id = ? ORDER BY event_sequence DESC LIMIT 1", 2),
    "mark consistency (reconcile)": (
        "SELECT MAX(event_sequence) FROM market_quotes WHERE run_id = ? AND contract_id = ?", 2),
    "next run event sequence": (
        "SELECT COALESCE(MAX(event_sequence), 0) + 1 FROM run_events WHERE run_id = ?", 1),
    "replay cursor contiguity (trigger)": (
        "SELECT MAX(replay_position) FROM replay_events WHERE run_id = ?", 1),
    "dataset event append (trigger)": (
        "SELECT MAX(position) FROM dataset_events WHERE dataset_id = ? AND dataset_version = ?", 2),
    "dashboard replay events page": (
        "SELECT * FROM replay_events WHERE run_id = ? AND replay_position > ? AND replay_position <= ? "
        "ORDER BY replay_position", 3),
    "recent entry rejections (cooldown)": (
        "SELECT d.evaluated_at FROM risk_decisions d WHERE d.run_id = ? AND d.decision = 'REJECTED' "
        "AND d.evaluated_at >= ?", 2),
    "recent rejected entry orders (cooldown)": (
        "SELECT o.updated_at FROM orders o WHERE o.run_id = ? AND o.status = 'REJECTED' AND o.updated_at >= ?", 2),
    "open orders for a contract": (
        "SELECT * FROM orders WHERE run_id = ? AND status = 'OPEN' AND contract_id = ? "
        "ORDER BY submitted_at, order_id", 2),
}


@pytest.mark.parametrize("name", sorted(HOT_QUERIES))
def test_hot_queries_use_an_index(initialized, conn, name):
    sql, n = HOT_QUERIES[name]
    steps = [r[3] for r in conn.execute(f"EXPLAIN QUERY PLAN {sql}", ("x",) * n)]
    # A SEARCH through an index or primary key; a temp B-tree may only sort the (bounded) matches.
    assert steps[0].startswith("SEARCH") and ("INDEX" in steps[0] or "PRIMARY KEY" in steps[0]), steps
    assert not any(step.startswith("SCAN") for step in steps), steps


def _vm_ops_per_event(conn, run_id, monkeypatch) -> list[int]:
    """SQLite VM instructions spent on each event, including the per-event reconciliation guard."""
    counter = [0]
    per_event: list[int] = []
    conn.set_progress_handler(lambda: counter.__setitem__(0, counter[0] + 1) or 0, 100)
    inner_step, inner_guard = replay._step_in_transaction, replay._guard_trading_mutation
    pending = [0]

    def guard(c, rid):
        pending[0] = counter[0]
        return inner_guard(c, rid)

    def step(c, rid):
        try:
            return inner_step(c, rid)
        finally:
            per_event.append(counter[0] - pending[0])

    monkeypatch.setattr(replay, "_guard_trading_mutation", guard)
    monkeypatch.setattr(replay, "_step_in_transaction", step)
    replay.run_to_end(conn, run_id, "vm-all")
    conn.set_progress_handler(None, 100)
    return per_event


@pytest.mark.parametrize("case", ["one trade then quiet", "risk rejects every entry signal"])
def test_work_per_event_does_not_grow_with_replay_length(conn, settings, monkeypatch, case):
    n = 3000
    overrides = {"entry_risk_limit_bps": 1} if case.startswith("risk") else {}
    init = init_sample(conn, settings.model_copy(update=overrides), trading=True)
    store_dataset(conn, **store_kwargs("scale", large_events(n), contracts=large_contracts()))
    replay.attach_dataset(conn, init.run_id, "scale", "1.0.0")
    replay.start_trading(conn, init.run_id, "vm-start")
    ops = _vm_ops_per_event(conn, init.run_id, monkeypatch)
    assert len(ops) == n + 2 and reconcile(conn, init.run_id).ok
    rejections = conn.execute("SELECT COUNT(*) FROM risk_decisions WHERE decision = 'REJECTED'").fetchone()[0]
    assert (rejections > 30) == case.startswith("risk")  # a rejection roughly every cooldown period
    # Compare the 2nd tenth with the last tenth of the run (the first tenth holds the trade).
    tenth = len(ops) // 10
    early = sum(ops[tenth:2 * tenth]) / tenth
    late = sum(ops[-tenth:]) / tenth
    assert late <= early * 1.10, (early, late)  # B-tree depth may add a little; a scan would add ~ n/10x
    assert queries.count_rows(conn, "replay_events", init.run_id) == \
        conn.execute("SELECT COUNT(*) FROM replay_events").fetchone()[0] == n + 2
    assert queries.count_rows(conn, "run_events", init.run_id) == \
        conn.execute("SELECT COUNT(*) FROM run_events").fetchone()[0]
