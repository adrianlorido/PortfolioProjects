"""FA-1a: bounded API/dashboard queries, pagination, and data-class banners."""

import pytest
from fastapi.testclient import TestClient

from dataset_helpers import large_contracts, large_events, store_kwargs
from paper_trading.app import queries, replay
from paper_trading.app.api import API_PAGE_MAX, create_app
from paper_trading.app.coordinator import init_sample
from paper_trading.market_data.datasets import store_dataset
from paper_trading.storage.migrator import migrate

N_QUOTES = 300


@pytest.fixture
def long_run(conn, settings):
    """A trading run with 302 replayed events (one trade, a few rejections)."""
    init = init_sample(conn, settings, trading=True)
    store_dataset(conn, **store_kwargs("long", large_events(N_QUOTES), contracts=large_contracts()))
    replay.attach_dataset(conn, init.run_id, "long", "1.0.0")
    replay.start_trading(conn, init.run_id, "long-start")
    replay.run_to_end(conn, init.run_id, "long-all")
    return init


@pytest.fixture
def client(conn, settings):
    migrate(conn)  # the app refuses to start on an empty database
    with TestClient(create_app(settings)) as c:
        yield c


def test_api_lists_are_paged_with_a_total_count(long_run, client):
    r = client.get("/api/replay/events", params={"limit": 10, "offset": 5})
    assert r.status_code == 200 and r.headers["X-Total-Count"] == str(N_QUOTES + 2)
    assert [e["replay_position"] for e in r.json()] == list(range(6, 16))
    full = client.get("/api/replay/events").json()  # default page (500) still returns small runs whole
    assert len(full) == N_QUOTES + 2
    quotes = client.get("/api/quotes", params={"limit": 3})
    assert len(quotes.json()) == 3 and int(quotes.headers["X-Total-Count"]) > 250
    rejected = client.get("/api/rejected-inputs", params={"offset": 1, "limit": 2})
    assert rejected.headers["X-Total-Count"] == "3" and [x["replay_position"] for x in rejected.json()] == [149, 246]
    events = client.get("/api/run-events", params={"limit": 1})
    assert events.json()[0]["event_type"] == "RUN_CREATED" and int(events.headers["X-Total-Count"]) > N_QUOTES


@pytest.mark.parametrize("params", [{"limit": 0}, {"limit": API_PAGE_MAX + 1}, {"offset": -1}, {"limit": "x"}])
def test_page_bounds_are_enforced(long_run, client, params):
    assert client.get("/api/quotes", params=params).status_code == 422


def test_paged_reads_match_the_unpaged_list(conn, long_run):
    whole = queries.list_replay_events(conn, long_run.run_id)
    pages = [e for off in range(0, len(whole), 64)
             for e in queries.list_replay_events(conn, long_run.run_id, limit=64, offset=off)]
    assert pages == whole


def test_dashboard_shows_only_the_latest_page(conn, long_run, client):
    run = queries.list_runs(conn)[0]
    dash = queries.get_dashboard(conn, run["init_key"])
    assert len(dash.replay_events) == queries.DASHBOARD_PAGE
    assert dash.replay_events[-1]["replay_position"] == N_QUOTES + 2
    assert dash.pages["replay_events"] == {"total": N_QUOTES + 2, "offset": N_QUOTES + 2 - 50, "shown": 50}
    html = client.get("/").text
    assert f"Showing the latest 50 of {N_QUOTES + 2} replay events" in html


# --- banners ---------------------------------------------------------------------------


def test_synthetic_run_shows_sample_banner_and_synthetic_labels(long_run, client):
    html = client.get("/").text
    assert "SAMPLE DATA — PAPER ONLY" in html and 'data-data-class="SYNTHETIC"' in html
    assert "SYNTHETIC DATA" in html and "HISTORICAL DATA" not in html
    assert "synthetic: not market observations" in html and "Sample-data replay" in html


def test_historical_run_shows_historical_banner_and_never_the_sample_one(conn, settings, client):
    init_sample(conn, settings, mode="HISTORICAL_PAPER")
    html = client.get("/").text
    assert "HISTORICAL DATA — PAPER ONLY" in html and 'data-data-class="HISTORICAL"' in html
    assert "SAMPLE DATA — PAPER ONLY" not in html and "SYNTHETIC DATA" not in html
    assert "not a prediction or evidence of profitability" in html
    assert "No historical dataset attached" in html and "Load sample fixture" not in html
    health = client.get("/health").json()
    assert (health["mode"], health["is_sample"]) == ("HISTORICAL_PAPER", False)
    run = client.get("/api/run").json()
    assert (run["mode"], run["is_sample"]) == ("HISTORICAL_PAPER", False)


def test_historical_and_synthetic_runs_coexist(conn, settings, long_run, client):
    init_sample(conn, settings.model_copy(update={"sample_run_key": "hist"}), mode="HISTORICAL_PAPER")
    modes = {r["init_key"]: r["mode"] for r in client.get("/api/runs").json()}
    assert sorted(modes.values()) == ["HISTORICAL_PAPER", "SAMPLE_PAPER"]
    assert "HISTORICAL DATA — PAPER ONLY" in client.get("/", params={"run": "hist"}).text
    assert "SAMPLE DATA — PAPER ONLY" in client.get("/").text


def test_unknown_mode_is_refused(conn, settings):
    with pytest.raises(ValueError, match="unknown run mode"):
        init_sample(conn, settings, mode="LIVE")
