"""Persistence across real process restarts: CLI init, then the server started twice."""

from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

import pytest

PROJECT = Path(__file__).resolve().parent.parent


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def env_for(db_path: Path, port: int) -> dict:
    env = {k: v for k, v in os.environ.items() if not k.startswith("PAPER_")}
    env.update(PAPER_DB_PATH=str(db_path), PAPER_PORT=str(port), PAPER_HOST="127.0.0.1")
    return env


def cli(args: list[str], env: dict) -> subprocess.CompletedProcess:
    return subprocess.run([sys.executable, "-m", "paper_trading", *args], cwd=PROJECT, env=env,
                          capture_output=True, text=True, timeout=60)


def get_json(port: int, path: str) -> dict:
    with urllib.request.urlopen(f"http://127.0.0.1:{port}{path}", timeout=5) as r:
        return json.loads(r.read())


def serve_and_read(env: dict, port: int, *paths: str) -> tuple[dict, ...]:
    """Start the server in a new process, GET each path, then stop it."""
    paths = paths or ("/health", "/api/account")
    proc = subprocess.Popen([sys.executable, "-m", "paper_trading", "serve"], cwd=PROJECT, env=env,
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    try:
        deadline = time.time() + 20
        while True:
            try:
                return tuple(get_json(port, p) for p in paths)
            except OSError:
                if time.time() > deadline or proc.poll() is not None:
                    out = proc.stdout.read().decode() if proc.poll() is not None else ""
                    pytest.fail(f"server did not start: {out}")
                time.sleep(0.2)
    finally:
        proc.terminate()
        proc.wait(timeout=10)


def test_data_survives_restart(tmp_path):
    db = tmp_path / "restart.sqlite3"
    port = free_port()
    env = env_for(db, port)

    first = cli(["init-sample"], env)
    assert first.returncode == 0, first.stderr
    assert "Created sample run" in first.stdout

    health1, account1 = serve_and_read(env, port)
    health2, account2 = serve_and_read(env, port)
    assert health1["run_id"] == health2["run_id"]
    assert account1 == account2
    assert account2["snapshot"]["cash_cents"] == 10_000_000
    assert account2["reconciliation"]["ok"] is True

    again = cli(["init-sample"], env)
    assert again.returncode == 0 and "Already initialized" in again.stdout
    assert health1["run_id"] in again.stdout


def test_serve_without_database_fails_clearly(tmp_path):
    db = tmp_path / "missing.sqlite3"
    result = cli(["serve"], env_for(db, free_port()))
    assert result.returncode == 2
    assert "init-sample" in result.stderr
    assert not db.exists()



def test_replay_progress_survives_process_restarts(tmp_path):
    """Each CLI call is a separate process; the server is started between steps."""
    db = tmp_path / "replay.sqlite3"
    port = free_port()
    env = env_for(db, port)
    assert cli(["init-sample"], env).returncode == 0

    loaded = cli(["load-fixture"], env)
    assert loaded.returncode == 0, loaded.stderr
    assert "Loaded fixture sample_spy_worked_trade v1.0.0 (6 events)" in loaded.stdout
    assert "Already loaded" in cli(["load-fixture"], env).stdout

    first = cli(["step", "--key", "step-1"], env)
    assert first.returncode == 0 and '"fixture_ref": "open"' in first.stdout
    second = cli(["step", "--key", "step-2"], env)
    assert '"fixture_ref": "q1"' in second.stdout
    retry = cli(["step", "--key", "step-2"], env)  # retried command in a new process
    assert '"idempotent_replay": true' in retry.stdout and '"fixture_ref": "q1"' in retry.stdout

    (state,) = serve_and_read(env, port, "/api/replay")
    assert state["replay"]["processed_events"] == 2 and state["replay"]["next_position"] == 3
    assert state["simulated_clock"] == "2026-09-29T14:00:00Z"
    (state_again,) = serve_and_read(env, port, "/api/replay")  # a second server restart
    assert state_again == state

    final = cli(["replay-to-end"], env)
    assert final.returncode == 0 and '"steps_executed": 4' in final.stdout
    status = cli(["replay-status"], env).stdout
    assert "EXHAUSTED  6/6 events" in status
    assert status.count(" ACCEPTED") == 4

    summary = cli(["status"], env).stdout
    assert "cash $100,000.00" in summary and "equity $100,000.00" in summary and "revision 1" in summary
    assert "reconciliation: PASS" in summary


def test_step3_database_upgrades_without_losing_data(tmp_path, monkeypatch):
    """A database created by Step 3 (schema v1) is refused until migrated, then keeps its data."""
    from paper_trading.app.coordinator import init_sample
    from paper_trading.config import Settings
    from paper_trading.storage import migrator
    from paper_trading.storage.db import connect

    db = tmp_path / "step3.sqlite3"
    env = env_for(db, free_port())
    only_v1 = migrator.discover()[:1]
    monkeypatch.setattr(migrator, "discover", lambda: only_v1)
    conn = connect(db, create=True)
    result = init_sample(conn, Settings(_env_file=None, db_path=db))
    conn.close()
    monkeypatch.undo()

    refused = cli(["load-fixture"], env)
    pending = list(range(2, len(migrator.discover()) + 1))
    assert refused.returncode == 2 and f"pending migrations {pending}" in refused.stderr

    migrated = cli(["migrate"], env)
    assert migrated.returncode == 0 and f"Applied migrations: {pending}" in migrated.stdout
    summary = cli(["status"], env).stdout
    assert result.run_id in summary and "cash $100,000.00" in summary and "PASS" in summary
    assert cli(["load-fixture"], env).returncode == 0


def test_trading_demo_across_process_restarts(tmp_path):
    """The README demo: every command is a new process; the server restarts mid-run."""
    db = tmp_path / "trading.sqlite3"
    port = free_port()
    env = env_for(db, port)
    k = ["--run-key", "trading-demo-001"]

    created = cli(k + ["init-sample", "--trading"], env)
    assert created.returncode == 0 and "trading, key trading-demo-001" in created.stdout
    assert cli(k + ["load-fixture"], env).returncode == 0
    assert '"run_status": "RUNNING"' in cli(k + ["start"], env).stdout
    for i in range(2):   # SESSION_OPEN, q1 (entry order accepted)
        assert cli(k + ["step", "--key", f"s{i}"], env).returncode == 0

    (account, orders) = serve_and_read(env, port, "/api/account?run=trading-demo-001",
                                       "/api/orders?run=trading-demo-001")
    assert account["snapshot"]["reserved_cash_cents"] == 40_065 and orders[0]["status"] == "OPEN"

    retry = cli(k + ["step", "--key", "s1"], env)          # retried command after restarts
    assert '"idempotent_replay": true' in retry.stdout
    assert cli(k + ["replay-to-end"], env).returncode == 0

    summary = cli(k + ["status"], env).stdout
    assert "[COMPLETED] trading" in summary and "cash $100,078.70" in summary and "equity $100,078.70" in summary
    assert "realized $78.70" in summary and "reserved $0.00" in summary and "reconciliation: PASS" in summary
    trades = cli(k + ["trades"], env).stdout
    assert "PROFIT_TARGET: entry cost $400.65 exit net $479.35 fees $1.30 realized $78.70" in trades
    assert trades.count("order FILLED") == 2

    # The default replay-only run is untouched and still cannot trade.
    assert cli(["init-sample"], env).returncode == 0
    refused = cli(["start"], env)
    assert refused.returncode == 2 and "replay-only" in refused.stderr
