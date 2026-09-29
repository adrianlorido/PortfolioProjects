"""API responses and dashboard rendering, backed by a real initialized database."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from paper_trading.app.api import create_app
from paper_trading.storage.db import DatabaseNotInitializedError, connect
from paper_trading.storage import migrator
from paper_trading.storage.migrator import migrate


@pytest.fixture
def client(initialized, settings):
    with TestClient(create_app(settings)) as c:
        yield c


def test_health(client, initialized):
    body = client.get("/health").json()
    assert body["status"] == "ok"
    assert body["mode"] == "SAMPLE_PAPER" and body["is_sample"] is True
    assert body["db_schema_version"] == len(migrator.discover())
    assert body["run_initialized"] is True and body["run_id"] == initialized.run_id


def test_account_endpoint(client, initialized):
    body = client.get("/api/account").json()
    snap = body["snapshot"]
    assert snap["account_id"] == initialized.account_id
    assert snap["starting_cash_cents"] == snap["cash_cents"] == snap["available_cash_cents"] == 10_000_000
    assert snap["equity_cents"] == 10_000_000
    assert snap["reserved_cash_cents"] == snap["realized_pnl_cents"] == snap["unrealized_pnl_cents"] == 0
    assert isinstance(snap["cash_cents"], int)
    assert body["reconciliation"] == {"ok": True, "discrepancies": []}
    assert "excludes prospective exit fee" in body["unrealized_pnl_convention"]


def test_run_and_watchlist(client, initialized):
    run = client.get("/api/run").json()
    assert run["run_id"] == initialized.run_id
    assert run["session_local_date"] == "2026-09-29"
    assert run["session_timezone"] == "America/New_York"
    assert client.get("/api/watchlist").json() == {"run_id": initialized.run_id, "symbols": ["SPY"]}


@pytest.mark.parametrize("path", ["/api/positions", "/api/orders", "/api/closed-trades"])
def test_empty_collections(client, path):
    r = client.get(path)
    assert r.status_code == 200 and r.json() == []


def test_only_replay_and_trading_commands_accept_writes(client):
    for path in ["/api/orders", "/api/account", "/api/positions", "/api/closed-trades", "/api/quotes"]:
        assert client.post(path, json={}).status_code == 405
    write_paths = sorted(
        r.path for r in client.app.routes if getattr(r, "methods", set()) - {"GET", "HEAD"}
    )
    assert write_paths == sorted(
        [f"/api/replay/{c}" for c in ("load", "step", "pause", "resume", "run-to-end")]
        + [f"/api/trading/{c}" for c in ("start", "request-close", "cancel")]
    )


def test_dashboard_renders_backend_values(client, initialized):
    r = client.get("/")
    assert r.status_code == 200
    html = r.text
    assert "SAMPLE DATA — PAPER ONLY" in html
    assert html.count("$100,000.00") >= 4  # starting, cash, available, equity
    assert "SPY" in html
    assert initialized.run_id in html
    assert "Ledger reconciled" in html
    assert "No positions." in html and "No orders." in html and "No closed trades." in html
    # Replay-only runs (the default sample run) never trade; their trading controls are unavailable.
    assert "REPLAY-ONLY RUN" in html
    assert "Start trading — replay-only run" in html
    assert "Request close — replay-only run" in html
    assert "excludes exit fee" in html
    # Trading controls are disabled buttons.
    assert html.count("disabled>Start trading") == 1 and html.count("disabled>Request close") == 1
    assert 'data-command="start"' not in html and 'data-command="request-close"' not in html


def test_static_assets_served(client):
    assert client.get("/static/dashboard.js").status_code == 200
    assert client.get("/static/style.css").status_code == 200


def test_dashboard_when_run_missing(tmp_path):
    from conftest import make_settings

    s = make_settings(tmp_path)
    c = connect(s.db_path, create=True)
    migrate(c)  # schema only, no sample run
    c.close()
    with TestClient(create_app(s)) as client:
        assert client.get("/health").json()["run_initialized"] is False
        r = client.get("/")
        assert r.status_code == 404 and "init-sample" in r.text
        assert "SAMPLE DATA — PAPER ONLY" in r.text
        assert client.get("/api/account").status_code == 404


def test_startup_refuses_missing_database(tmp_path):
    from conftest import make_settings

    s = make_settings(tmp_path)
    with pytest.raises(DatabaseNotInitializedError):
        with TestClient(create_app(s)):
            pass
    assert not s.db_path.exists()
