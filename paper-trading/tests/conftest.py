from __future__ import annotations

import json
from pathlib import Path

import pytest

from paper_trading.app import replay
from paper_trading.app.coordinator import init_sample
from paper_trading.config import Settings
from paper_trading.market_data.fixtures import FIXTURES_DIR, compute_checksum, read_fixture_file
from paper_trading.storage.db import connect


def make_settings(tmp_path, **overrides) -> Settings:
    # _env_file=None keeps a developer's local .env out of the tests.
    return Settings(_env_file=None, db_path=tmp_path / "test.sqlite3", **overrides)


@pytest.fixture
def settings(tmp_path) -> Settings:
    return make_settings(tmp_path)


@pytest.fixture
def conn(settings):
    c = connect(settings.db_path, create=True)
    yield c
    c.close()


@pytest.fixture
def initialized(conn, settings):
    return init_sample(conn, settings)


# --- Step 4 fixture helpers ----------------------------------------------

WORKED_FIXTURE = FIXTURES_DIR / "sample_spy_worked_trade_v1.json"
INVALID_FIXTURE = Path(__file__).resolve().parent / "fixtures" / "test_invalid_inputs_v1.json"


def load_path(conn, run_id, path):
    doc, content = read_fixture_file(path)
    return replay.load_fixture(conn, run_id, doc, content)


def fixture_variant(tmp_path, mutate, *, base=WORKED_FIXTURE, name="variant.json", recompute=True) -> Path:
    """Copy a fixture, apply ``mutate(dict)``, and (by default) re-sign its checksum."""
    data = json.loads(Path(base).read_text(encoding="utf-8"))
    mutate(data)
    if recompute:
        data["checksum"] = compute_checksum(data)
    path = tmp_path / name
    path.write_text(json.dumps(data, indent=2), encoding="utf-8")
    return path


@pytest.fixture
def worked(conn, initialized):
    load_path(conn, initialized.run_id, WORKED_FIXTURE)
    return initialized


@pytest.fixture
def invalid(conn, initialized):
    load_path(conn, initialized.run_id, INVALID_FIXTURE)
    return initialized


class Keys:
    """Fresh idempotency keys for tests."""

    def __init__(self):
        self.n = 0

    def __call__(self) -> str:
        self.n += 1
        return f"test-key-{self.n}"


@pytest.fixture
def key():
    return Keys()
