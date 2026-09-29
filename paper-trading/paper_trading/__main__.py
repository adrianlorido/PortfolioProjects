"""Command line: ``python -m paper_trading <command>``.

Setup:
  init-sample       Apply migrations and create the sample run (idempotent).
  migrate           Apply pending schema migrations only.
  status            Show the sample run, cash, replay progress, and reconciliation.
  serve             Start the dashboard/API server (database must be initialized).

Sample-data replay (Step 4):
  load-fixture      Validate, store, and pin a fixture to the sample run (idempotent).
  step              Replay the next fixture event.
  pause / resume    Pause or resume replay.
  replay-to-end     Replay all remaining events (stops early if paused).
  replay-status     Show replay progress, latest accepted quote, and rejections.
  fixture-checksum  Print the checksum a fixture file should declare.

Replay commands accept --key; repeating a command with the same key returns
the original result instead of running it again. Without --key a new key is
generated, so each invocation is a new command.
"""

from __future__ import annotations

import argparse
import json
import sys
import uuid
from pathlib import Path

from pydantic import ValidationError

from paper_trading.accounting import compute_snapshot, reconcile
from paper_trading.app import queries, replay
from paper_trading.app.coordinator import IdempotencyConflictError, init_sample
from paper_trading.config import get_settings
from paper_trading.market_data.fixtures import (
    DEFAULT_FIXTURE_ID,
    FixtureValidationError,
    bundled_fixtures,
    compute_checksum,
    read_fixture_file,
)
from paper_trading.storage.db import DatabaseNotInitializedError, connect
from paper_trading.storage.migrator import MigrationError, migrate, require_current
from paper_trading.web.format import format_cents


def _open_current(settings):
    conn = connect(settings.db_path)
    require_current(conn)
    return conn


def _cmd_migrate(settings, args) -> int:
    conn = connect(settings.db_path, create=True)
    try:
        applied = migrate(conn)
    finally:
        conn.close()
    print(f"Applied migrations: {applied}" if applied else "Schema already up to date.")
    return 0


def _cmd_init(settings, args) -> int:
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


def _print_replay(conn, run_id) -> None:
    state = queries.get_replay_state(conn, run_id)
    if state is None:
        print("  replay: no fixture loaded (run: python -m paper_trading load-fixture)")
        return
    market = queries.latest_market_state(conn, run_id)
    print(f"  fixture: {state['fixture_id']} v{state['fixture_version']}  {state['fixture_checksum']}")
    print(f"  replay:  {state['status']}  {state['processed_events']}/{state['total_events']} events  "
          f"simulated clock {market['simulated_clock']}")
    if state["next_event"]:
        n = state["next_event"]
        print(f"  next:    #{state['next_position']} {n['event_type']} {n.get('ref') or ''} at {n['at']}")
    for q in market["latest_quotes"]:
        print(f"  latest:  {q['contract_id']} bid {format_cents(q['bid_cents'])} ask {format_cents(q['ask_cents'])} "
              f"(seq {q['source_sequence']}, observed {q['observed_at']}, "
              f"{q['freshness']} {q['age_seconds']:g}s simulated)")
    for r in queries.list_rejected_inputs(conn, run_id):
        print(f"  rejected #{r['replay_position']}: seq {r['source_sequence']} -> {', '.join(r['reason_codes'])}")


def _cmd_status(settings, args) -> int:
    conn = _open_current(settings)
    try:
        version = require_current(conn)
        run = queries.get_run(conn, settings.sample_run_key)
        account = queries.get_account(conn, run.run_id)
        snap = compute_snapshot(conn, account.account_id)
        rec = reconcile(conn, run.run_id)
        print(f"schema version {version}; run {run.run_id} [{run.status}] mode {run.mode}")
        print(f"  watchlist: {', '.join(run.watchlist)}")
        print(f"  starting cash {format_cents(snap.starting_cash_cents)}  cash {format_cents(snap.cash_cents)}  "
              f"available {format_cents(snap.available_cash_cents)}  equity {format_cents(snap.equity_cents)}  "
              f"revision {snap.account_revision}")
        _print_replay(conn, run.run_id)
        print(f"  reconciliation: {'PASS' if rec.ok else 'FAIL'}")
        for d in rec.discrepancies:
            print(f"    - {d}")
    finally:
        conn.close()
    return 0 if rec.ok else 1


def _cmd_serve(settings, args) -> int:
    import uvicorn

    from paper_trading.app.api import create_app

    # Check before starting so a missing or outdated database gives one clear message.
    _open_current(settings).close()
    print(f"Dashboard: http://{settings.host}:{settings.port}/   (Ctrl+C to stop)")
    uvicorn.run(create_app(settings), host=settings.host, port=settings.port, log_level="info")
    return 0


def _cmd_load_fixture(settings, args) -> int:
    if args.path:
        path = Path(args.path)
    else:
        path = bundled_fixtures().get(args.fixture_id)
        if path is None:
            print(f"error: no bundled fixture {args.fixture_id!r}; available: {sorted(bundled_fixtures())}",
                  file=sys.stderr)
            return 2
    doc, content = read_fixture_file(path)
    conn = _open_current(settings)
    try:
        run = queries.get_run(conn, settings.sample_run_key)
        result = replay.load_fixture(conn, run.run_id, doc, content)
        verb = "Loaded" if result.created else "Already loaded; unchanged"
        print(f"{verb} fixture {result.fixture_id} v{result.fixture_version} ({result.total_events} events)")
        print(f"  checksum: {result.checksum}")
        print(f"  label:    {doc.data_label}")
        _print_replay(conn, run.run_id)
    finally:
        conn.close()
    return 0


def _replay_command(fn):
    def handler(settings, args) -> int:
        conn = _open_current(settings)
        try:
            run = queries.get_run(conn, settings.sample_run_key)
            result = fn(conn, run.run_id, args.key or f"cli-{uuid.uuid4().hex}")
            print(json.dumps(result, indent=2, sort_keys=True))
            _print_replay(conn, run.run_id)
        finally:
            conn.close()
        return 0
    return handler


def _cmd_replay_status(settings, args) -> int:
    conn = _open_current(settings)
    try:
        run = queries.get_run(conn, settings.sample_run_key)
        _print_replay(conn, run.run_id)
        for e in queries.list_replay_events(conn, run.run_id):
            reasons = f" [{', '.join(e['reason_codes'])}]" if e["reason_codes"] else ""
            print(f"    #{e['replay_position']:>2} evt {e['event_sequence']:>2}  {e['scheduled_at']}  "
                  f"{e['event_type']:<13} {e['fixture_ref'] or '':<22} {e['outcome']}{reasons}")
    finally:
        conn.close()
    return 0


def _cmd_fixture_checksum(settings, args) -> int:
    data = json.loads(Path(args.path).read_text(encoding="utf-8"))
    actual = compute_checksum(data)
    print(actual)
    if data.get("checksum") != actual:
        print(f"declared checksum {data.get('checksum')!r} does not match", file=sys.stderr)
        return 1
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="python -m paper_trading", description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True, metavar="command")
    sub.add_parser("init-sample", help="create the sample run (idempotent)").set_defaults(fn=_cmd_init)
    sub.add_parser("migrate", help="apply pending migrations").set_defaults(fn=_cmd_migrate)
    sub.add_parser("status", help="show run, account, and replay").set_defaults(fn=_cmd_status)
    sub.add_parser("serve", help="start the dashboard").set_defaults(fn=_cmd_serve)

    load = sub.add_parser("load-fixture", help="load and pin a fixture (idempotent)")
    load.add_argument("--fixture-id", default=DEFAULT_FIXTURE_ID,
                      help=f"bundled fixture id (default: {DEFAULT_FIXTURE_ID})")
    load.add_argument("--path", help="load a fixture file from this path instead")
    load.set_defaults(fn=_cmd_load_fixture)

    for name, fn, text in (
        ("step", replay.step, "replay the next event"),
        ("pause", replay.pause, "pause replay"),
        ("resume", replay.resume, "resume replay"),
        ("replay-to-end", replay.run_to_end, "replay all remaining events"),
    ):
        p = sub.add_parser(name, help=text)
        p.add_argument("--key", help="idempotency key; reuse it to retry safely")
        p.set_defaults(fn=_replay_command(fn))

    sub.add_parser("replay-status", help="show replay progress and events").set_defaults(fn=_cmd_replay_status)
    checksum = sub.add_parser("fixture-checksum", help="print a fixture file's checksum")
    checksum.add_argument("path")
    checksum.set_defaults(fn=_cmd_fixture_checksum)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        settings = get_settings()
        return args.fn(settings, args)
    except (DatabaseNotInitializedError, MigrationError, IdempotencyConflictError,
            queries.RunNotFoundError, replay.ReplayError, FixtureValidationError, OSError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    except ValidationError as exc:
        print(f"configuration error (check .env / PAPER_* variables):\n{exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
