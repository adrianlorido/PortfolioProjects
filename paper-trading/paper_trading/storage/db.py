"""SQLite connections with explicit transaction control.

Connections run in autocommit mode (``isolation_level=None``) so Python never
opens transactions implicitly; every write goes through ``transaction()``,
which issues ``BEGIN IMMEDIATE`` and commits or rolls back as a unit.
"""

from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

MIN_SQLITE_VERSION = (3, 37, 0)  # STRICT tables


class DatabaseNotInitializedError(RuntimeError):
    pass


def _check_sqlite_version() -> None:
    if sqlite3.sqlite_version_info < MIN_SQLITE_VERSION:
        raise RuntimeError(
            f"SQLite {'.'.join(map(str, MIN_SQLITE_VERSION))}+ required; found {sqlite3.sqlite_version}"
        )


def connect(db_path: Path, *, create: bool = False) -> sqlite3.Connection:
    """Open the database. With ``create=False`` a missing file is an error,
    so read paths never create an empty database by accident."""
    _check_sqlite_version()
    db_path = Path(db_path)
    if create:
        db_path.parent.mkdir(parents=True, exist_ok=True)
    elif not db_path.exists():
        raise DatabaseNotInitializedError(
            f"database not found at {db_path}; run: python -m paper_trading init-sample"
        )
    mode = "rwc" if create else "rw"
    conn = sqlite3.connect(
        f"{db_path.resolve().as_uri()}?mode={mode}",
        uri=True,
        isolation_level=None,
        check_same_thread=False,
    )
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA synchronous = FULL")
    conn.execute("PRAGMA busy_timeout = 5000")
    if conn.execute("PRAGMA foreign_keys").fetchone()[0] != 1:
        raise RuntimeError("SQLite foreign key enforcement is unavailable")
    return conn


@contextmanager
def transaction(conn: sqlite3.Connection) -> Iterator[sqlite3.Connection]:
    """Atomic write unit: everything inside commits together or not at all."""
    conn.execute("BEGIN IMMEDIATE")
    try:
        yield conn
    except BaseException:
        conn.execute("ROLLBACK")
        raise
    else:
        conn.execute("COMMIT")
