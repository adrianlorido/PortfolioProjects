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

Trading runs (Step 5):
  init-sample --trading   Create a trading-enabled run (use a new --run-key).
  start                   READY -> RUNNING (fixture loaded, books reconciled).
  request-close           Manual close of the open position (exit intent persists).
  cancel ORDER_ID         Cancel an OPEN order and release its reservation.
  trades                  Proposals, risk decisions, orders, fills, positions,
                          closed trades, and ledger for the run.

Global option --run-key KEY selects the run (default: PAPER_SAMPLE_RUN_KEY).

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
from paper_trading.app import queries, replay, trading
from paper_trading.app.coordinator import IdempotencyConflictError, init_sample
from paper_trading.broker.paper import OrderNotFoundError, OrderNotOpenError
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
        result = init_sample(conn, settings, trading=args.trading)
        rec = reconcile(conn, result.run_id)
        snap = compute_snapshot(conn, result.account_id)
    finally:
        conn.close()
    verb = "Created" if result.created else "Already initialized; reused"
    kind = "trading" if args.trading else "replay-only"
    print(f"{verb} sample run {result.run_id} ({kind}, key {settings.sample_run_key})")
    print(f"  database:        {settings.db_path}")
    print(f"  account:         {result.account_id}")
    print(f"  cash (ledger):   {format_cents(snap.cash_cents)}")
    print(f"  reconciliation:  {'PASS' if rec.ok else 'FAIL'}")
    for d in rec.discrepancies:
        print(f"    - {d}")
    return 0 if rec.ok else 1


CLI_LIST_LIMIT = 50  # default rows per list; --limit 0 prints every row


def _nonnegative(text: str) -> int:
    value = int(text)
    if value < 0:
        raise argparse.ArgumentTypeError("must be 0 or more")
    return value


def _latest(conn, table: str, run_id: str, limit: int) -> dict:
    """limit/offset for the latest ``limit`` rows (``limit`` 0 = all), plus a note if rows are hidden."""
    total = queries.count_rows(conn, table, run_id)
    if not limit or total <= limit:
        return {"limit": None, "offset": 0}
    print(f"    (showing the latest {limit} of {total}; use --limit 0 for all)")
    return {"limit": limit, "offset": total - limit}


def _print_replay(conn, run_id, limit: int = CLI_LIST_LIMIT) -> None:
    state = queries.get_replay_state(conn, run_id)
    if state is None:
        print("  replay: no fixture loaded (run: python -m paper_trading load-fixture)")
        return
    market = queries.latest_market_state(conn, run_id)
    print(f"  fixture: {state['fixture_id']} v{state['fixture_version']}  {state['fixture_checksum']}")
    print(f"  data:    {state['data_class']} from {state['source']}: {state['data_label']}")
    print(f"  replay:  {state['status']}  {state['processed_events']}/{state['total_events']} events  "
          f"simulated clock {market['simulated_clock']}")
    if state["next_event"]:
        n = state["next_event"]
        print(f"  next:    #{state['next_position']} {n['event_type']} {n.get('ref') or ''} at {n['at']}")
    for q in market["latest_quotes"]:
        print(f"  latest:  {q['contract_id']} bid {format_cents(q['bid_cents'])} ask {format_cents(q['ask_cents'])} "
              f"(seq {q['source_sequence']}, observed {q['observed_at']}, "
              f"{q['freshness']} {q['age_seconds']:g}s simulated)")
    page = _latest(conn, "rejected_inputs", run_id, limit)
    for r in queries.list_rejected_inputs(conn, run_id, **page):
        print(f"  rejected #{r['replay_position']}: seq {r['source_sequence']} -> {', '.join(r['reason_codes'])}")


def _cmd_status(settings, args) -> int:
    conn = _open_current(settings)
    try:
        version = require_current(conn)
        run = queries.get_run(conn, settings.sample_run_key)
        account = queries.get_account(conn, run.run_id)
        snap = compute_snapshot(conn, account.account_id)
        rec = reconcile(conn, run.run_id)
        kind = "trading" if run.trading_enabled else "replay-only"
        print(f"schema version {version}; run {run.run_id} key {run.init_key} [{run.status}] {kind} mode {run.mode}")
        if run.status_reason:
            print(f"  status reason: {run.status_reason}")
        print(f"  watchlist: {', '.join(run.watchlist)}")
        print(f"  starting cash {format_cents(snap.starting_cash_cents)}  cash {format_cents(snap.cash_cents)}  "
              f"available {format_cents(snap.available_cash_cents)}  equity {format_cents(snap.equity_cents)}  "
              f"revision {snap.account_revision}")
        print(f"  reserved {format_cents(snap.reserved_cash_cents)}  realized {format_cents(snap.realized_pnl_cents)}  "
              f"unrealized {format_cents(snap.unrealized_pnl_cents)} (bid marks, excl. exit fee)  "
              f"fees {format_cents(snap.fees_paid_cents)}  valuation {snap.valuation_status}")
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
        _print_replay(conn, run.run_id, args.limit)
        for e in queries.list_replay_events(conn, run.run_id, **_latest(conn, "replay_events", run.run_id,
                                                                          args.limit)):
            reasons = f" [{', '.join(e['reason_codes'])}]" if e["reason_codes"] else ""
            print(f"    #{e['replay_position']:>2} evt {e['event_sequence']:>2}  {e['scheduled_at']}  "
                  f"{e['event_type']:<13} {e['fixture_ref'] or '':<22} {e['outcome']}{reasons}")
    finally:
        conn.close()
    return 0


def _trading_command(fn, needs_order=False):
    def handler(settings, args) -> int:
        conn = _open_current(settings)
        try:
            run = queries.get_run(conn, settings.sample_run_key)
            key = args.key or f"cli-{uuid.uuid4().hex}"
            result = fn(conn, run.run_id, args.order_id, key) if needs_order else fn(conn, run.run_id, key)
            print(json.dumps(result, indent=2, sort_keys=True))
        finally:
            conn.close()
        return 0
    return handler


def _untrusted(record: dict) -> str:
    return f"[UNTRUSTED: {record['validation_error']}] " if record.get("untrusted") else ""


def _cmd_trades(settings, args) -> int:
    conn = _open_current(settings)
    try:
        run = queries.get_run(conn, settings.sample_run_key)
        print(f"run {run.run_id} key {run.init_key} [{run.status}] "
              f"{'trading' if run.trading_enabled else 'replay-only'}  clock {queries.latest_market_state(conn, run.run_id)['simulated_clock']}")
        rec = reconcile(conn, run.run_id)
        if not rec.ok:
            print("WARNING: books do not reconcile; every figure below is DIAGNOSTIC and UNTRUSTED.")
            for d in rec.discrepancies:
                print(f"  - {d}")
        print("proposals -> risk -> orders:")
        for p in queries.list_proposals(conn, run.run_id, **_latest(conn, "trade_proposals", run.run_id,
                                                                    args.limit)):
            risk = p["decision"] + (f" {p['risk_reason_codes']}" if p["risk_reason_codes"] else "")
            order = (f"{p['order_status']}" + (f" ({p['terminal_reason']})" if p["terminal_reason"] else "")
                     if p["order_id"] else "no order")
            print(f"  {p['created_at']} {p['intent']:<13} {p['reason_code']:<14} limit {format_cents(p['limit_cents'])}"
                  f"  risk {risk} (rev {p['account_revision']})  order {order}")
        print("fills:")
        for f in queries.list_fills(conn, run.run_id, **_latest(conn, "fills", run.run_id, args.limit)):
            print(f"  {f['filled_at']} {f['intent']:<13} {f['quantity']} @ {format_cents(f['price_cents'])} "
                  f"gross {format_cents(f['gross_cents'])} fee {format_cents(f['fee_cents'])} "
                  f"cash {format_cents(f['net_cash_delta_cents'])} -> {format_cents(f['balance_after_cents'])} "
                  f"(quote seq {f['quote_source_sequence']})")
        print("positions:")
        for p in queries.display_positions(conn, run.run_id):
            print(f"  {_untrusted(p)}{p['status']:<6} {p['contract_id']} qty {p['quantity']} "
                  f"reserved {p['reserved_contracts']} entry {format_cents(p['entry_price_cents'])} "
                  f"basis {format_cents(p['remaining_cost_basis_cents'])} value {format_cents(p['market_value_cents'])} "
                  f"unrealized {format_cents(p['unrealized_pnl_cents'])} [{p['valuation_status']}]")
        print("closed trades:")
        for t in queries.display_closed_trades(conn, run.run_id):
            print(f"  {_untrusted(t)}{t['opened_at']} -> {t['closed_at']} {t['exit_reason']}: "
                  f"entry cost {format_cents(t['entry_cost_cents'])} exit net {format_cents(t['exit_net_proceeds_cents'])} "
                  f"fees {format_cents(t['total_fees_cents'])} realized {format_cents(t['realized_pnl_cents'])}")
        print("ledger:")
        for e in queries.list_ledger(conn, run.run_id):
            print(f"  #{e['ledger_sequence']} {e['entry_type']:<15} premium {format_cents(e['premium_cash_delta_cents'])} "
                  f"fee {format_cents(e['fee_cash_delta_cents'])} balance {format_cents(e['balance_after_cents'])}")
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
    parser.add_argument("--run-key", help="run to act on (default: PAPER_SAMPLE_RUN_KEY)")
    sub = parser.add_subparsers(dest="command", required=True, metavar="command")
    init = sub.add_parser("init-sample", help="create the sample run (idempotent)")
    init.add_argument("--trading", action="store_true", help="create a trading-enabled run (Step 5)")
    init.set_defaults(fn=_cmd_init)
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

    for name, fn, text in (
        ("start", replay.start_trading, "start a trading run (READY -> RUNNING)"),
        ("request-close", replay.request_close, "manually close the open position"),
    ):
        p = sub.add_parser(name, help=text)
        p.add_argument("--key", help="idempotency key; reuse it to retry safely")
        p.set_defaults(fn=_trading_command(fn))
    cancel = sub.add_parser("cancel", help="cancel an OPEN order")
    cancel.add_argument("order_id")
    cancel.add_argument("--key", help="idempotency key; reuse it to retry safely")
    cancel.set_defaults(fn=_trading_command(replay.cancel_order, needs_order=True))
    trades = sub.add_parser("trades", help="show the trading audit trail")
    trades.add_argument("--limit", type=_nonnegative, default=CLI_LIST_LIMIT,
                        help=f"latest rows per list (default {CLI_LIST_LIMIT}; 0 = all)")
    trades.set_defaults(fn=_cmd_trades)

    rstatus = sub.add_parser("replay-status", help="show replay progress and events")
    rstatus.add_argument("--limit", type=_nonnegative, default=CLI_LIST_LIMIT,
                         help=f"latest events to list (default {CLI_LIST_LIMIT}; 0 = all)")
    rstatus.set_defaults(fn=_cmd_replay_status)
    checksum = sub.add_parser("fixture-checksum", help="print a fixture file's checksum")
    checksum.add_argument("path")
    checksum.set_defaults(fn=_cmd_fixture_checksum)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        settings = get_settings()
        if args.run_key:
            settings = settings.model_copy(update={"sample_run_key": args.run_key})
        return args.fn(settings, args)
    except (DatabaseNotInitializedError, MigrationError, IdempotencyConflictError,
            queries.RunNotFoundError, replay.ReplayError, FixtureValidationError, OSError,
            trading.TradingError, OrderNotFoundError, OrderNotOpenError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    except ValidationError as exc:
        print(f"configuration error (check .env / PAPER_* variables):\n{exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
