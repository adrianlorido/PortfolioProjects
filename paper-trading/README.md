# Options Paper Trading — SAMPLE DATA, PAPER ONLY

A local, single-user **sample-only, paper-only** options trading simulator:

- It replays a versioned **synthetic** quote file on a simulated clock and
  validates every quote.
- In a trading run, each accepted quote goes through one demonstration
  strategy, a risk policy, a limit-order paper broker, and exact integer-cent
  accounting, all against a virtual **$100,000** account.
- Everything is shown in a command line and a local dashboard.
- There is **no live market data, no broker connection, no real orders, and
  no AI/learning.**

The worked example ends at **$100,078.70** cash and equity with **$78.70**
realized profit, to the cent.

The strategy `sample_spy_long_call` v1.0.0 uses **demonstration rules only. It
is not a tested or profitable trading strategy.**

**Documents:**
- [`SPEC.md`](SPEC.md): approved specification, clarifications, and
  implementation resolutions (§11–13).
- [`docs/HANDOFF.md`](docs/HANDOFF.md): current state, how to resume work,
  **database backup/restore**, limitations, troubleshooting.
- [`docs/FUTURE_ASSIGNMENTS.md`](docs/FUTURE_ASSIGNMENTS.md): scoped next work
  packages (market data, evaluation, dashboard) and deferred items.
- [`STEP6_VALIDATION.md`](STEP6_VALIDATION.md): verification matrix and
  evidence.

**Milestones:**
- **Step 3 — foundation:** schema, backend, dashboard, $100,000 account.
- **Step 4 — sample-data mode:** synthetic fixture, validation, deterministic
  restartable replay.
- **Step 5 — trading workflow:** quote → proposal → risk → order → fill →
  position → closing trade → P&L.
- **Step 6 — verification:** stress and end-to-end tests, fixes F1–F3, entry
  rules 5–6 resolved.
- **Step 7 — handoff:** documentation only (this version).

## Requirements

- Python **3.11 or newer** (includes SQLite 3.37+, which is needed for STRICT tables)
- No network access, API keys, or other services. The database is a single local SQLite file.

## Setup

Run all commands from this `paper-trading/` folder.

### macOS / Linux

```bash
cd paper-trading
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt
cp .env.example .env                  # optional; defaults work without it
```

### Windows PowerShell

```powershell
cd paper-trading
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements-dev.txt
Copy-Item .env.example .env              # optional; defaults work without it
```

If PowerShell refuses to run `Activate.ps1`, allow local scripts for this
window only and activate again:
`Set-ExecutionPolicy -Scope Process -ExecutionPolicy RemoteSigned`. You can
also skip activation and call `.\.venv\Scripts\python.exe` directly.

All `python -m paper_trading ...` commands below are identical on macOS,
Linux, and Windows PowerShell once the virtualenv is active.

### Upgrading an existing database

Databases created by Step 3 or Step 4 must be migrated once. Migrations only
add tables, columns, and guards; existing runs and replay results are kept,
and those runs remain **replay-only**:

```bash
python -m paper_trading migrate       # e.g. "Applied migrations: [3]"
python -m paper_trading status        # same run, same results, PASS
```

(`init-sample` also applies pending migrations.)

## Run the trading demonstration (worked example)

Use a **fresh trading run**. The default `sample-run-001` is a replay-only
run and cannot trade.

```bash
python -m paper_trading --run-key trading-demo-001 init-sample --trading   # create the trading run
python -m paper_trading --run-key trading-demo-001 load-fixture            # pin the synthetic fixture
python -m paper_trading --run-key trading-demo-001 start                   # READY -> RUNNING
python -m paper_trading --run-key trading-demo-001 replay-to-end           # or: step (repeat)
python -m paper_trading --run-key trading-demo-001 status                  # account summary
python -m paper_trading --run-key trading-demo-001 trades                  # full audit trail
```

Expected result (SPEC.md §7). `status` shows `[COMPLETED]`, cash and equity
$100,078.70, realized $78.70, reserved $0.00, fees $1.30,
`reconciliation: PASS`. `trades` shows:

```
proposals -> risk -> orders:
  2026-09-29T14:00:00Z BUY_TO_OPEN   ENTRY_SIGNAL   limit $4.00  risk APPROVED (rev 1)  order FILLED
  2026-09-29T14:10:00Z SELL_TO_CLOSE PROFIT_TARGET  limit $4.80  risk APPROVED (rev 3)  order FILLED
fills:
  2026-09-29T14:00:01Z BUY_TO_OPEN   1 @ $4.00 gross $400.00 fee $0.65 cash −$400.65 -> $99,599.35 (quote seq 2)
  2026-09-29T14:10:01Z SELL_TO_CLOSE 1 @ $4.80 gross $480.00 fee $0.65 cash $479.35 -> $100,078.70 (quote seq 4)
closed trades:
  2026-09-29T14:00:01Z -> 2026-09-29T14:10:01Z PROFIT_TARGET: entry cost $400.65 exit net $479.35 fees $1.30 realized $78.70
```

Step by step, event by event:

| Event | What happens | Cash | Available | Equity | Revision |
|---|---|---|---|---|---|
| q1 14:00:00 | Entry signal (SPY $600 vs $597 reference). Buy 1 @ limit $4.00 approved; $400.65 reserved. | $100,000.00 | $99,599.35 | $100,000.00 | 2 |
| q2 14:00:01 | Buy fills at the $4.00 ask. Position marked at the $3.90 bid. | $99,599.35 | $99,599.35 | $99,989.35 (−$10.65 unrealized) | 3 |
| q3 14:10:00 | Bid $4.80 ≥ 120% of $4.00: profit-target intent. Sell 1 @ limit $4.80 accepted; 1 contract reserved. | $99,599.35 | $99,599.35 | $100,079.35 | 4 |
| q4 14:10:01 | Sell fills at the $4.80 bid. Trade closed. | $100,078.70 | $100,078.70 | $100,078.70 | 5 |
| close 20:00 | Flat, so the run is COMPLETED. | | | | |

**Dashboard.** Run `python -m paper_trading serve` and open
**http://127.0.0.1:8000/?run=trading-demo-001**. The run switcher at the top
links all runs. There you can:
- **Start trading run**, **Step one event**, **Pause/Resume**, **Replay to end**;
- **Request close (manual exit)**;
- **Cancel** an open order in the Orders table.

The page shows proposals, risk decisions, orders, reservations, fills,
positions, fees, and closed trades.

**Restart.** Stop the server (Ctrl+C) or close the terminal at any point.
Nothing is lost:
- The next command or `serve` reconciles the books and continues at the next
  event.
- A retried command with the same `--key` returns its original result.
- If the books don't reconcile, the run is paused with the reason shown.

**Different settings, same demo.** Environment variables work too:

```bash
# macOS / Linux
export PAPER_SAMPLE_RUN_KEY=trading-demo-002
python -m paper_trading init-sample --trading
```

```powershell
# Windows PowerShell
$env:PAPER_SAMPLE_RUN_KEY = "trading-demo-002"
python -m paper_trading init-sample --trading
```

## Replay-only mode (Step 4, unchanged)

```bash
python -m paper_trading init-sample          # replay-only run sample-run-001
python -m paper_trading load-fixture
python -m paper_trading step                 # or replay-to-end, pause, resume, replay-status
```

Replay-only runs validate and record quotes, and nothing else. They create no
proposals, orders, fills, or positions. They stay `READY`, and their account
stays at $100,000.00. Exhaustion is recorded as `REPLAY_EXHAUSTED`, which is
not a completed trade.

## Commands

All are `python -m paper_trading [--run-key KEY] <command>`. `--run-key`
selects the run (default `PAPER_SAMPLE_RUN_KEY`, i.e. `sample-run-001`).

| Command | What it does |
|---|---|
| `init-sample [--trading]` | Applies migrations and creates the run, account, SPY watchlist, and $100,000 funding. `--trading` makes it trading-enabled. Idempotent per run key. |
| `migrate` | Applies pending schema migrations only. |
| `load-fixture [--fixture-id ID \| --path FILE]` | Validates, stores, and pins a fixture to the run. Idempotent. |
| `start [--key K]` | Trading runs: `READY → RUNNING` (fixture loaded, books reconciled). |
| `step [--key K]` / `replay-to-end [--key K]` | Process the next event / all remaining events. |
| `pause [--key K]` / `resume [--key K]` | Pause or resume. Trading runs pause the run itself; resume requires reconciled books. |
| `request-close [--key K]` | Trading runs: manual exit of the open position. |
| `cancel ORDER_ID [--key K]` | Trading runs: cancel an OPEN order and release its reservation. |
| `status` | Run, account (cash, reserved, available, equity, realized/unrealized, fees), replay, reconciliation. |
| `trades` | Proposals → risk decisions → orders, fills, positions, closed trades, ledger. |
| `replay-status` | Replay progress, latest quote and freshness, every event and outcome. |
| `serve` | Dashboard and API on http://127.0.0.1:8000/. Never creates or migrates a database. |
| `fixture-checksum FILE` | Prints the checksum a fixture should declare. |

**Idempotency.** Commands with `--key` return their stored result when
repeated with the same key. The same key with a different command or payload
is refused. Without `--key`, each invocation is a new command.

## Tests

```bash
python -m pytest            # macOS / Linux / PowerShell alike
```

The suite has 324 tests and runs in about 20 seconds. It uses temporary
databases and never touches `data/`.

| Area | File |
|---|---|
| Strategy thresholds and boundaries (0.5% entry, 5% spread, 30–45 days in New York dates, contract selection (earliest eligible expiration, then lowest strike ≥ underlying within it, then ID), freshness, cooldown, profit/loss/time exits, retry codes); risk_v1 reasons and inclusive limits | `tests/test_strategy.py` |
| Worked example to the cent at every event; event order; buy/sell limits; no same-quote fills; invalid quotes; displayed size; reservations; marks don't bump revision; stale-revision and cash rechecks at acceptance; duplicate submit/fill; conflicting keys; cancel entry/exit; TTL boundaries and time jumps; exit retries across restart; cooldown; no re-entry; loss, time, and manual exits; session end INCOMPLETE; rollback mid-event; restart without double execution; reconciliation-failure pause; determinism; lifecycle guards | `tests/test_trading.py` |
| Trading over HTTP, dashboard content, cancel/manual close, startup reconciliation pause | `tests/test_trading_api.py` |
| Step 5 review: reconciliation blocks start, resume, step, replay-to-end, manual close, cancel, and order acceptance; reads stay available; untrusted display labeling and isolation; marks and STALE labels don't change the revision | `tests/test_step5_review.py` |
| Step 6 stress and end-to-end verification (price gaps, expiries and releases, freshness boundaries, concurrent commands on separate connections, restart in each open state, failures before and after commit, session end with an open closing order, multi-contract selection, determinism), with an independent books check after every event. See [`STEP6_VALIDATION.md`](STEP6_VALIDATION.md). | `tests/test_step6_stress.py` |
| The CLI demo across real process and server restarts; Step 3 → current database upgrade | `tests/test_restart.py` |
| Step 3 and Step 4 behavior (models, init, schema, API, fixtures, intake, replay, replay API) | `tests/test_models.py`, `test_init.py`, `test_schema.py`, `test_api.py`, `test_fixtures.py`, `test_intake.py`, `test_replay.py`, `test_replay_api.py` |

Every trading scenario reconciles the books after every event.

## How the trading workflow works

Each fixture event is processed in one database transaction, in this order:

1. Expire open orders whose 60 s TTL ended at or before the event time. This
   happens before the quote, even across fixture time jumps, so a quote can
   never revive or fill an expired order.
2. Validate and record the quote. Rejected inputs stop here: no fills, no
   strategy.
3. For an accepted quote, evaluate already-open orders against it. Apply fills
   and accounting.
4. Mark open positions at the quote's bid.
5. Run the strategy on the updated state. Send any proposal through risk and
   order acceptance.
6. At `SESSION_CLOSE`, expire remaining orders. Label stale marks.
7. Reconcile. Commit the event, clock, cursor, and checkpoint together (or
   roll everything back and pause).

**Execution** (`next_quote_touch_v1`):
- A buy fills at the ask only when ask ≤ limit; a sell fills at the bid only
  when bid ≥ limit.
- The quote must be a later accepted quote than the one that generated the
  order, fresh on the simulated clock, and not observed before submission.
- The whole order must fit the displayed size not already used by other fills.
- No midpoint fills, price improvement, partial fills, or slippage.
- The database enforces these rules again on every fill insert.

**Accounting.** All amounts are integer cents.
- Entry debit = price × 100 × qty + $0.65 × qty.
- Exit credit = price × 100 × qty − $0.65 × qty.
- Cost basis = entry premium + entry fee.
- Realized P&L = exit credit − cost basis.
- Buy orders reserve limit × 100 × qty + fee; sell orders reserve contracts.
  Fills, cancellations, and expirations release reservations.
- Cash is always the sum of the immutable ledger.

**Valuation.** Market value = latest valid bid × 100 × qty. Unrealized P&L =
market value − cost basis, and excludes the prospective exit fee. A mark more
than 2 simulated seconds old is kept and labeled `STALE`, never replaced with
zero.

**When the books don't reconcile**, every trading command on that run is
refused: start, resume, step, replay-to-end, request-close, cancel, and order
acceptance. A running run is paused with the reason. Reads keep working: the
dashboard shows an **UNTRUSTED** banner and labels, disables its command
buttons, and `/api/account` returns `"trusted": false`. Records that fail
validation are shown as stored, flagged untrusted, and never used by the
strategy, risk, broker, or accounting (SPEC.md §13 items 16–17).

**Account revision.** It increments once per committed acceptance, fill,
cancellation, or expiration. Valuation-only changes (new bid marks,
CURRENT→STALE labels) never change it. See `accounting/revision.py` for why
that is valid for `risk_v1`. Risk approvals record the revision; acceptance
rejects with `STALE_ACCOUNT_REVISION` if it changed and rechecks available
cash or unreserved contracts atomically.

**Strategy rules** are in `paper_trading/strategy/sample_spy_long_call.py`,
and **risk rules** in `paper_trading/risk/policy.py`. Interpretations are
recorded in SPEC.md §13.

**Run lifecycle.**
- Trading runs: `READY` → `RUNNING` (start) ↔ `PAUSED` (pause/resume, or an
  automatic pause on reconciliation failure) → `COMPLETED` (flat at session
  end) or `INCOMPLETE` (open exposure remains). An incomplete run's exposure
  stays visible and no closing fill is invented.
- Replay-only runs stay `READY`.

## Replay details (Step 4)

- **Clock.** The simulated clock moves only to each fixture event's scheduled
  `at`, never to a quote's observation time. It never moves backward.
- **Numbering.** `replay_position` (fixture index and cursor),
  `event_sequence` (per-run audit order), and `source_sequence` (provider data,
  validated only) are separate.
- **Quote validation reasons:**
  - shape: `UNKNOWN_FIELD`, `MISSING_FIELD`, `MISSING_SIZE`, `INVALID_TYPE`,
    `INVALID_TIMESTAMP`, `NEGATIVE_VALUE`, `NONPOSITIVE_PRICE`;
  - semantics: `SOURCE_MISMATCH`, `NOT_SAMPLE_DATA`, `UNKNOWN_CONTRACT`,
    `CROSSED_QUOTE`, `FUTURE_OBSERVATION`, `STALE_QUOTE`,
    `FUTURE_UNDERLYING_OBSERVATION`, `STALE_UNDERLYING`, `OUTSIDE_SESSION`,
    `REFERENCE_PRICE_MISMATCH`, `DUPLICATE_SEQUENCE`,
    `OUT_OF_ORDER_SEQUENCE`.
- **Source-sequence rule** (accepted quotes only). With H the highest accepted
  sequence: an already-accepted value is a duplicate; a value below H is out
  of order; a value above H is fine and gaps are allowed. Rejected inputs
  never advance H.
- **Fixtures.** `fixtures/sample_spy_worked_trade_v1.json` is bundled.
  `tests/fixtures/test_invalid_inputs_v1.json` is test only. Checksum =
  `sha256:` + SHA-256 of canonical JSON without the `checksum` key. After
  editing a fixture, bump its version and use `fixture-checksum`.

## API

Every endpoint accepts `?run=<run key>` (default `PAPER_SAMPLE_RUN_KEY`).

| Endpoint | Returns |
|---|---|
| `GET /health` | Status, mode, schema version |
| `GET /api/runs` | All runs with kind and status |
| `GET /api/run`, `/api/account`, `/api/watchlist` | Run record, account snapshot + reconciliation, watchlist |
| `GET /api/proposals`, `/api/risk-decisions`, `/api/orders`, `/api/fills`, `/api/positions`, `/api/closed-trades`, `/api/exit-intents`, `/api/ledger` | Trading records |
| `GET /api/replay`, `/api/replay/events`, `/api/quotes`, `/api/rejected-inputs`, `/api/market` | Replay state and market data |
| `POST /api/replay/load` | `{"fixture_id": ...}` (bundled fixtures only) |
| `POST /api/replay/step`, `/pause`, `/resume`, `/run-to-end` | `{"idempotency_key": ...}` |
| `POST /api/trading/start`, `/request-close` | `{"idempotency_key": ...}` |
| `POST /api/trading/cancel` | `{"idempotency_key": ..., "order_id": ...}` |
| `GET /` | Dashboard (`/?run=trading-demo-001`) |

Errors return JSON `{"error": CODE, "detail": ...}`:
- **409:** `REPLAY_NOT_LOADED`, `REPLAY_PAUSED`, `REPLAY_EXHAUSTED`,
  `FIXTURE_CONFLICT`, `RUN_STATE`, `NOT_A_TRADING_RUN`,
  `RECONCILIATION_FAILED`, `NO_OPEN_POSITION`, `ORDER_NOT_OPEN`,
  `IdempotencyConflictError`.
- **404:** `ORDER_NOT_FOUND`.
- **422:** invalid body or fixture.

Command bodies must be JSON. The server listens on `127.0.0.1` only.

## Configuration

Settings live in `paper_trading/config.py`. They are read from `PAPER_*`
environment variables or from `.env`; see [`.env.example`](.env.example). No
secrets are used.

| Variable | Default | Notes |
|---|---|---|
| `PAPER_DB_PATH` | `data/paper_trading.sqlite3` | Relative to `paper-trading/` |
| `PAPER_HOST` / `PAPER_PORT` | `127.0.0.1` / `8000` | Keep localhost-only |
| `PAPER_SAMPLE_RUN_KEY` | `sample-run-001` | Default run for commands and the dashboard |
| `PAPER_STARTING_CASH_CENTS` | `10000000` | Pinned into each new run |
| `PAPER_WATCHLIST` | `SPY` | Only SPY in the MVP |
| `PAPER_FEE_PER_CONTRACT_CENTS` | `65` | Pinned; names the fee schedule (`flat_65c_v1`) |
| `PAPER_ENTRY_RISK_LIMIT_BPS` | `100` | 1% of starting cash = $1,000 entry-risk ceiling |
| `PAPER_SESSION_START` / `_END` | `2026-09-29T13:30:00Z` / `20:00:00Z` | UTC; must match the fixture |
| `PAPER_SESSION_TIMEZONE` | `America/New_York` | Used to derive local dates |

The mode is always `SAMPLE_PAPER`. Run parameters are pinned at creation.
Reusing a run key with different parameters is refused; use a new key.

## Architecture

```
paper-trading/
├── SPEC.md                 specification + clarifications + implementation resolutions (§11–13)
├── fixtures/               bundled synthetic fixtures (sample data only)
├── paper_trading/
│   ├── config.py           centralized settings
│   ├── contracts/          shared Pydantic records (SPEC.md A–J, Run, Account), types, versions
│   ├── storage/            SQLite connection, explicit transactions, migration runner
│   │   └── migrations/     0001_initial, 0002_sample_replay, 0003_trading_workflow (forward-only)
│   ├── market_data/        fixtures.py (format/checksum/scope), intake.py (quote validation)
│   ├── strategy/           sample_spy_long_call.py — demonstration rules (pure functions)
│   ├── risk/               policy.py — risk_v1 (pure function)
│   ├── broker/             paper.py — acceptance, eligibility, cancel, TTL/session expiry
│   ├── accounting/         ledger.py (cash, snapshot, reconciliation), fills.py (fills, marks), revision.py
│   ├── app/
│   │   ├── coordinator.py  init_sample
│   │   ├── replay.py       replay engine + serialized, idempotent commands
│   │   ├── trading.py      per-event trading workflow, lifecycle, reconciliation pause
│   │   ├── events.py       per-run audit events
│   │   ├── queries.py      read models
│   │   └── api.py          FastAPI app
│   ├── web/                Jinja templates, CSS, small command/refresh script
│   └── __main__.py         CLI
└── tests/
```

### Schema additions in migration 0003

| Change | Purpose |
|---|---|
| `runs.trading_enabled`, `runs.status_reason` | Trading vs replay-only runs (existing runs → replay-only); why a run is paused, completed, or incomplete |
| `exit_intents` | Persistent exit intent per position, resolved by the closing fill |
| Triggers | Run status transitions; replay-only runs stay `READY`; trading flag fixed; proposals and risk decisions immutable; order terms and position entry facts immutable; closed positions final; fill execution rules (later quote, not before submission, same contract/run, full quantity, displayed size, price at touch within limit); exit-intent rules |

## Limitations

- One demonstration strategy, one contract per order, one position or pending
  entry, SPY calls only.
- No partial fills, exercise, assignment, option-expiration handling,
  overnight positions, or settlement rules.
- Out of scope: live data, brokers, and AI/learning loops.
- The worked-example fixture covers one session day. Other scenarios are built
  in tests (`tests/trading_helpers.py`).
- Single local user and single writer (SQLite). Commands are serialized by
  SQLite's write lock. Not intended to be exposed beyond `127.0.0.1`.
- Interpretations of ambiguous spec points (entry rule 11 in risk, revision
  granularity, orders only for approved decisions, closed-trade exit reason)
  are listed in SPEC.md §13 for review.
