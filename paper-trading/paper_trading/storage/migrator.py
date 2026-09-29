"""Versioned, forward-only schema migrations.

Migration files live in ``storage/migrations/NNNN_name.sql`` or
``NNNN_name.py``. Each is applied once inside its own transaction and recorded
with a SHA-256 checksum of its file text. Editing an already-applied migration,
or opening a database created by newer code, is refused rather than
"repaired": existing data is never reset.

Python migrations define ``upgrade(conn)`` and are used when a change needs
code, such as rebuilding a table to change a CHECK constraint or backfilling
rows. A Python migration must be self-contained (standard library only), so
its behavior cannot drift when application code changes later. If it sets
``REQUIRES_FOREIGN_KEYS_OFF = True`` (SQLite's documented table-rebuild
procedure), foreign-key enforcement is switched off around its transaction,
and ``PRAGMA foreign_key_check`` must come back empty *before* the commit, so a
rebuild can never leave dangling references behind.
"""

from __future__ import annotations

import hashlib
import importlib.util
import re
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from paper_trading.contracts.types import format_utc
from paper_trading.storage.db import DatabaseNotInitializedError

MIGRATIONS_DIR = Path(__file__).resolve().parent / "migrations"
_NAME = re.compile(r"^(\d{4})_([a-z0-9_]+)\.(sql|py)$")


class MigrationError(RuntimeError):
    pass


@dataclass(frozen=True)
class Migration:
    version: int
    name: str
    sql: str  # the file text: SQL, or Python source for a .py migration
    kind: str = "sql"
    path: Path | None = None

    @property
    def checksum(self) -> str:
        return hashlib.sha256(self.sql.encode("utf-8")).hexdigest()


def discover() -> list[Migration]:
    found = []
    for path in sorted(p for p in MIGRATIONS_DIR.iterdir() if p.suffix in (".sql", ".py")):
        if path.name == "__init__.py":
            continue
        m = _NAME.match(path.name)
        if not m:
            raise MigrationError(f"badly named migration file: {path.name}")
        # Normalize line endings so checksums match on Windows checkouts.
        text = path.read_text(encoding="utf-8").replace("\r\n", "\n")
        found.append(Migration(int(m.group(1)), m.group(2), text, m.group(3), path))
    versions = [m.version for m in found]
    if versions != list(range(1, len(found) + 1)):
        raise MigrationError(f"migration versions must be contiguous from 1; found {versions}")
    return found


def _ensure_table(conn: sqlite3.Connection) -> None:
    conn.execute(
        """CREATE TABLE IF NOT EXISTS schema_migrations (
               version    INTEGER PRIMARY KEY,
               name       TEXT NOT NULL,
               checksum   TEXT NOT NULL,
               applied_at TEXT NOT NULL
           ) STRICT"""
    )


def _applied(conn: sqlite3.Connection) -> dict[int, sqlite3.Row]:
    exists = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_migrations'"
    ).fetchone()
    if not exists:
        return {}
    return {r["version"]: r for r in conn.execute("SELECT * FROM schema_migrations ORDER BY version")}


def status(conn: sqlite3.Connection) -> tuple[int, list[Migration]]:
    """Return (current version, pending migrations); raise on any mismatch."""
    known = discover()
    applied = _applied(conn)
    by_version = {m.version: m for m in known}
    for version, row in applied.items():
        mig = by_version.get(version)
        if mig is None:
            raise MigrationError(
                f"database has migration {version} that this code does not know; refusing to continue"
            )
        if row["checksum"] != mig.checksum:
            raise MigrationError(
                f"migration {version}_{mig.name} was modified after being applied; "
                "add a new migration instead of editing an old one"
            )
    current = max(applied, default=0)
    return current, [m for m in known if m.version not in applied]


def migrate(conn: sqlite3.Connection) -> list[int]:
    """Apply pending migrations. Idempotent; returns the versions applied."""
    _ensure_table(conn)
    _, pending = status(conn)
    applied = []
    for mig in pending:
        now = format_utc(datetime.now(timezone.utc).replace(microsecond=0))
        if mig.kind == "py":
            _apply_python(conn, mig, now)
            applied.append(mig.version)
            continue
        # executescript() commits any open transaction first, so the
        # transaction boundaries live inside the script itself.
        script = (
            "BEGIN IMMEDIATE;\n"
            f"{mig.sql}\n"
            "INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES "
            f"({mig.version}, '{mig.name}', '{mig.checksum}', '{now}');\n"
            "COMMIT;"
        )
        try:
            conn.executescript(script)
        except sqlite3.Error as exc:
            if conn.in_transaction:
                conn.execute("ROLLBACK")
            raise MigrationError(f"migration {mig.version}_{mig.name} failed: {exc}") from exc
        applied.append(mig.version)
    problems = conn.execute("PRAGMA foreign_key_check").fetchall()
    if problems:
        raise MigrationError(f"foreign key violations after migration: {[tuple(p) for p in problems]}")
    return applied


def _load_module(mig: Migration):
    spec = importlib.util.spec_from_file_location(f"_paper_trading_migration_{mig.version:04d}", mig.path)
    module = importlib.util.module_from_spec(spec)
    # Execute exactly the text that was checksummed.
    exec(compile(mig.sql, str(mig.path), "exec"), module.__dict__)
    if not callable(getattr(module, "upgrade", None)):
        raise MigrationError(f"migration {mig.version}_{mig.name} defines no upgrade(conn)")
    return module


def _apply_python(conn: sqlite3.Connection, mig: Migration, now: str) -> None:
    module = _load_module(mig)
    fk_off = bool(getattr(module, "REQUIRES_FOREIGN_KEYS_OFF", False))
    if conn.in_transaction:
        raise MigrationError("migrations must start outside a transaction")
    fk_before = conn.execute("PRAGMA foreign_keys").fetchone()[0]
    legacy_before = conn.execute("PRAGMA legacy_alter_table").fetchone()[0]
    if fk_off:
        # Both pragmas are no-ops inside a transaction, so they are set first.
        # legacy_alter_table keeps RENAME from re-validating triggers on other
        # tables that name the table being rebuilt (they are valid again after it).
        conn.execute("PRAGMA foreign_keys = OFF")
        conn.execute("PRAGMA legacy_alter_table = ON")
    try:
        conn.execute("BEGIN IMMEDIATE")
        try:
            module.upgrade(conn)
            problems = conn.execute("PRAGMA foreign_key_check").fetchall()
            if problems:
                raise MigrationError(f"foreign key violations: {[tuple(p) for p in problems]}")
            conn.execute(
                "INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?,?,?,?)",
                (mig.version, mig.name, mig.checksum, now),
            )
            conn.execute("COMMIT")
        except BaseException as exc:
            if conn.in_transaction:
                conn.execute("ROLLBACK")
            if isinstance(exc, (MigrationError, sqlite3.Error)):
                raise MigrationError(f"migration {mig.version}_{mig.name} failed: {exc}") from exc
            raise
    finally:
        conn.execute(f"PRAGMA legacy_alter_table = {int(legacy_before)}")
        conn.execute(f"PRAGMA foreign_keys = {int(fk_before)}")
    if conn.execute("PRAGMA foreign_keys").fetchone()[0] != fk_before:
        raise MigrationError("could not restore foreign key enforcement after migration")


def require_current(conn: sqlite3.Connection) -> int:
    """Raise unless the schema is fully migrated. Used by read paths."""
    current, pending = status(conn)
    if current == 0:
        raise DatabaseNotInitializedError(
            "database has no schema; run: python -m paper_trading init-sample"
        )
    if pending:
        raise MigrationError(
            f"database schema is at version {current} with pending migrations "
            f"{[m.version for m in pending]}; run: python -m paper_trading migrate"
        )
    return current
