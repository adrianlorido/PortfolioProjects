# Options Paper Trading — SAMPLE DATA, PAPER ONLY

A local, sample-only options paper-trading application. It uses synthetic data
and a virtual $100,000 account. There is **no live market data, no broker
connection, and no way to place real orders.**

The specification is in [`SPEC.md`](SPEC.md). This README covers **Step 3**:
repository setup, backend, database, and a read-only dashboard showing the
initialized account.

## Requirements

- Python **3.11 or newer** (includes SQLite 3.37+, which is needed for STRICT tables)
- No other system services. The database is a single local SQLite file.

## Setup and run

Run all commands from this `paper-trading/` folder.

### macOS / Linux

```bash
cd paper-trading
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt

cp .env.example .env                 # optional; defaults work without it
python -m paper_trading init-sample  # create DB + sample run (safe to repeat)
python -m paper_trading serve        # http://127.0.0.1:8000/
```

### Windows PowerShell

```powershell
cd paper-trading
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements-dev.txt

Copy-Item .env.example .env             # optional; defaults work without it
python -m paper_trading init-sample     # create DB + sample run (safe to repeat)
python -m paper_trading serve           # http://127.0.0.1:8000/
```

If PowerShell refuses to run `Activate.ps1`, allow local scripts for the
current window only, then activate again:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy RemoteSigned
.\.venv\Scripts\Activate.ps1
```

You can skip activation by calling the virtualenv's Python directly:
`.\.venv\Scripts\python.exe -m paper_trading serve`.

Open **http://127.0.0.1:8000/** in a browser. Press **Ctrl+C** to stop the
server. Starting it again shows the same run and balances, because the data
lives in `data/paper_trading.sqlite3`.

### Commands

| Command | What it does |
|---|---|
| `python -m paper_trading init-sample` | Applies migrations, then creates the sample run, account, SPY watchlist, and $100,000 initial-funding ledger entry. Running it again reuses the existing run and changes nothing. |
| `python -m paper_trading migrate` | Applies pending schema migrations only. |
| `python -m paper_trading status` | Prints run, cash, and reconciliation (PASS/FAIL). |
| `python -m paper_trading serve` | Starts the dashboard and API. It refuses to start if the database has not been initialized; it never creates one. |

### Tests

```bash
python -m pytest            # macOS / Linux / PowerShell alike
```

The suite (97 tests, about 4 seconds) covers:

| Area | File |
|---|---|
| Every SPEC.md JSON example validates; unknown fields, bad versions, float/string cents, int64 overflow, non-`Z` timestamps, and broken money identities are rejected | `tests/test_models.py` |
| Init twice creates nothing new; $100,000 derived from the ledger; reconciliation passes; conflicting re-init changes nothing; crash before commit leaves nothing behind; timezone-derived session date; deterministic event order | `tests/test_init.py` |
| Foreign keys, uniqueness, CHECK constraints, immutable ledger/fills/trades, order-lifecycle triggers, pinned run parameters, migration checksums | `tests/test_schema.py` |
| Health, account, run, watchlist, empty collections, no write routes, dashboard HTML, missing-DB behavior | `tests/test_api.py` |
| Real process restart: `init-sample`, then `serve` twice on the same file; data identical | `tests/test_restart.py` |

Tests use temporary databases and never touch `data/`.

## API (read-only)

| Endpoint | Returns |
|---|---|
| `GET /health` | Status, mode, schema version, whether the sample run exists |
| `GET /api/run` | The Run record, plus the session date in America/New_York |
| `GET /api/account` | Account snapshot (SPEC.md record H) and reconciliation result |
| `GET /api/watchlist` | `{"symbols": ["SPY"]}` |
| `GET /api/positions` | Position records (empty until trading exists) |
| `GET /api/orders` | Order records (empty) |
| `GET /api/closed-trades` | Closed-trade records (empty) |
| `GET /` | Dashboard |

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
| `PAPER_SAMPLE_RUN_KEY` | `sample-run-001` | Idempotency key for `init-sample` |
| `PAPER_STARTING_CASH_CENTS` | `10000000` | Pinned into the run |
| `PAPER_WATCHLIST` | `SPY` | Only SPY is allowed in the MVP |
| `PAPER_FEE_PER_CONTRACT_CENTS` | `65` | Pinned; sets the fee-schedule version name |
| `PAPER_ENTRY_RISK_LIMIT_BPS` | `100` | 1% of starting cash ($1,000) |
| `PAPER_SESSION_START` / `_END` | `2026-09-29T13:30:00Z` / `20:00:00Z` | UTC instants |
| `PAPER_SESSION_TIMEZONE` | `America/New_York` | Used to derive local dates |

The mode is always `SAMPLE_PAPER` and cannot be configured.

**Changing a run's parameters.** Values are pinned when a run is created. If
you change starting cash (or any other pinned value) and rerun
`init-sample` with the same key, the command refuses and leaves the data
untouched. To start fresh, set a new `PAPER_SAMPLE_RUN_KEY`. The dashboard
shows the run for the configured key, and earlier runs remain in the database.

## Architecture

```
paper-trading/
├── SPEC.md                 approved specification + clarifications + resolutions
├── paper_trading/
│   ├── config.py           centralized settings
│   ├── contracts/          shared Pydantic records (SPEC.md A–J, Run, Account), types, versions
│   ├── storage/            SQLite connection, explicit transactions, migration runner
│   │   └── migrations/     0001_initial.sql (versioned, checksummed, forward-only)
│   ├── accounting/         ledger-derived cash, account snapshot, reconciliation   [read side done]
│   ├── market_data/        interface only                                          [Step 4]
│   ├── strategy/           interface only                                          [Step 5]
│   ├── risk/               interface only                                          [Step 5]
│   ├── broker/             interface only                                          [Step 5]
│   ├── app/
│   │   ├── coordinator.py  audited commands (init_sample only)
│   │   ├── queries.py      read models for API/dashboard
│   │   └── api.py          FastAPI app
│   ├── web/                Jinja templates, CSS, small refresh script
│   └── __main__.py         CLI
└── tests/
```

Design points:

- **Cash truth is the ledger.** No table stores a cash balance. Cash is the
  sum of `cash_ledger_entries.net_cash_delta_cents`. Snapshots are computed on
  read. Reconciliation checks the ledger chain, the single funding entry,
  fill↔ledger agreement, reservations, and
  `equity = starting + realized + unrealized`.
- **Two validation layers.** Pydantic contracts reject bad shapes and broken
  identities at the boundary. The database enforces the same rules with CHECK
  constraints, UNIQUE constraints, foreign keys, and triggers: immutable
  ledger/fills/closed trades, legal order transitions only, final terminal
  orders, pinned run parameters, contiguous ledger sequences with chained
  balances, and one funding entry per run.
- **Explicit transactions.** Connections run in autocommit mode. Every write
  goes through `BEGIN IMMEDIATE … COMMIT/ROLLBACK`. Initialization is one
  atomic transaction, and a crash before commit leaves nothing behind (tested).
- **Never reset data.** Read paths open the database in read-write mode
  without creating it. The server does not create or migrate a database on
  startup. Migrations are forward-only and checksummed: an edited
  already-applied migration, or a database from newer code, is refused.
- **Determinism.** Per-run `run_events.event_sequence` numbers are
  deterministic. Record IDs are random UUID-based and globally unique. The
  funding entry uses the simulated session start, not wall-clock time.
- **Dashboard.** Server-rendered from backend read models. The only
  JavaScript is a Refresh button that re-reads `/api/account` and formats
  cents; it computes nothing.

## Limitations and unimplemented features

Not implemented in Step 3, by design:

- **Step 4 — sample-data mode:** versioned synthetic quote fixture, fixture
  loading (pins fixture version, checksum, and session reference price on the
  run), quote validation, replay clock, and event sequencing. Until then the
  run shows "Fixture: Not loaded" and the database prevents it from leaving
  `READY`.
- **Step 5 — trading workflow:** strategy evaluation, risk decisions, order
  acceptance with cash/contract reservations (atomic revalidation against
  `account_revision`), fills, cancel/expire, position and fill accounting
  (`apply_fill`), closed trades, restart recovery, and the `start`, `step`,
  `pause`, and `request_close` commands. The dashboard shows these as disabled
  "Not implemented" buttons, and the API has no write endpoints.
- **Out of MVP scope:** live market data, live brokers, AI or learning loops.

**Account revision rule** (SPEC.md clarification 6): the revision increases
with every committed change to cash, positions, or cash/contract reservations,
in the same transaction as the change.

Known limitations:

- Single local user and single writer (SQLite). Not intended to be exposed
  beyond `127.0.0.1`.
- The dashboard shows the run for the configured `PAPER_SAMPLE_RUN_KEY` only.
  There is no run picker yet.
- Session defaults describe one sample day (2026-09-29). The fixture step will
  supply its own session metadata.
