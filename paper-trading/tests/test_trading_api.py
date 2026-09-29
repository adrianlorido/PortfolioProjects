"""Trading runs over HTTP: commands, read endpoints, dashboard, startup reconciliation."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from paper_trading.app.api import create_app
from paper_trading.app.coordinator import init_sample

from conftest import WORKED_FIXTURE, load_path
from trading_helpers import build_fixture, q

RUN = "trading-demo-001"


@pytest.fixture
def trading_client(conn, settings):
    init = init_sample(conn, settings.model_copy(update={"sample_run_key": RUN}), trading=True)
    load_path(conn, init.run_id, WORKED_FIXTURE)
    with TestClient(create_app(settings)) as c:
        yield c


def post(client, path, **body):
    return client.post(f"/api/{path}?run={RUN}", json={"idempotency_key": f"k-{path}-{len(body)}", **body})


def test_full_demo_over_http(trading_client):
    c = trading_client
    assert post(c, "trading/start").json()["run_status"] == "RUNNING"
    assert post(c, "replay/run-to-end").json()["replay_status"] == "EXHAUSTED"

    snap = c.get(f"/api/account?run={RUN}").json()
    s = snap["snapshot"]
    assert (s["cash_cents"], s["equity_cents"], s["realized_pnl_cents"], s["reserved_cash_cents"],
            s["fees_paid_cents"]) == (10_007_870, 10_007_870, 7_870, 0, 130)
    assert snap["reconciliation"]["ok"] is True
    assert [p["reason_code"] for p in c.get(f"/api/proposals?run={RUN}").json()] == ["ENTRY_SIGNAL", "PROFIT_TARGET"]
    assert [d["decision"] for d in c.get(f"/api/risk-decisions?run={RUN}").json()] == ["APPROVED", "APPROVED"]
    assert [f["price_cents"] for f in c.get(f"/api/fills?run={RUN}").json()] == [400, 480]
    assert [o["status"] for o in c.get(f"/api/orders?run={RUN}").json()] == ["FILLED", "FILLED"]
    (trade,) = c.get(f"/api/closed-trades?run={RUN}").json()
    assert trade["realized_pnl_cents"] == 7_870
    assert [e["entry_type"] for e in c.get(f"/api/ledger?run={RUN}").json()] == [
        "INITIAL_FUNDING", "BUY_FILL", "SELL_FILL"]
    assert c.get(f"/api/run?run={RUN}").json()["status"] == "COMPLETED"

    html = c.get(f"/?run={RUN}").text
    assert "SAMPLE DATA — PAPER ONLY" in html and "TRADING RUN" in html
    assert "Run COMPLETED" in html and "$100,078.70" in html and "+$78.70" in html
    assert "PROFIT_TARGET" in html and "ENTRY_SIGNAL" in html and "demonstration rules only" in html
    assert "excluding the prospective exit fee" in html
    assert "No closed trades." not in html and "No fills." not in html


def test_default_run_is_still_the_replay_only_sample(trading_client, initialized):
    runs = trading_client.get("/api/runs").json()
    assert {r["init_key"]: r["trading_enabled"] for r in runs} == {RUN: 1, "sample-run-001": 0}
    html = trading_client.get("/").text
    assert "REPLAY-ONLY RUN" in html and f"?run={RUN}" in html
    r = trading_client.post("/api/trading/start", json={"idempotency_key": "x"})
    assert r.status_code == 409 and r.json()["error"] == "NOT_A_TRADING_RUN"


def test_trading_command_errors(trading_client):
    c = trading_client
    r = post(c, "replay/step")
    assert r.status_code == 409 and r.json()["error"] == "RUN_STATE"
    post(c, "trading/start")
    r = post(c, "trading/request-close")
    assert r.status_code == 409 and r.json()["error"] == "NO_OPEN_POSITION"
    r = post(c, "trading/cancel", order_id="nope")
    assert r.status_code == 404 and r.json()["error"] == "ORDER_NOT_FOUND"
    assert c.post(f"/api/trading/cancel?run={RUN}", json={"idempotency_key": "k"}).status_code == 422


def test_cancel_and_manual_close_over_http(conn, settings, tmp_path):
    fixture = build_fixture(tmp_path, [q("14:00:00", 1, 390, 400), q("14:00:01", 2, 390, 401),
                                       q("14:00:02", 3, 390, 400), q("14:00:03", 4, 390, 400)])
    init = init_sample(conn, settings.model_copy(update={"sample_run_key": RUN}), trading=True)
    load_path(conn, init.run_id, fixture)
    with TestClient(create_app(settings)) as c:
        post(c, "trading/start")
        for i in range(3):   # open, entry at s1, no fill at s2 (ask 4.01)
            c.post(f"/api/replay/step?run={RUN}", json={"idempotency_key": f"s{i}"})
        (order,) = c.get(f"/api/orders?run={RUN}").json()
        html = c.get(f"/?run={RUN}").text
        assert f'data-order-id="{order["order_id"]}"' in html
        r = post(c, "trading/cancel", order_id=order["order_id"])
        assert r.json()["status"] == "CANCELED"
        assert c.get(f"/api/account?run={RUN}").json()["snapshot"]["reserved_cash_cents"] == 0
        c.post(f"/api/replay/step?run={RUN}", json={"idempotency_key": "s3"})   # new entry at s3
        c.post(f"/api/replay/step?run={RUN}", json={"idempotency_key": "s4"})   # filled at s4
        r = c.post(f"/api/trading/request-close?run={RUN}", json={"idempotency_key": "close"})
        assert r.json()["intent_created"] is True and r.json()["proposal"]["order"]["status"] == "OPEN"
        assert "MANUAL_CLOSE" in c.get(f"/?run={RUN}").text
        c.post(f"/api/replay/run-to-end?run={RUN}", json={"idempotency_key": "end"})
        run = c.get(f"/api/run?run={RUN}").json()
        assert run["status"] == "INCOMPLETE" and "no close was invented" in run["status_reason"]
        html = c.get(f"/?run={RUN}").text
        assert "Run INCOMPLETE" in html and "Open exposure remains" in html and "STALE" in html


def test_startup_reconciliation_pauses_corrupted_run(conn, settings):
    init = init_sample(conn, settings.model_copy(update={"sample_run_key": RUN}), trading=True)
    load_path(conn, init.run_id, WORKED_FIXTURE)
    from paper_trading.app import replay

    replay.start_trading(conn, init.run_id, "start")
    for i in range(3):
        replay.step(conn, init.run_id, f"s{i}")
    conn.execute("DROP TRIGGER tr_positions_entry_fixed")
    conn.execute("UPDATE positions SET remaining_cost_basis_cents = 1")
    with TestClient(create_app(settings)) as c:
        assert c.app.state.paused_on_startup == [init.run_id]
        run = c.get(f"/api/run?run={RUN}").json()
        assert run["status"] == "PAUSED" and "Reconciliation failed" in run["status_reason"]
        assert "Reconciliation FAILED" in c.get(f"/?run={RUN}").text
        r = post(c, "replay/resume")
        assert r.status_code == 409 and r.json()["error"] == "RECONCILIATION_FAILED"
