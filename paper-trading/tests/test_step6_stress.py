"""Step 6: stress and end-to-end verification of the sample paper-trading engine.

Every scenario uses its own synthetic fixture and a fresh trading run, and runs the
independent books check (trading_helpers.assert_books, which does not call the
reconcile code under test) after every event via CheckedRun. The original worked
example fixture is never modified.
"""

from __future__ import annotations

import threading

import pytest
from fastapi.testclient import TestClient

from paper_trading.app import queries, replay, trading
from paper_trading.app.api import create_app
from paper_trading.broker.paper import OrderNotOpenError
from paper_trading.storage.db import connect

from conftest import WORKED_FIXTURE, make_settings
from trading_helpers import DAY, CheckedRun, assert_books, build_fixture, contract, q

Q1 = q("14:00:00", 1, 390, 400)            # entry signal, buy limit $4.00
Q2 = q("14:00:01", 2, 390, 400)            # entry fill at $4.00, mark $3.90


def orders(t):
    return [(o["intent"], o["status"], o["terminal_reason"], o["limit_cents"]) for o in t.orders()]


# --- worked example under the independent books check -------------------------


def test_worked_example_books_hold_at_every_event(conn, settings):
    t = CheckedRun(conn, settings, WORKED_FIXTURE)
    t.run_to_end()
    s = t.snap()
    assert (s.cash_cents, s.equity_cents, s.realized_pnl_cents, s.fees_paid_cents) == (
        10_007_870, 10_007_870, 7_870, 130)


# --- 1. price gap through the loss threshold ----------------------------------------


def test_gap_through_loss_threshold_fills_at_eligible_bid_not_a_stop_price(conn, settings, tmp_path):
    t = CheckedRun(conn, settings, build_fixture(tmp_path, [
        Q1, Q2,
        q("14:05:00", 3, 300, 310, ref="gap"),          # gaps from 3.90 to 3.00, through the 3.60 threshold
        q("14:05:01", 4, 280, 290, ref="lower"),        # 2.80 < 3.00 sell limit: must not fill
        q("14:06:05", 5, 290, 300, ref="after_ttl"),    # closing order expired 14:06:00; retry at 2.90
        q("14:06:06", 6, 290, 300, ref="fill"),
    ]))
    t.step_to("gap")
    assert t.proposals()[-1]["reason_code"] == "LOSS_THRESHOLD" and t.proposals()[-1]["limit_cents"] == 300
    t.step_to("lower")
    assert len(t.fills()) == 1                                   # sell limit respected on the further gap
    t.step_to("after_ttl")
    assert [(p["reason_code"], p["limit_cents"]) for p in t.proposals()] == [
        ("ENTRY_SIGNAL", 400), ("LOSS_THRESHOLD", 300), ("EXIT_RETRY", 290)]
    t.run_to_end()
    assert orders(t) == [("BUY_TO_OPEN", "FILLED", None, 400), ("SELL_TO_CLOSE", "EXPIRED", "TTL_ELAPSED", 300),
                         ("SELL_TO_CLOSE", "FILLED", None, 290)]
    (trade,) = t.trades()
    assert t.fills()[-1]["price_cents"] == 290                   # actual eligible bid, not the 3.60 threshold
    assert (trade.exit_reason, trade.realized_pnl_cents) == ("LOSS_THRESHOLD", 29_000 - 65 - 40_065)


def test_gap_to_zero_bid_waits_for_positive_bid(conn, settings, tmp_path):
    t = CheckedRun(conn, settings, build_fixture(tmp_path, [
        Q1, Q2, q("14:05:00", 3, 0, 10, ref="zero_bid"), q("14:05:01", 4, 250, 260), q("14:05:02", 5, 250, 260)]))
    t.step_to("zero_bid")
    assert queries.list_exit_intents(conn, t.run_id)[0]["reason_code"] == "LOSS_THRESHOLD"
    assert len(t.proposals()) == 1                               # no sell limit of zero is ever proposed
    t.run_to_end()
    assert [(p["reason_code"], p["limit_cents"]) for p in t.proposals()][1:] == [("LOSS_THRESHOLD", 250)]
    assert t.trades()[0].realized_pnl_cents == 25_000 - 65 - 40_065


# --- 2. prices outside limits: unfilled, expired, reservations released ------------


def test_buy_outside_limit_expires_and_releases_cash(conn, settings, tmp_path):
    t = CheckedRun(conn, settings, build_fixture(tmp_path, [
        Q1, q("14:00:30", 2, 395, 405), q("14:00:59", 3, 391, 401),
        q("14:01:30", 4, 390, 400, und=59_900, ref="after_ttl")]))   # below entry threshold: no re-entry
    t.step_to("s3@14:00:59")
    s = t.snap()
    assert (s.reserved_cash_cents, s.available_cash_cents, s.cash_cents) == (40_065, 9_959_935, 10_000_000)
    t.step_to("after_ttl")
    assert orders(t) == [("BUY_TO_OPEN", "EXPIRED", "TTL_ELAPSED", 400)]
    assert t.orders()[0]["updated_at"] == DAY + "14:01:00Z"
    s = t.snap()
    assert (s.reserved_cash_cents, s.available_cash_cents, s.cash_cents, s.fees_paid_cents) == (
        0, 10_000_000, 10_000_000, 0)


def test_sell_outside_limit_expires_releases_contracts_keeps_intent(conn, settings, tmp_path):
    t = CheckedRun(conn, settings, build_fixture(tmp_path, [
        Q1, Q2, q("14:10:00", 3, 480, 490, 60150), q("14:10:30", 4, 470, 480, 60150),
        q("14:11:05", 5, 470, 480, 60150, observed=DAY + "14:10:59Z", ref="rejected_after_ttl")]))
    t.step_to("s4@14:10:30")
    assert t.positions()[0].reserved_contracts == 1
    t.step_to("rejected_after_ttl")                              # expiry runs even on a rejected-input event
    assert orders(t)[1] == ("SELL_TO_CLOSE", "EXPIRED", "TTL_ELAPSED", 480)
    (pos,) = t.positions()
    assert (pos.status, pos.quantity, pos.reserved_contracts) == ("OPEN", 1, 0)
    intent = queries.list_exit_intents(conn, t.run_id)[0]
    assert intent["reason_code"] == "PROFIT_TARGET" and intent["resolved_at"] is None
    assert len(t.proposals()) == 2                               # no retry on an invalid quote


# --- 3. stale / invalid / insufficient-size quotes and valuation freshness --------


def test_mark_freshness_boundary_end_to_end(conn, settings, tmp_path):
    stale_input = dict(observed=DAY + "13:59:00Z")
    t = CheckedRun(conn, settings, build_fixture(tmp_path, [
        Q1, Q2,
        q("14:00:03", 3, 1, 2, ref="age_2s", **stale_input),    # rejected; mark (14:00:01) is exactly 2 s old
        q("14:00:04", 4, 1, 2, ref="age_3s", **stale_input),    # rejected; mark is 3 s old
        q("14:00:05", 5, 395, 405, ref="new_mark")]))
    t.step_to("age_2s")
    assert t.positions()[0].valuation_status == "CURRENT" and t.snap().valuation_status == "CURRENT"
    t.step_to("age_3s")
    p = t.positions()[0]
    assert (p.valuation_status, p.market_value_cents) == ("STALE", 39_000)   # kept, never zeroed
    assert t.snap().valuation_status == "STALE" and t.snap().equity_cents == 9_959_935 + 39_000
    t.step_to("new_mark")
    p = t.positions()[0]
    assert (p.valuation_status, p.market_value_cents) == ("CURRENT", 39_500)


def test_sell_needs_full_displayed_bid_size(conn, settings, tmp_path):
    t = CheckedRun(conn, settings, build_fixture(tmp_path, [
        Q1, Q2, q("14:10:00", 3, 480, 490, 60150),
        q("14:10:01", 4, 480, 490, 60150, bid_size=0, ref="no_bid_size"),
        q("14:10:02", 5, 480, 490, 60150, bid_size=None, ref="missing_bid_size"),
        q("14:10:03", 6, 480, 490, 60150, bid_size=1, ref="size_1")]))
    t.step_to("missing_bid_size")
    assert len(t.fills()) == 1
    assert queries.list_replay_events(conn, t.run_id)[-1]["reason_codes"] == ["MISSING_SIZE"]
    t.step_to("size_1")
    assert [f["quote_source_sequence"] for f in t.fills()] == [2, 6]


# --- 4. duplicated, retried, and concurrent commands (separate connections) -------


def _threads(n, target):
    barrier = threading.Barrier(n)
    results: list = [None] * n

    def run(i):
        barrier.wait()
        try:
            results[i] = ("ok", target(i))
        except Exception as exc:  # collected for assertions
            results[i] = ("err", exc)

    ts = [threading.Thread(target=run, args=(i,)) for i in range(n)]
    for th in ts:
        th.start()
    for th in ts:
        th.join(timeout=60)
    return results


def _started_run(settings, fixture, key="stress"):
    c = connect(settings.db_path, create=True)
    t = CheckedRun(c, settings, fixture, key=key)
    return c, t


def test_concurrent_steps_with_distinct_keys_process_each_event_once(settings):
    c, t = _started_run(settings, WORKED_FIXTURE)

    def step(i):
        conn = connect(settings.db_path)
        try:
            return replay.step(conn, t.run_id, f"thread-{i}")
        finally:
            conn.close()

    results = _threads(9, step)
    ok = sorted(r[1]["replay_position"] for r in results if r[0] == "ok")
    errors = [type(r[1]).__name__ for r in results if r[0] == "err"]
    assert ok == [1, 2, 3, 4, 5, 6] and errors == ["ReplayExhaustedError"] * 3
    assert c.execute("SELECT COUNT(*) FROM replay_events").fetchone()[0] == 6
    assert len(t.fills()) == 2 and t.snap().cash_cents == 10_007_870
    assert_books(c, t.run_id, t.account_id)
    c.close()


def test_concurrent_retries_of_one_key_execute_once(settings):
    c, t = _started_run(settings, WORKED_FIXTURE)

    def step(_):
        conn = connect(settings.db_path)
        try:
            return replay.step(conn, t.run_id, "same-key")
        finally:
            conn.close()

    results = _threads(8, step)
    assert all(r[0] == "ok" for r in results)
    assert {r[1]["replay_position"] for r in results} == {1}
    assert sum(1 for r in results if not r[1]["idempotent_replay"]) == 1
    assert c.execute("SELECT COUNT(*) FROM replay_events").fetchone()[0] == 1
    c.close()


def test_concurrent_manual_closes_create_one_closing_order(settings, tmp_path):
    c, t = _started_run(settings, build_fixture(tmp_path, [Q1, Q2, q("14:00:02", 3, 390, 400)]))
    t.step_to("s2@14:00:01")

    def close(i):
        conn = connect(settings.db_path)
        try:
            return replay.request_close(conn, t.run_id, f"close-{i}")
        finally:
            conn.close()

    results = _threads(6, close)
    assert all(r[0] == "ok" for r in results)
    sells = [o for o in t.orders() if o["intent"] == "SELL_TO_CLOSE"]
    assert len(sells) == 1 and t.positions()[0].reserved_contracts == 1       # no overselling
    assert len(queries.list_exit_intents(c, t.run_id)) == 1
    assert sum(1 for r in results if r[1]["proposal"]) == 1
    assert_books(c, t.run_id, t.account_id)
    t.run_to_end()
    assert len(t.fills()) == 2 and t.positions()[0].quantity == 0
    c.close()


def test_cancel_races_fill_with_one_consistent_outcome(settings, tmp_path):
    c, t = _started_run(settings, build_fixture(tmp_path, [Q1, Q2]))
    t.step_to("s1@14:00:00")
    order_id = t.orders()[0]["order_id"]

    def act(i):
        conn = connect(settings.db_path)
        try:
            return (replay.cancel_order(conn, t.run_id, order_id, "race-cancel") if i == 0
                    else replay.step(conn, t.run_id, "race-step"))
        finally:
            conn.close()

    results = _threads(2, act)
    status = t.orders()[0]["status"]
    if status == "CANCELED":
        assert results[0][0] == "ok" and t.fills() == [] and t.snap().cash_cents == 10_000_000
    else:
        assert status == "FILLED" and isinstance(results[0][1], OrderNotOpenError) and len(t.fills()) == 1
    assert results[1][0] == "ok"
    assert_books(c, t.run_id, t.account_id)
    c.close()


def test_concurrent_run_to_end_and_steps_match_sequential_result(settings):
    c, t = _started_run(settings, WORKED_FIXTURE)

    def act(i):
        conn = connect(settings.db_path)
        try:
            return (replay.run_to_end(conn, t.run_id, f"all-{i}") if i < 2 else replay.step(conn, t.run_id, f"s-{i}"))
        finally:
            conn.close()

    _threads(5, act)
    assert c.execute("SELECT COUNT(*) FROM replay_events").fetchone()[0] == 6
    assert [e["replay_position"] for e in queries.list_replay_events(c, t.run_id)] == [1, 2, 3, 4, 5, 6]
    s = t.snap()
    assert (s.cash_cents, s.realized_pnl_cents, t.run()["status"]) == (10_007_870, 7_870, "COMPLETED")
    assert_books(c, t.run_id, t.account_id)
    c.close()


# --- 5. restart in each open state ----------------------------------------------


def _state(conn, t) -> dict:
    return {
        "snapshot": t.snap().model_dump(),
        "orders": [dict(o) for o in t.orders()],
        "positions": [p.model_dump() for p in t.positions()],
        "intents": queries.list_exit_intents(conn, t.run_id),
        "replay": queries.get_replay_state(conn, t.run_id),
        "clock": t.run()["simulated_clock"],
        "status": t.run()["status"],
    }


@pytest.mark.parametrize("stop_at, then", [
    ("s1@14:00:00", "pending_entry"),
    ("s2@14:00:01", "open_position"),
    ("s3@14:10:00", "pending_exit"),
])
def test_restart_recovers_every_open_state(settings, tmp_path, stop_at, then):
    fixture = build_fixture(tmp_path, [Q1, Q2, q("14:10:00", 3, 480, 490, 60150),
                                       q("14:10:01", 4, 480, 490, 60150)])
    c1 = connect(settings.db_path, create=True)
    t = CheckedRun(c1, settings, fixture)
    t.step_to(stop_at)
    before = _state(c1, t)
    c1.close()                                                   # restart
    replay._parse_stored.cache_clear()
    c2 = connect(settings.db_path)
    t.conn = c2
    assert _state(c2, t) == before                               # cash, reservations, intent, TTL, cursor
    if then == "pending_entry":
        assert before["orders"][0]["expires_at"] == DAY + "14:01:00Z" and before["snapshot"]["reserved_cash_cents"] == 40_065
    if then == "pending_exit":
        assert before["intents"][0]["reason_code"] == "PROFIT_TARGET" and before["positions"][0]["reserved_contracts"] == 1
    t.run_to_end()
    s = t.snap()
    assert (s.cash_cents, s.reserved_cash_cents, len(t.fills()), t.run()["status"]) == (
        10_007_870, 0, 2, "COMPLETED")
    c2.close()


def test_restart_with_pending_entry_expires_it_by_ttl(settings, tmp_path):
    fixture = build_fixture(tmp_path, [Q1, q("14:01:30", 2, 390, 400, und=59_900, ref="after_ttl")])
    c1 = connect(settings.db_path, create=True)
    t = CheckedRun(c1, settings, fixture)
    t.step_to("s1@14:00:00")
    c1.close()
    replay._parse_stored.cache_clear()
    t.conn = c2 = connect(settings.db_path)
    t.step_to("after_ttl")
    assert orders(t) == [("BUY_TO_OPEN", "EXPIRED", "TTL_ELAPSED", 400)] and t.fills() == []
    assert t.snap().available_cash_cents == 10_000_000
    c2.close()


# --- 6. failure before commit / after commit before the response ------------------


def test_failure_after_commit_before_http_response_is_safe_to_retry(conn, settings, tmp_path, monkeypatch):
    t = CheckedRun(conn, settings, build_fixture(tmp_path, [Q1, Q2]), key="http-run")
    t.step_to("s1@14:00:00")
    real_step = replay.step
    calls = []

    def committed_then_lost(c, run_id, key):
        result = real_step(c, run_id, key)       # the step commits here
        calls.append(key)
        if len(calls) == 1:
            raise ConnectionResetError("response lost after commit")
        return result

    import paper_trading.app.api as api_module
    monkeypatch.setattr(api_module.replay, "step", committed_then_lost)
    with TestClient(create_app(settings), raise_server_exceptions=False) as client:
        first = client.post("/api/replay/step?run=http-run", json={"idempotency_key": "fill-q2"})
        assert first.status_code == 500
        assert len(t.fills()) == 1                               # committed despite the lost response
        retry = client.post("/api/replay/step?run=http-run", json={"idempotency_key": "fill-q2"})
    assert retry.status_code == 200 and retry.json()["idempotent_replay"] is True
    assert len(t.fills()) == 1 and conn.execute("SELECT COUNT(*) FROM cash_ledger_entries").fetchone()[0] == 2
    assert_books(conn, t.run_id, t.account_id)


def test_replay_to_end_interrupted_mid_run_resumes_without_duplicates(conn, settings, monkeypatch):
    t = CheckedRun(conn, settings, WORKED_FIXTURE)
    real = replay._step_in_transaction
    calls = {"n": 0}

    def crash_on_fourth(c, run_id):
        calls["n"] += 1
        if calls["n"] == 4:
            raise RuntimeError("process died during event 4")
        return real(c, run_id)

    monkeypatch.setattr(replay, "_step_in_transaction", crash_on_fourth)
    with pytest.raises(RuntimeError):
        replay.run_to_end(conn, t.run_id, "all")
    assert queries.get_replay_state(conn, t.run_id)["processed_events"] == 3   # events 1-3 committed
    assert len(t.fills()) == 1
    assert_books(conn, t.run_id, t.account_id)
    monkeypatch.setattr(replay, "_step_in_transaction", real)
    result = replay.run_to_end(conn, t.run_id, "all")             # same key: resumes from the checkpoint
    assert result["steps_executed"] == 3 and result["replay_status"] == "EXHAUSTED"
    assert replay.run_to_end(conn, t.run_id, "all")["idempotent_replay"] is True
    assert len(t.fills()) == 2 and t.snap().cash_cents == 10_007_870
    assert_books(conn, t.run_id, t.account_id)


def test_manual_close_failure_before_commit_leaves_nothing(conn, settings, tmp_path, monkeypatch):
    t = CheckedRun(conn, settings, build_fixture(tmp_path, [Q1, Q2, q("14:00:02", 3, 390, 400)]))
    t.step_to("s2@14:00:01")
    real_submit = trading.broker.submit

    def submit_then_die(*a, **k):
        real_submit(*a, **k)
        raise RuntimeError("died after inserting the order, before commit")

    monkeypatch.setattr(trading.broker, "submit", submit_then_die)
    with pytest.raises(RuntimeError):
        replay.request_close(conn, t.run_id, "close")
    assert len(t.orders()) == 1 and queries.list_exit_intents(conn, t.run_id) == []
    assert t.positions()[0].reserved_contracts == 0 and t.run()["status"] == "RUNNING"
    monkeypatch.setattr(trading.broker, "submit", real_submit)
    assert replay.request_close(conn, t.run_id, "close")["proposal"]["order"]["status"] == "OPEN"
    assert_books(conn, t.run_id, t.account_id)


# --- 7/8. session end with an open closing order ------------------------------------


def test_session_end_with_open_closing_order(conn, settings, tmp_path):
    t = CheckedRun(conn, settings, build_fixture(tmp_path, [
        q("19:58:00", 1, 390, 400), q("19:58:01", 2, 390, 400), q("19:59:30", 3, 480, 490, 60150)]))
    t.step_to("s3@19:59:30")
    assert orders(t)[-1] == ("SELL_TO_CLOSE", "OPEN", None, 480)
    t.run_to_end()
    assert orders(t)[-1] == ("SELL_TO_CLOSE", "EXPIRED", "SESSION_END", 480)
    (pos,) = t.positions()
    assert (pos.status, pos.quantity, pos.reserved_contracts, pos.valuation_status, pos.market_value_cents) == (
        "OPEN", 1, 0, "STALE", 48_000)
    assert t.trades() == [] and t.snap().realized_pnl_cents == 0
    assert queries.list_exit_intents(conn, t.run_id)[0]["resolved_at"] is None
    run = t.run()
    assert run["status"] == "INCOMPLETE"
    event = queries.list_run_events(conn, t.run_id)[-1]
    assert event["event_type"] == "RUN_INCOMPLETE" and event["payload"]["open_positions"][0]["quantity"] == 1


# --- 9. multiple qualifying contracts, point-in-time selection ---------------------


MULTI = [
    contract("C600_OCT30", "2026-10-30", 60000),
    contract("C600_NOV06", "2026-11-06", 60000),
    contract("C605_OCT30", "2026-10-30", 60500),
    contract("C595_OCT30", "2026-10-30", 59500),
    contract("C600_OCT28", "2026-10-28", 60000),   # 29 days: outside the 30-45 day window
]


def test_multi_contract_selection_waits_for_the_selected_contracts_quote(conn, settings, tmp_path):
    t = CheckedRun(conn, settings, build_fixture(tmp_path, [
        q("14:00:00", 1, 440, 450, cid="C605_OCT30"),
        q("14:00:01", 2, 500, 510, cid="C600_NOV06"),
        q("14:00:02", 3, 395, 405, cid="C600_OCT28"),
        q("14:00:03", 4, 390, 400, cid="C600_OCT30"),
        q("14:00:04", 5, 640, 650, cid="C595_OCT30"),
    ], contracts=MULTI))
    t.step_to("s3@14:00:02")
    assert t.proposals() == []                     # the selected contract has no quote yet: no substitution
    t.step_to("s4@14:00:03")
    (p,) = t.proposals()
    assert (p["contract_id"], p["limit_cents"], p["quote_source_sequence"]) == ("C600_OCT30", 400, 4)


def test_multi_contract_selection_follows_the_underlying(conn, settings, tmp_path):
    t = CheckedRun(conn, settings, build_fixture(tmp_path, [
        q("14:00:00", 1, 440, 450, und=60001, cid="C605_OCT30"),   # 600 strike is now below the underlying
    ], contracts=MULTI))
    t.run_to_end()
    assert [p["contract_id"] for p in t.proposals()] == ["C605_OCT30"]


def test_multi_contract_selection_ignores_stale_quote_of_selected_contract(conn, settings, tmp_path):
    t = CheckedRun(conn, settings, build_fixture(tmp_path, [
        q("14:00:00", 1, 390, 400, und=59_900, cid="C600_OCT30"),   # below threshold
        q("14:00:05", 2, 440, 450, cid="C605_OCT30"),              # threshold met; C600 quote is 5 s old
        q("14:00:06", 3, 391, 401, cid="C600_OCT30"),
    ], contracts=MULTI))
    t.step_to("s2@14:00:05")
    assert t.proposals() == []
    t.step()
    assert [(p["contract_id"], p["limit_cents"]) for p in t.proposals()] == [("C600_OCT30", 401)]


# --- 10. determinism across stress fixtures and stepping styles ------------------


def _projection(tmp_path, name, quotes, contracts=None, stepwise=True):
    s = make_settings(tmp_path / name)
    c = connect(s.db_path, create=True)
    t = CheckedRun(c, s, build_fixture(s.db_path.parent, quotes, contracts, fixture_id="determinism"), key="det")
    if stepwise:
        t.run_to_end()
    else:
        replay.run_to_end(c, t.run_id, "all")

    def strip(d):
        return {k: v for k, v in dict(d).items()
                if not (k.endswith("_id") or k in ("idempotency_key", "recorded_at", "snapshot_id"))}

    out = {
        "events": [(e["event_sequence"], e["event_type"], e["simulated_at"])
                   for e in queries.list_run_events(c, t.run_id)],
        "replay": [strip(e) for e in queries.list_replay_events(c, t.run_id)],
        "proposals": [strip(p) for p in t.proposals()],
        "orders": [strip(o) for o in t.orders()],
        "fills": [strip(f) for f in t.fills()],
        "ledger": [strip(e) for e in queries.list_ledger(c, t.run_id)],
        "positions": [strip(p.model_dump()) for p in t.positions()],
        "trades": [strip(x.model_dump()) for x in t.trades()],
        "snapshot": strip(t.snap().model_dump()),
        "status": t.run()["status"],
    }
    c.close()
    return out


STRESS = [Q1, Q2, q("14:05:00", 3, 300, 310), q("14:05:01", 4, 280, 290),
          q("14:05:10", 5, 1, 2, observed=DAY + "14:00:00Z"), q("14:06:05", 6, 290, 300),
          q("14:06:06", 7, 290, 300, bid_size=0), q("14:06:07", 8, 290, 300)]


@pytest.mark.parametrize("quotes, contracts", [
    (STRESS, None),
    ([q("14:00:00", 1, 440, 450, cid="C605_OCT30"), q("14:00:03", 2, 390, 400, cid="C600_OCT30"),
      q("14:00:04", 3, 390, 400, cid="C600_OCT30"), q("14:30:05", 4, 400, 410, cid="C600_OCT30"),
      q("14:30:06", 5, 400, 410, cid="C600_OCT30")], MULTI),
], ids=["gap_retry_invalid", "multi_contract_time_exit"])
def test_identical_inputs_identical_results(tmp_path, quotes, contracts):
    a = _projection(tmp_path, "a", quotes, contracts)
    b = _projection(tmp_path, "b", quotes, contracts)
    c = _projection(tmp_path, "c", quotes, contracts, stepwise=False)   # replay-to-end vs single steps
    assert a == b == c
    assert a["trades"], "scenario should complete a trade"


# --- 11. reconciliation failure: mutations blocked, safe pause and reads allowed --------


def test_pause_is_safe_on_unreconciled_running_run(conn, settings, tmp_path):
    t = CheckedRun(conn, settings, build_fixture(tmp_path, [Q1, Q2, q("14:00:02", 3, 390, 400)]))
    t.step_to("s2@14:00:01")
    conn.execute("UPDATE positions SET remaining_cost_basis_cents = 1")
    result = replay.pause(conn, t.run_id, "pause")              # safe action: not blocked
    assert result["replay_status"] == "PAUSED" and t.run()["status"] == "PAUSED"
    before = conn.execute("SELECT COUNT(*) FROM orders").fetchone()[0]
    with pytest.raises(trading.ReconciliationFailedError):
        replay.resume(conn, t.run_id, "resume")
    with pytest.raises(trading.ReconciliationFailedError):
        replay.request_close(conn, t.run_id, "close")
    assert conn.execute("SELECT COUNT(*) FROM orders").fetchone()[0] == before
    assert queries.display_positions(conn, t.run_id)[0]["untrusted"] is True     # diagnostics still readable


# --- regression: Step 6 finding F1 (reconcile accepted an inflated valuation) -------


def _holding(conn, settings, tmp_path):
    t = CheckedRun(conn, settings, build_fixture(tmp_path, [Q1, Q2, q("14:00:02", 3, 395, 405),
                                                            q("14:00:03", 4, 395, 405)]))
    t.step_to("s3@14:00:02")
    return t


def test_f1_inflated_valuation_fails_reconciliation_and_blocks_trading(conn, settings, tmp_path):
    from paper_trading.accounting import reconcile

    t = _holding(conn, settings, tmp_path)
    # Value and unrealized agree with each other, so the equity identity still holds.
    conn.execute("UPDATE positions SET market_value_cents = 900000, "
                 "unrealized_pnl_cents = 900000 - remaining_cost_basis_cents")
    result = reconcile(conn, t.run_id)
    assert not result.ok and any("mark bid x multiplier x qty (39500)" in d for d in result.discrepancies)
    with pytest.raises(trading.ReconciliationFailedError):
        replay.step(conn, t.run_id, "next")
    assert t.run()["status"] == "PAUSED" and len(t.fills()) == 1


def test_f1_mark_must_be_latest_accepted_quote(conn, settings, tmp_path):
    from paper_trading.accounting import reconcile

    t = _holding(conn, settings, tmp_path)
    old = conn.execute("SELECT quote_id FROM market_quotes WHERE source_sequence = 2").fetchone()[0]
    conn.execute("UPDATE positions SET mark_quote_id = ?, market_value_cents = 39000, "
                 "unrealized_pnl_cents = 39000 - remaining_cost_basis_cents", (old,))
    result = reconcile(conn, t.run_id)
    assert not result.ok and any("latest accepted quote" in d for d in result.discrepancies)


# --- regression: Step 6 finding F3 (latest-quote panel with several contracts) ------


def test_f3_latest_quote_is_most_recent_across_contracts(conn, settings, tmp_path):
    t = CheckedRun(conn, settings, build_fixture(tmp_path, [
        q("14:00:00", 1, 390, 400, und=59_000, cid="C600_OCT30"),
        q("14:00:05", 2, 440, 450, und=59_100, cid="C605_OCT30")], contracts=MULTI))
    t.run_to_end()
    latest = queries.latest_market_state(conn, t.run_id)["latest_quotes"]
    assert [x["contract_id"] for x in latest] == ["C605_OCT30", "C600_OCT30"]
    with TestClient(create_app(settings)) as client:
        html = client.get(f"/?run={t.settings.sample_run_key}").text
    panel = html.split('id="mkt-h"')[1].split("</section>")[0]
    assert "C605_OCT30" in panel and "$4.40 / $4.50" in panel
    watch = html.split('id="wl-h"')[1].split("</section>")[0]
    assert "$591.00" in watch                                      # underlying from the most recent quote



# --- rules 5-6 interaction, end to end (SPEC.md §13.20) ------------------------------


def test_earlier_expiration_with_higher_strike_is_selected_end_to_end(conn, settings, tmp_path):
    contracts = [contract("A_OCT30_605", "2026-10-30", 60500), contract("B_NOV06_600", "2026-11-06", 60000),
                 contract("C_OCT30_610", "2026-10-30", 61000)]
    t = CheckedRun(conn, settings, build_fixture(tmp_path, [
        q("14:00:00", 1, 500, 510, cid="B_NOV06_600"),
        q("14:00:01", 2, 300, 310, cid="C_OCT30_610"),
        q("14:00:02", 3, 350, 360, cid="A_OCT30_605"),
    ], contracts=contracts))
    t.step_to("s2@14:00:01")
    assert t.proposals() == []           # selected contract (A) has no quote yet; B and C are not substituted
    t.step()
    assert [(p["contract_id"], p["limit_cents"]) for p in t.proposals()] == [("A_OCT30_605", 360)]


# --- reconciliation marks against the position's OWN contract ------------------------


def test_mark_check_uses_the_positions_own_contract(conn, settings, tmp_path):
    from paper_trading.accounting import reconcile

    t = CheckedRun(conn, settings, build_fixture(tmp_path, [
        q("14:00:00", 1, 390, 400, cid="C600_OCT30"), q("14:00:01", 2, 390, 400, cid="C600_OCT30"),
        q("14:00:02", 3, 440, 450, cid="C605_OCT30", ref="other_contract")], contracts=MULTI))
    t.step_to("other_contract")          # newer quote, but for a different contract
    (pos,) = t.positions()
    own_latest = conn.execute("SELECT quote_id FROM market_quotes WHERE source_sequence = 2").fetchone()[0]
    assert pos.contract_id == "C600_OCT30" and pos.mark_quote_id == own_latest and pos.market_value_cents == 39_000
    assert reconcile(conn, t.run_id).ok  # the other contract's newer quote does not make the mark "not latest"
    other = conn.execute("SELECT quote_id FROM market_quotes WHERE source_sequence = 3").fetchone()[0]
    conn.execute("UPDATE positions SET mark_quote_id = ?, market_value_cents = 44000, "
                 "unrealized_pnl_cents = 44000 - remaining_cost_basis_cents", (other,))
    result = reconcile(conn, t.run_id)
    assert not result.ok and any("another run or contract" in d for d in result.discrepancies)
