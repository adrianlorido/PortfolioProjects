"""API responses and dashboard rendering, backed by a real initialized database."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from paper_trading.app.api import create_app
from paper_trading.storage.db import DatabaseNotInitializedError, connect
from paper_trading.storage.migrator import migrate


@pytest.fixture
def client(initialized, settings):
    with TestClient(create_app(settings)) as c:
        yield c


def test_health(client, initialized):
    body = client.get("/health").json()
    assert body["status"] == "ok"
    assert body["mode"] == "SAMPLE_PAPER" and body["is_sample"] is True
    assert body["db_schema_version"] == 1
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


def test_no_write_endpoints(client):
    for path in ["/api/orders", "/api/account", "/api/positions"]:
        assert client.post(path, json={}).status_code == 405
    write_routes = [r for r in client.app.routes if getattr(r, "methods", set()) - {"GET", "HEAD"}]
    assert write_routes == []


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
    assert "Not implemented" in html
    assert "excludes exit fee" in html
    # Execution controls are disabled.
    assert html.count("disabled>") >= 3


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
