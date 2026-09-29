from __future__ import annotations

import pytest

from paper_trading.app.coordinator import init_sample
from paper_trading.config import Settings
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
