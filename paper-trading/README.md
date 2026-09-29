# Options Paper Trading — SAMPLE DATA, PAPER ONLY

A local, sample-only options paper-trading application. It uses synthetic data
and a virtual $100,000 account. There is **no live market data, no broker
connection, and no way to place real orders.**

The specification is in [`SPEC.md`](SPEC.md). Completed milestones:

- **Step 3 — foundation:** repository, backend, database, read-only dashboard,
  initialized $100,000 sample account.
- **Step 4 — sample-data mode (this version):** a versioned synthetic fixture,
  fixture loading and pinning, quote validation, and deterministic,
  restartable quote replay on a simulated clock.

The trading workflow (strategy, risk, orders, fills, accounting) is **Step 5**
and is not implemented.

## Requirements

- Python **3.11 or newer** (includes SQLite 3.37+, which is needed for STRICT tables)
- No network access, API keys, or other services. The database is a single local SQLite file.

## Setup and run

Run all commands from this `paper-trading/` folder.

### macOS / Linux

```bash
cd paper-trading
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt

cp .env.example .env                  # optional; defaults work without it
python -m paper_trading init-sample   # create DB + sample run (safe to repeat)
python -m paper_trading load-fixture  # load the synthetic worked-example fixture (safe to repeat)
python -m paper_trading serve         # http://127.0.0.1:8000/
```

### Windows PowerShell

```powershell
cd paper-trading
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements-dev.txt

Copy-Item .env.example .env              # optional; defaults work without it
python -m paper_trading init-sample      # create DB + sample run (safe to repeat)
python -m paper_trading load-fixture     # load the synthetic worked-example fixture (safe to repeat)
python -m paper_trading serve            # http://127.0.0.1:8000/
```

If PowerShell refuses to run `Activate.ps1`, allow local scripts for the
current window only, then activate again:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy RemoteSigned
.\.venv\Scripts\Activate.ps1
```

You can skip activation by calling the virtualenv's Python directly, e.g.
`.\.venv\Scripts\python.exe -m paper_trading serve`.

Open **http://127.0.0.1:8000/** in a browser. Press **Ctrl+C** to stop the
server. Starting it again shows the same run, balances, and replay progress,
because the data lives in `data/paper_trading.sqlite3`.

### Upgrading a Step 3 database

A database created by Step 3 is at schema version 1. The app refuses to use
it until you apply the new migration, which only adds tables and guards and
keeps all existing data:

```bash
python -m paper_trading migrate       # "Applied migrations: [2]"
python -m paper_trading status        # same run ID, cash $100,000.00, PASS
```

(`init-sample` also applies pending migrations.)

## Replaying the sample data

The same commands work on macOS, Linux, and Windows PowerShell once the
virtualenv is active. Each command commits before it returns, so you can stop
and restart the server or your terminal at any point.

```bash
python -m paper_trading load-fixture        # validate, store, and pin the fixture to the run
python -m paper_trading step                # replay the next event (SESSION_OPEN, then q1 ...)
python -m paper_trading replay-status       # progress, latest accepted quote, every event and outcome
python -m paper_trading pause               # stepping is refused until resume
python -m paper_trading resume
python -m paper_trading replay-to-end       # replay all remaining events
python -m paper_trading status              # account is still $100,000.00, revision 1, PASS
```

The dashboard has the same controls: **Load sample fixture**, **Step one
event**, **Pause/Resume**, and **Replay to end**. They call the backend command
endpoints. Nothing is computed in the browser.

**Retrying safely.** Replay commands take an idempotency key. Reusing a key
returns the original result instead of running the command again:

```bash
python -m paper_trading step --key my-step-7   # replays one event
python -m paper_trading step --key my-step-7   # same result, "idempotent_replay": true, nothing new
```

Without `--key`, each invocation is a new command. The dashboard generates one
key per click and reuses it if the request has to be retried.

**Restart.** Stop the server (Ctrl+C) or close the terminal at any time. On
the next `serve`, `status`, or `step`, replay continues at the next unreplayed
event. There are no duplicate quotes or rejection records, because each event's
result, the clock, and the cursor commit together.

**End of replay.** After the last event (`SESSION_CLOSE`), replay is
`EXHAUSTED` and a `REPLAY_EXHAUSTED` event is recorded. This means only that
every fixture event was processed. **No trading workflow ran**, the run status
stays `READY`, and no demonstration trade is claimed.

**Using a different fixture.** A run's fixture is pinned once loaded. Loading
different content is refused. Create a new run instead:

```bash
# macOS / Linux
PAPER_SAMPLE_RUN_KEY=sample-run-002 python -m paper_trading init-sample
PAPER_SAMPLE_RUN_KEY=sample-run-002 python -m paper_trading load-fixture --path path/to/fixture.json
```

```powershell
# Windows PowerShell
$env:PAPER_SAMPLE_RUN_KEY = "sample-run-002"
python -m paper_trading init-sample
python -m paper_trading load-fixture --path path\to\fixture.json
```

(or set `PAPER_SAMPLE_RUN_KEY` in `.env`). The dashboard and commands follow
the configured key.

## Commands

| Command | What it does |
|---|---|
| `init-sample` | Applies migrations, then creates the sample run, account, SPY watchlist, and $100,000 initial-funding ledger entry. Repeating it changes nothing. |
| `migrate` | Applies pending schema migrations only. |
| `status` | Run, account, replay progress, and reconciliation (PASS/FAIL). |
| `serve` | Starts the dashboard and API. Refuses to start on a missing or outdated database; never creates one. |
| `load-fixture [--fixture-id ID \| --path FILE]` | Validates a fixture (checksum, structure, contract scope, session match), stores it, pins it to the run, and opens replay. Default: the bundled `sample_spy_worked_trade`. Repeating it is a no-op. |
| `step [--key K]` | Replays the next event. |
| `pause [--key K]` / `resume [--key K]` | Pause or resume replay. |
| `replay-to-end [--key K]` | Replays remaining events, one committed transaction per event. Stops early if paused. |
| `replay-status` | Fixture, progress, simulated clock, latest quote and freshness, rejections, and the event table. |
| `fixture-checksum FILE` | Prints the checksum a fixture should declare. Exit code 1 if the declared one differs. |

All commands are `python -m paper_trading <command>`.

## Tests

```bash
python -m pytest            # macOS / Linux / PowerShell alike
```

The suite has 194 tests and runs in about 10 seconds. It uses
temporary databases and never touches `data/`.

| Area | File |
|---|---|
| SPEC.md JSON examples validate; strict money/timestamp validation | `tests/test_models.py` |
| Idempotent init, ledger-derived $100,000, reconciliation, rollback on crash, timezone-derived dates | `tests/test_init.py` |
| Foreign keys, uniqueness, CHECKs, immutability and lifecycle triggers, migration checksums | `tests/test_schema.py` |
| Step 3 API and dashboard; only replay commands accept writes | `tests/test_api.py` |
| Fixture format, checksum, contract scope, idempotent load, replacement and version conflicts, session mismatch, tamper detection | `tests/test_fixtures.py` |
| Each quote-validation reason code, canonical ordering, source-sequence rules | `tests/test_intake.py` |
| q1–q4 replay, invalid inputs and reasons, rejected inputs never touch market state, retries, pause/resume, failure before commit, restart resume, determinism, no trading activity | `tests/test_replay.py` |
| Replay endpoints, error codes, dashboard before/during/after replay | `tests/test_replay_api.py` |
| Real process restarts (CLI and server), replay resumed across processes, Step 3 database upgrade | `tests/test_restart.py` |

## Fixtures

| File | Purpose |
|---|---|
| `fixtures/sample_spy_worked_trade_v1.json` | **Bundled.** SPEC.md §7 worked example: SPY Oct 30 2026 $600 call; quotes q1–q4 between SESSION_OPEN (13:30Z) and SESSION_CLOSE (20:00Z); reference $597.00. |
| `tests/fixtures/test_invalid_inputs_v1.json` | **Test only**, never loadable over HTTP. Valid quotes interleaved with stale, future, crossed, duplicate, out-of-order, missing-size, and reference-mismatch inputs. |

Format and rules (full detail in `paper_trading/market_data/fixtures.py`):

- Metadata: `fixture_schema_version` `"1.0"`, `fixture_id`, `fixture_version`,
  `checksum`, `source` (`synthetic_fixture_v1`, the only registered provider),
  `is_sample: true`, a `data_label` containing `SYNTHETIC`, `underlying`,
  `session` (`timezone` `America/New_York`, UTC `start`/`end`), and
  `session_reference_cents`.
- `contracts` must be in MVP scope: standard unadjusted SPY calls with
  multiplier 100, expiring at least 7 days after the session's New York date.
- `events` run from `SESSION_OPEN` at the session start to `SESSION_CLOSE` at
  the session end, with `QUOTE` events in between. Each event's `at` is its
  scheduled simulated arrival time; times never decrease and stay inside the
  session.
- `checksum` = `sha256:` + SHA-256 of the canonical JSON (sorted keys, no
  whitespace, UTF-8) of the document without its `checksum` key. After editing
  a fixture, bump `fixture_version` and set the value printed by
  `python -m paper_trading fixture-checksum FILE`.

The synthetic prices follow SPEC.md §7. The spec gives no underlying price for
q3/q4; the fixture uses $601.50.

## How replay works

- **Clock.** The simulated clock moves only to each event's scheduled `at`. It
  never follows a quote's observation timestamp and never uses wall-clock
  time. There are no sleeps. The database refuses to move the clock backward.
- **Three kinds of numbers:**
  - `replay_position`: the event's 1-based index in the fixture; also the
    replay cursor/checkpoint.
  - `event_sequence`: the run's audit-log number, covering setup, replay, and
    pause/resume events.
  - `source_sequence`: the provider's own number inside a quote. It is
    validated, never assigned.
- **Quote validation** (`paper_trading/market_data/intake.py`). Shape checks
  first: `UNKNOWN_FIELD`, `MISSING_FIELD`, `MISSING_SIZE`, `INVALID_TYPE`,
  `INVALID_TIMESTAMP`, `NEGATIVE_VALUE`, `NONPOSITIVE_PRICE`. If those pass,
  every applicable semantic reason is reported: `SOURCE_MISMATCH`,
  `NOT_SAMPLE_DATA`, `UNKNOWN_CONTRACT`, `CROSSED_QUOTE`,
  `FUTURE_OBSERVATION`, `STALE_QUOTE` (older than 2 simulated seconds), the
  same two for the underlying observation, `OUTSIDE_SESSION`,
  `REFERENCE_PRICE_MISMATCH` (only when the quote includes a reference),
  `DUPLICATE_SEQUENCE`, and `OUT_OF_ORDER_SEQUENCE`.
- **Source-sequence rule**, per run and source, using accepted quotes only.
  Let H be the highest accepted `source_sequence`.
  - An `s` already accepted is a duplicate.
  - An `s` below H that was never accepted is out of order.
  - Anything above H is fine; gaps are allowed.
  - Rejected inputs never advance H, so a bad input cannot block later valid
    quotes.
- **Accepted vs rejected.** Accepted quotes go to `market_quotes`. Rejected
  inputs go, byte-for-byte as received, to `rejected_inputs` with their
  reasons. The latest market state is read only from `market_quotes`, so a
  rejected input can never overwrite it.
- **Freshness.** The dashboard and `/api/market` show each latest quote's age
  on the simulated clock: `FRESH` at 2 seconds or less, else `STALE`. For
  example, at session close the q4 quote is 20,999 simulated seconds old.
- **Atomic steps.** One transaction commits:
  - the quote or rejection record, and its run event;
  - the `replay_events` row;
  - the simulated clock, the run checkpoint, and the replay cursor;
  - the command's idempotency record.

  A failure before commit leaves no trace (tested).
- **Serialized commands.** Every command takes SQLite's write lock
  (`BEGIN IMMEDIATE`), so commands apply one at a time across threads and
  processes.
- **Determinism.** The same fixture and versions give identical event
  ordering, validation outcomes, market state, and clock. Record IDs are
  globally unique and differ between runs (tested).
- **No trading side effects.** Replay creates no proposals, risk decisions,
  orders, fills, positions, ledger entries, or closed trades. It never changes
  the account revision. Cash and equity stay $100,000.00 (tested).

## API

| Endpoint | Returns |
|---|---|
| `GET /health` | Status, mode, schema version, whether the sample run exists |
| `GET /api/run` | Run record, plus the session date in America/New_York |
| `GET /api/account` | Account snapshot (SPEC.md record H) and reconciliation result |
| `GET /api/watchlist` | `{"symbols": ["SPY"]}` |
| `GET /api/positions`, `/api/orders`, `/api/closed-trades` | Trading records (empty until Step 5) |
| `GET /api/replay` | Replay state: fixture, status, progress, next event, simulated clock |
| `GET /api/replay/events` | One row per replayed event with outcome and reasons |
| `GET /api/quotes` | Accepted quotes |
| `GET /api/rejected-inputs` | Rejected raw inputs with reason codes |
| `GET /api/market` | Latest accepted quote per contract, with simulated-clock freshness |
| `POST /api/replay/load` | `{"fixture_id": "sample_spy_worked_trade"}`. Only bundled fixtures; no file paths over HTTP. |
| `POST /api/replay/step`, `/pause`, `/resume`, `/run-to-end` | `{"idempotency_key": "..."}` |
| `GET /` | Dashboard |

Command errors return JSON `{"error": CODE, "detail": ...}`:
- **409:** `REPLAY_NOT_LOADED`, `REPLAY_PAUSED`, `REPLAY_EXHAUSTED`,
  `FIXTURE_CONFLICT`, `IdempotencyConflictError`.
- **422:** an invalid fixture or request body.

Command bodies must be JSON, so a plain cross-site form post cannot trigger
them. The server listens on `127.0.0.1` only.

All money is **integer cents** (`10000000` = $100,000.00). All timestamps are
RFC 3339 UTC ending in `Z`. Interactive docs: http://127.0.0.1:8000/docs.

## Configuration

Settings live in `paper_trading/config.py`. They are read from `PAPER_*`
environment variables or from a `.env` file in this folder; see
[`.env.example`](.env.example). No secrets are used.

| Variable | Default | Notes |
|---|---|---|
| `PAPER_DB_PATH` | `data/paper_trading.sqlite3` | Relative paths are relative to `paper-trading/` |
| `PAPER_HOST` / `PAPER_PORT` | `127.0.0.1` / `8000` | Keep localhost-only |
| `PAPER_SAMPLE_RUN_KEY` | `sample-run-001` | Idempotency key for `init-sample`; selects the run |
| `PAPER_STARTING_CASH_CENTS` | `10000000` | Pinned into the run |
| `PAPER_WATCHLIST` | `SPY` | Only SPY is allowed in the MVP |
| `PAPER_FEE_PER_CONTRACT_CENTS` | `65` | Pinned; sets the fee-schedule version name |
| `PAPER_ENTRY_RISK_LIMIT_BPS` | `100` | 1% of starting cash ($1,000) |
| `PAPER_SESSION_START` / `_END` | `2026-09-29T13:30:00Z` / `20:00:00Z` | UTC instants; must match the fixture's session |
| `PAPER_SESSION_TIMEZONE` | `America/New_York` | Used to derive local dates |

The mode is always `SAMPLE_PAPER` and cannot be configured. Values are pinned
when a run is created. Re-running `init-sample` with the same key and changed
values is refused and leaves the data untouched; use a new key.

## Architecture

```
paper-trading/
├── SPEC.md                 approved specification + clarifications + resolutions
├── fixtures/               bundled synthetic fixtures (sample data only)
├── paper_trading/
│   ├── config.py           centralized settings
│   ├── contracts/          shared Pydantic records (SPEC.md A–J, Run, Account), types, versions
│   ├── storage/            SQLite connection, explicit transactions, migration runner
│   │   └── migrations/     0001_initial.sql, 0002_sample_replay.sql (checksummed, forward-only)
│   ├── accounting/         ledger-derived cash, account snapshot, reconciliation   [read side]
│   ├── market_data/        fixtures.py (format/checksum/scope), intake.py (quote validation)
│   ├── strategy/           interface only                                          [Step 5]
│   ├── risk/               interface only                                          [Step 5]
│   ├── broker/             interface only                                          [Step 5]
│   ├── app/
│   │   ├── coordinator.py  init_sample command
│   │   ├── replay.py       load_fixture, step, pause, resume, run_to_end commands
│   │   ├── queries.py      read models for API/dashboard
│   │   └── api.py          FastAPI app
│   ├── web/                Jinja templates, CSS, small command/refresh script
│   └── __main__.py         CLI
└── tests/
    └── fixtures/           intentionally invalid test fixture
```

### Schema additions (migration 0002)

| Table | Purpose |
|---|---|
| `fixtures` | Stored, immutable fixture content keyed by `(fixture_id, fixture_version)` with a unique checksum. Replay reads from here and re-verifies the checksum, so editing the file later cannot change a replay. |
| `replay_state` | One cursor per run: fixture binding, status `ACTIVE`/`PAUSED`/`EXHAUSTED`, `next_position`, `total_events`. |
| `replay_events` | Exactly one committed result per replayed position (`BOUNDARY`, `ACCEPTED` → quote, `REJECTED` → rejection). |
| `rejected_inputs` | Raw rejected input JSON plus reason codes. Separate from `market_quotes`. |

New guards:
- Stored fixtures, contracts, quotes, rejected inputs, and replay events are
  immutable.
- Replay positions are contiguous and must match the cursor. The cursor
  advances by at most one, and `EXHAUSTED` is final.
- A run's fixture fields and reference price are set once.
- The simulated clock and checkpoint never move backward.

Existing design points (Step 3) still hold:
- Cash is the sum of ledger entries.
- Two validation layers: Pydantic contracts and database constraints.
- Explicit `BEGIN IMMEDIATE` transactions.
- Databases are never reset.
- The account revision follows SPEC.md clarification 6.

## Limitations and unimplemented features

- **Step 5 — trading workflow, not implemented:**
  - strategy evaluation (including the 60-second rejection cooldown and
    pending-exit rules) and risk decisions;
  - order acceptance with cash/contract reservations, atomically revalidated
    against `account_revision`;
  - fills, cancel/expire, position and fill accounting, closed trades;
  - restart recovery of in-flight orders.

  The dashboard's trading controls are disabled "Not implemented" buttons.
  There are no trading endpoints.
- **Out of MVP scope:** live market data, live brokers, AI or learning loops.
- Quote checks that need an order (e.g. "quote predates order submission")
  arrive with orders in Step 5.
- Single local user and single writer (SQLite). Not intended to be exposed
  beyond `127.0.0.1`.
- The dashboard shows the run for the configured `PAPER_SAMPLE_RUN_KEY` only.
  There is no run picker.
- One bundled fixture (one session day). A different session needs a run
  configured with matching session settings.

## Step 5 handoff

Step 5 builds the trading workflow on top of replay:

- **Hook point:** `app/replay.py::_step_in_transaction`. After a quote is
  accepted (inside the same transaction), the coordinator calls the strategy
  with the new quote, the account snapshot, and any position. It then passes
  any proposal to risk, and on approval to broker acceptance.
- **Quote data:** each accepted quote is a validated `MarketQuote` in
  `market_quotes`, with `event_sequence` for ordering. `latest_market_state`
  gives the latest valid mark per contract. `run.session_reference_cents` is
  the pinned reference for the 0.5% entry rule.
- **Run status:** the run leaves `READY` when trading starts. The database
  already requires pinned fixture metadata for that. Replay exhaustion with an
  open position must become `INCOMPLETE`; `COMPLETED` is only for a
  flat-closed trading workflow.
- **Rules to implement:**
  - account revision per clarification 6;
  - rejection cooldown per clarification 1;
  - pending-exit rules per clarification 3;
  - orders fill only against a later quote event than the one that caused the
    proposal (`after_source_sequence`).
