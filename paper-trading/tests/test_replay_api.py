"""Replay over HTTP: command endpoints, read endpoints, and dashboard rendering."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from paper_trading.app.api import create_app


@pytest.fixture
def client(initialized, settings):
    with TestClient(create_app(settings)) as c:
        yield c


def load(client):
    return client.post("/api/replay/load", json={"fixture_id": "sample_spy_worked_trade"})


def cmd(client, name, key):
    return client.post(f"/api/replay/{name}", json={"idempotency_key": key})


def test_load_via_api_is_idempotent(client):
    first, second = load(client), load(client)
    assert first.status_code == second.status_code == 200
    assert first.json()["created"] is True and second.json()["created"] is False
    state = client.get("/api/replay").json()
    assert state["replay"]["fixture_id"] == "sample_spy_worked_trade"
    assert state["replay"]["status"] == "ACTIVE" and state["replay"]["total_events"] == 6
    assert state["available_fixtures"] == ["sample_spy_worked_trade"]
    assert state["run_status"] == "READY"


def test_only_bundled_fixtures_loadable_over_http(client):
    for fixture_id in ("test_invalid_inputs", "../tests/fixtures/test_invalid_inputs_v1"):
        assert client.post("/api/replay/load", json={"fixture_id": fixture_id}).status_code == 404
    assert client.post("/api/replay/load", json={"path": "/etc/passwd"}).status_code == 422


def test_step_through_api_and_read_models(client):
    load(client)
    results = [cmd(client, "step", f"k{i}").json() for i in range(3)]
    assert [r["fixture_ref"] for r in results] == ["open", "q1", "q2"]

    market = client.get("/api/market").json()
    assert market["simulated_clock"] == "2026-09-29T14:00:01Z"
    (q,) = market["latest_quotes"]
    assert (q["source_sequence"], q["bid_cents"], q["freshness"], q["age_seconds"]) == (2, 390, "FRESH", 0.0)

    quotes = client.get("/api/quotes").json()
    assert [x["source_sequence"] for x in quotes] == [1, 2]
    events = client.get("/api/replay/events").json()
    assert [e["outcome"] for e in events] == ["BOUNDARY", "ACCEPTED", "ACCEPTED"]
    assert client.get("/api/rejected-inputs").json() == []


def test_command_retry_and_conflict_over_http(client):
    load(client)
    a, b = cmd(client, "step", "same"), cmd(client, "step", "same")
    assert a.status_code == b.status_code == 200
    assert b.json()["idempotent_replay"] is True and b.json()["replay_position"] == a.json()["replay_position"] == 1
    assert client.get("/api/replay").json()["replay"]["processed_events"] == 1
    conflict = cmd(client, "pause", "same")
    assert conflict.status_code == 409 and conflict.json()["error"] == "IdempotencyConflictError"


def test_command_errors_map_to_clear_statuses(client):
    r = cmd(client, "step", "early")
    assert r.status_code == 409 and r.json()["error"] == "REPLAY_NOT_LOADED"
    load(client)
    assert cmd(client, "pause", "p").status_code == 200
    r = cmd(client, "step", "while-paused")
    assert r.status_code == 409 and r.json()["error"] == "REPLAY_PAUSED"
    assert cmd(client, "resume", "r").status_code == 200
    assert cmd(client, "run-to-end", "all").json()["replay_status"] == "EXHAUSTED"
    r = cmd(client, "step", "after-end")
    assert r.status_code == 409 and r.json()["error"] == "REPLAY_EXHAUSTED"
    assert client.post("/api/replay/step", json={}).status_code == 422  # key required
    assert client.post("/api/replay/step", json={"idempotency_key": "x", "extra": 1}).status_code == 422


def test_replay_leaves_account_unchanged_over_http(client):
    load(client)
    cmd(client, "run-to-end", "all")
    snap = client.get("/api/account").json()
    assert snap["reconciliation"] == {"ok": True, "discrepancies": []}
    s = snap["snapshot"]
    assert s["cash_cents"] == s["equity_cents"] == s["available_cash_cents"] == 10_000_000
    assert s["realized_pnl_cents"] == s["unrealized_pnl_cents"] == 0 and s["account_revision"] == 1
    for path in ("/api/positions", "/api/orders", "/api/closed-trades"):
        assert client.get(path).json() == []


def test_dashboard_before_load_offers_load_button(client):
    html = client.get("/").text
    assert "SAMPLE DATA — PAPER ONLY" in html
    assert 'data-command="load"' in html and "No fixture loaded" in html
    assert 'data-command="step"' not in html


def test_dashboard_during_replay(client):
    load(client)
    for i in range(3):
        cmd(client, "step", f"s{i}")
    html = client.get("/").text
    assert "SAMPLE DATA — PAPER ONLY" in html
    assert "SYNTHETIC SAMPLE DATA" in html
    assert "sample_spy_worked_trade" in html and "v1.0.0" in html
    assert "2026-09-29T14:00:01Z" in html  # simulated time
    assert "3 / 6 events" in html
    assert "$3.90 / $4.00" in html and "FRESH" in html
    assert 'data-command="step"' in html and 'data-command="pause"' in html
    assert 'data-command="run-to-end"' in html
    assert "Start trading — replay-only run" in html
    assert html.count("$100,000.00") >= 4
    assert "No positions." in html and "No orders." in html and "No closed trades." in html


def test_dashboard_shows_rejections_and_exhaustion(tmp_path):
    from conftest import INVALID_FIXTURE, load_path, make_settings
    from paper_trading.app import replay
    from paper_trading.app.coordinator import init_sample
    from paper_trading.storage.db import connect

    s = make_settings(tmp_path)
    c = connect(s.db_path, create=True)
    init = init_sample(c, s)
    load_path(c, init.run_id, INVALID_FIXTURE)
    replay.run_to_end(c, init.run_id, "all")
    c.close()
    with TestClient(create_app(s)) as client:
        html = client.get("/").text
        for reason in ("STALE_QUOTE", "FUTURE_OBSERVATION", "CROSSED_QUOTE", "DUPLICATE_SEQUENCE",
                       "OUT_OF_ORDER_SEQUENCE", "MISSING_SIZE", "REFERENCE_PRICE_MISMATCH"):
            assert reason in html
        assert "Replay exhausted" in html and "not</strong> a completed demonstration trade" in html
        assert "STALE" in html  # last accepted quote is hours old at session close
        assert 'data-command="step" disabled' in html
        assert len(client.get("/api/rejected-inputs").json()) == 7
