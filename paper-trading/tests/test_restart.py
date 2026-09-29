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


def serve_and_read(env: dict, port: int) -> tuple[dict, dict]:
    proc = subprocess.Popen([sys.executable, "-m", "paper_trading", "serve"], cwd=PROJECT, env=env,
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    try:
        deadline = time.time() + 20
        while True:
            try:
                return get_json(port, "/health"), get_json(port, "/api/account")
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
