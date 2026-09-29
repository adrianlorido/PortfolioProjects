"""Command line: ``python -m paper_trading <command>``.

Commands:
  init-sample  Apply migrations and create the sample run (idempotent).
  migrate      Apply pending schema migrations only.
  status       Show the sample run, cash, and reconciliation result.
  serve        Start the dashboard/API server (database must be initialized).
"""

from __future__ import annotations

import argparse
import sys

from pydantic import ValidationError

from paper_trading.accounting import compute_snapshot, reconcile
from paper_trading.app import queries
from paper_trading.app.coordinator import IdempotencyConflictError, init_sample
from paper_trading.config import get_settings
from paper_trading.storage.db import DatabaseNotInitializedError, connect
from paper_trading.storage.migrator import MigrationError, migrate, require_current
from paper_trading.web.format import format_cents


def _cmd_migrate(settings) -> int:
    conn = connect(settings.db_path, create=True)
    try:
        applied = migrate(conn)
    finally:
        conn.close()
    print(f"Applied migrations: {applied}" if applied else "Schema already up to date.")
    return 0


def _cmd_init(settings) -> int:
    conn = connect(settings.db_path, create=True)
    try:
        result = init_sample(conn, settings)
        rec = reconcile(conn, result.run_id)
        snap = compute_snapshot(conn, result.account_id)
    finally:
        conn.close()
    verb = "Created" if result.created else "Already initialized; reused"
    print(f"{verb} sample run {result.run_id}")
    print(f"  database:        {settings.db_path}")
    print(f"  account:         {result.account_id}")
    print(f"  cash (ledger):   {format_cents(snap.cash_cents)}")
    print(f"  reconciliation:  {'PASS' if rec.ok else 'FAIL'}")
    for d in rec.discrepancies:
        print(f"    - {d}")
    return 0 if rec.ok else 1


def _cmd_status(settings) -> int:
    conn = connect(settings.db_path)
    try:
        version = require_current(conn)
        run = queries.get_run(conn, settings.sample_run_key)
        account = queries.get_account(conn, run.run_id)
        snap = compute_snapshot(conn, account.account_id)
        rec = reconcile(conn, run.run_id)
    finally:
        conn.close()
    print(f"schema version {version}; run {run.run_id} [{run.status}] mode {run.mode}")
    print(f"  watchlist: {', '.join(run.watchlist)}")
    print(f"  starting cash {format_cents(snap.starting_cash_cents)}  cash {format_cents(snap.cash_cents)}  "
          f"available {format_cents(snap.available_cash_cents)}  equity {format_cents(snap.equity_cents)}")
    print(f"  reconciliation: {'PASS' if rec.ok else 'FAIL'}")
    for d in rec.discrepancies:
        print(f"    - {d}")
    return 0 if rec.ok else 1


def _cmd_serve(settings) -> int:
    import uvicorn

    from paper_trading.app.api import create_app

    # Check before starting so a missing database gives one clear message.
    conn = connect(settings.db_path)
    try:
        require_current(conn)
    finally:
        conn.close()
    print(f"Dashboard: http://{settings.host}:{settings.port}/   (Ctrl+C to stop)")
    uvicorn.run(create_app(settings), host=settings.host, port=settings.port, log_level="info")
    return 0


COMMANDS = {
    "init-sample": _cmd_init,
    "migrate": _cmd_migrate,
    "status": _cmd_status,
    "serve": _cmd_serve,
}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m paper_trading", description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("command", choices=sorted(COMMANDS))
    args = parser.parse_args(argv)
    try:
        settings = get_settings()
        return COMMANDS[args.command](settings)
    except (DatabaseNotInitializedError, MigrationError, IdempotencyConflictError,
            queries.RunNotFoundError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    except ValidationError as exc:
        print(f"configuration error (check .env / PAPER_* variables):\n{exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
