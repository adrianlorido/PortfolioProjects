# Handoff: options paper-trading sample app

Status after FA-1a (historical-data engine readiness, branch
`historical-engine-readiness`, based on `paper-trading-step7`). The Step 7
commands below are unchanged and were re-run on this branch. FA-1b (a vendor
importer) is specified in `docs/FA1B_INTEGRATION_SPEC.md` but **not**
implemented; no vendor data has been bought or downloaded.

## What the app does

A local, single-user **sample-only, paper-only** options trading simulator.

- **Data.** It replays a versioned, checksummed **synthetic** dataset on a
  simulated clock. Fixture files are stored as datasets, and replay reads one
  event at a time. Each quote is validated; rejected inputs are stored with
  reason codes and never become market data. The engine is ready for a
  separate **HISTORICAL** data class (`HISTORICAL_PAPER` runs, own banner),
  but no historical data can be stored until an importer is approved (FA-1b).
- **Account.** A virtual **$100,000** account, where cash is always the sum of
  an immutable ledger.
- **Trading runs** send each accepted quote through one demonstration
  strategy, `sample_spy_long_call` v1.0.0 (not a tested or profitable
  strategy), and then:
  1. a risk policy (`risk_v1`);
  2. a limit-order paper broker (buy at ask ≤ limit, sell at bid ≥ limit, next
     quote only, full displayed size, 60 s time-to-live);
  3. fill accounting in integer cents: fees, cost basis, bid marks,
     realized/unrealized P&L, closed trades.
- **Safety.** Every event commits atomically. Books are reconciled before and
  during every trading change; if they don't reconcile, trading is blocked and
  the run is paused.
- **Interfaces.** A command line (`python -m paper_trading ...`) and a local
  dashboard/API at `http://127.0.0.1:8000/` show everything the engine did,
  under a permanent **SAMPLE DATA — PAPER ONLY** banner.
- **Replay-only runs** (the Step 4 mode) validate and record quotes but never
  trade.

The worked example (SPEC.md §7) is reproduced to the cent: buy 1 @ $4.00 +
$0.65, sell @ $4.80 − $0.65, realized **$78.70**, final cash and equity
**$100,078.70**.

**It does not:**
- connect to any broker or live data source;
- place real orders;
- learn or optimize;
- evaluate profitability;
- handle partial fills, exercise, assignment, or option expiration.

## Branches and history

| Branch | Content |
|---|---|
| `main` | Original SQL/Excel portfolio work only (unchanged by this project) |
| `paper-trading-step3` | Foundation: schema, API, dashboard, $100,000 account |
| `paper-trading-step4` | Synthetic fixture and deterministic replay |
| `paper-trading-step5` | Trading workflow and review fixes |
| `paper-trading-step6` | Stress and E2E verification (`STEP6_VALIDATION.md`), fixes F1–F3, rules 5–6 resolved |
| `paper-trading-step7` | Handoff documentation (based on `paper-trading-step6`) |
| `historical-engine-readiness` | **FA-1a**: datasets, data classes, manifests, calendar, indexed replay, paging, migration 0004 (based on `paper-trading-step7`) |
| `fa1b-integration-spec` | FA-1b specification only: `docs/FA1B_INTEGRATION_SPEC.md` (documentation; based on `historical-engine-readiness`) |

Each step branch was created from the previous one, so the latest branch
contains everything.

## Resume work from this branch

### Get the code

```bash
git clone --branch historical-engine-readiness https://github.com/adrianlorido/PortfolioProjects.git
cd PortfolioProjects/paper-trading
```

Or, in an existing clone: `git fetch origin` then
`git checkout historical-engine-readiness`. An existing database is upgraded
with `python -m paper_trading migrate` (migration 0004; back it up first, see
below).

### Set up and verify

macOS / Linux:
```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt
python -m pytest            # expect: 426 passed
```

Windows PowerShell:
```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements-dev.txt
python -m pytest            # expect: 426 passed
```

If PowerShell blocks `Activate.ps1`, run
`Set-ExecutionPolicy -Scope Process -ExecutionPolicy RemoteSigned` and try
again.

### Start new work

Create a new branch from the latest step branch, for example
`git checkout -b paper-trading-step8`. Keep `main` unchanged unless the owner
decides to merge.

**Rules to keep:**
1. **SPEC.md is the source of truth.** Section 10 (clarifications) and
   Sections 11–13 (implementation resolutions) take precedence over earlier
   sections. Ambiguities go to the owner before behavior changes (see §13.20
   for the pattern).
2. **Migrations are forward-only.** Never edit an applied migration (the
   checksum check refuses to run); add `NNNN_name.sql`, or a self-contained
   `NNNN_name.py` when a table must be rebuilt (see 0004).
3. **Never reset a user's database.** `serve` and read paths never create or
   migrate a database.
4. **Money is integer cents; time is UTC ending in `Z`.** The session date is
   derived in America/New_York.
5. **Every trading change goes through the command layer.** Use
   `app/replay.py` (idempotency key, reconciliation guard, one transaction per
   event). Never write trading tables from the API, the dashboard, or ad-hoc
   code.
6. **New trading scenarios use fresh runs and their own fixtures or datasets**
   (`tests/trading_helpers.py::build_fixture`, `tests/dataset_helpers.py`),
   with `CheckedRun` so the independent books check runs after every event. Do
   not modify `fixtures/sample_spy_worked_trade_v1.json`.
8. **Data classes stay honest.** Synthetic data is always stored as
   `SYNTHETIC` (a generator in the manifest, no vendor fields), including when
   it exercises historical-data code. Never label test data HISTORICAL.
7. **Commit hygiene.** Never commit `.env`, `data/`, `backups/`, `.venv/`, or
   caches; `.gitignore` already excludes them.

## Operating the app

The command reference is in `README.md` ("Commands").

**Trading demo:**
```
python -m paper_trading --run-key trading-demo-001 init-sample --trading
python -m paper_trading --run-key trading-demo-001 load-fixture
python -m paper_trading --run-key trading-demo-001 start
python -m paper_trading --run-key trading-demo-001 replay-to-end
python -m paper_trading --run-key trading-demo-001 status
python -m paper_trading --run-key trading-demo-001 trades
python -m paper_trading serve        # then open http://127.0.0.1:8000/?run=trading-demo-001
```

`serve` occupies its terminal; stop it with **Ctrl+C**. Run other commands in a
second terminal with the virtualenv activated. Run keys are single-use per
fixture: to repeat the demo from scratch, use a new key (for example
`trading-demo-002`).

## Back up and restore the database

The database is the single file `data/paper_trading.sqlite3`. It may have
`-wal` and `-shm` companion files while in use. Backups go in `backups/`, which
is git-ignored.

### Back up

Safe even while the server is running; this uses SQLite's online backup API.

macOS / Linux:
```bash
mkdir -p backups
python -c "import sqlite3, datetime; s=sqlite3.connect('data/paper_trading.sqlite3'); name='backups/paper_trading-'+datetime.datetime.now().strftime('%Y%m%d-%H%M%S')+'.sqlite3'; d=sqlite3.connect(name); s.backup(d); d.close(); s.close(); print('backup written to', name)"
```

Windows PowerShell:
```powershell
New-Item -ItemType Directory -Force backups | Out-Null
python -c "import sqlite3, datetime; s=sqlite3.connect('data/paper_trading.sqlite3'); name='backups/paper_trading-'+datetime.datetime.now().strftime('%Y%m%d-%H%M%S')+'.sqlite3'; d=sqlite3.connect(name); s.backup(d); d.close(); s.close(); print('backup written to', name)"
```

Check a backup:
```
python -c "import sqlite3,sys; print(sqlite3.connect(sys.argv[1]).execute('PRAGMA integrity_check').fetchone()[0])" backups/paper_trading-YYYYMMDD-HHMMSS.sqlite3
```
It should print `ok`.

### Restore

1. **Stop the server first** (Ctrl+C).
2. Back up the current file too, in case you want it back.
3. Replace the file, removing stale `-wal` and `-shm` files first.

macOS / Linux:
```bash
rm -f data/paper_trading.sqlite3-wal data/paper_trading.sqlite3-shm
cp backups/paper_trading-YYYYMMDD-HHMMSS.sqlite3 data/paper_trading.sqlite3
python -m paper_trading --run-key trading-demo-001 status     # expect: reconciliation: PASS
```

Windows PowerShell:
```powershell
Remove-Item data\paper_trading.sqlite3-wal, data\paper_trading.sqlite3-shm -ErrorAction SilentlyContinue
Copy-Item backups\paper_trading-YYYYMMDD-HHMMSS.sqlite3 data\paper_trading.sqlite3 -Force
python -m paper_trading --run-key trading-demo-001 status
```

Restoring a backup made by older code works: run
`python -m paper_trading migrate` if `status` reports pending migrations.
Restoring a backup made by **newer** code into older code is refused by design.

To start completely fresh, stop the server, move `data/paper_trading.sqlite3`
into `backups/`, and run the demo commands again. Nothing ever deletes data
automatically.

## Limitations

**Scope (by design):**
- One demonstration strategy, SPY calls only.
- One contract per order; one position or pending entry per run.
- No partial fills, exercise, assignment, option-expiration handling,
  overnight positions, or settlement rules.
- Synthetic data only in practice. `HISTORICAL_PAPER` runs can be created in
  code, but no historical dataset can be stored until FA-1b.
- Deferred: live data, brokers, AI/learning, and profitability evaluation.

**Operational:**
- Single local user; SQLite single-writer lock (5 s busy timeout). Long
  contention surfaces as `database is locked`, with nothing committed.
- Listens on `127.0.0.1` only, with no authentication; do not expose it.
- A run's fixture and session settings are pinned: a different session or
  fixture needs a new run with matching `PAPER_SESSION_*` settings.
- The dashboard shows one run at a time (run switcher: latest 50 runs) and the
  latest 50 rows of each growing list; the API pages everything else
  (`limit`/`offset`, `X-Total-Count`). No charts yet.
- A dataset is verified in full once per process. Tampering with stored rows
  while a server keeps running (triggers dropped by hand) is detected at the
  next process start, not immediately.
- Commands without `--key` are new commands each time. Repeating `step`
  advances the next event; it never re-executes one. The dashboard reuses its
  key on network errors and 5xx responses.
- Replay-only runs have no trading books and are not reconciliation-guarded.

**Recorded interpretations** (SPEC.md §13, all reviewed by the owner):
- entry rule 11 is enforced by risk;
- account-revision granularity;
- orders exist only for approved decisions;
- closed-trade exit reason = the originating intent;
- rules 5–6 contract ordering: **resolved**, expiration first.

## Deferred, not to be started without a new approved specification

- **AI / learning.** No learning loop, parameter optimization, or model-driven
  decisions. Any future evaluation (see `FUTURE_ASSIGNMENTS.md` FA-2) is
  measurement only.
- **Real-money execution.** No broker adapter, credentials, or real-order
  endpoint. This needs its own specification, safety review, and explicit
  owner approval, and would be a separate application mode, never a change to
  `SAMPLE_PAPER`.
- **Live streaming data.** FA-1 covers recorded historical data only.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `database schema is at version N with pending migrations` | `python -m paper_trading migrate` |
| `no sample run for key ...` | Run `init-sample` (add `--trading` for a trading run) with that `--run-key` |
| `this is a replay-only run` | Use a trading run: `--run-key trading-demo-001 init-sample --trading` |
| `run is COMPLETED; only a READY run can be started` | The run already finished; use a new `--run-key` |
| `RECONCILIATION_FAILED` / dashboard shows UNTRUSTED | The books were altered outside the app. Restore a backup, or start a new run. Reads still work for diagnosis. |
| `Address already in use` on `serve` | Another server is running; stop it, or set `PAPER_PORT=8001` |
| `Broken pipe` when piping output to `head` | Harmless; the command already completed |
