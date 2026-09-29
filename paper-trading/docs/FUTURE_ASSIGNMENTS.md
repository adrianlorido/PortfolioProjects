# Future assignments

These are scoped work packages for after Step 7. **FA-1a (engine readiness) is
implemented** on branch `historical-engine-readiness`; the others are not. Each
starts on a new branch from the latest step branch, begins by reading
SPEC.md, `docs/HANDOFF.md`, and `STEP6_VALIDATION.md`, and ends with the full
suite passing plus its own acceptance tests.

**Rules for every assignment:**
- Paper only. Synthetic data runs as `SAMPLE_PAPER`; historical data may only
  run as `HISTORICAL_PAPER` (FA-1a), and only after FA-1b's owner decisions.
  No real-money execution and no AI/learning; both remain deferred (see
  `docs/HANDOFF.md`).
- Don't change approved trading or accounting rules. If a rule must change,
  write the SPEC amendment first and get owner approval.
- Leave these untouched unless the assignment explicitly says otherwise:
  `strategy/`, `risk/`, `broker/`, `accounting/`, `app/trading.py`, and
  `app/replay.py` (trading logic).
- Never edit an applied migration. New tables or columns go in a new migration
  (`.sql`, or a self-contained `.py` when a table must be rebuilt; see 0004).
- No network access in tests. No credentials in the repository.

| ID | Assignment | Depends on | Blocking owner decisions |
|---|---|---|---|
| FA-1a | Engine readiness for historical data (provider-independent) | — | **Done** (see `docs/HISTORICAL_DATA_PLAN.md`, SPEC §14) |
| FA-1b | Historical vendor importer | FA-1a | Plan decisions 1, 3, 4, 5 (see below) |
| FA-2 | Strategy evaluation (measurement only) | none (FA-1b optional, for historical datasets) | D5; plan decision 7 (outcome-independent dates, point-in-time universe) |
| FA-3 | Dashboard improvements (read-only views and UX) | none | D6 |

---

## FA-1: Historical market data (split into FA-1a and FA-1b)

The full plan, owner decisions, and measurements are in
[`HISTORICAL_DATA_PLAN.md`](HISTORICAL_DATA_PLAN.md).

### FA-1a: engine readiness (DONE, branch `historical-engine-readiness`)

- Incremental dataset storage and replay.
- Data classes and run modes, with separate banners.
- Immutable manifests and provenance validation.
- Quote provenance times.
- Versioned exchange calendar and coverage report.
- Indexed hot paths and bounded, paged reads.
- Migration 0004.

No vendor data or importer. Details: SPEC §14.

### FA-1b: vendor importer (NOT STARTED)

**Owner decisions required before coding** (plan decisions 1, 3, 4, 5):
- vendor and budget, and license terms (may data or derived datasets be kept
  or committed?);
- the exact opening-observation definition for the session reference price;
- the vendor's documented time semantics, and how snapshots are built from
  them;
- the price conversion, including fractional-cent SPY midpoints.

**File ownership.**

| Owns (creates or edits) | May touch, with lead review | Must not change |
|---|---|---|
| `paper_trading/market_data/importers/` (new package), `tests/test_importers.py`, small hand-made test files that imitate the vendor format (labeled synthetic), CLI subcommand for importing, docs | `market_data/datasets.py`: register the approved importer in `APPROVED_HISTORICAL_IMPORTERS`; a new calendar version; SPEC amendment | `market_data/intake.py` rules, `app/replay.py`, all trading/accounting modules, existing datasets and fixtures |

**Interfaces.**
- `importers.<vendor>.read(path) -> Iterable[RawRow]`: vendor parsing only;
  streaming.
- The importer builds point-in-time events and calls
  `datasets.store_dataset(..., data_class="HISTORICAL", calendar_id=...,
  events=<generator>, manifest=<complete historical manifest>)`, then
  `replay.attach_dataset` on a `HISTORICAL_PAPER` run.
- Malformed vendor rows are **emitted as raw quote inputs**, so intake rejects
  them with reason codes. Rows that cannot be represented at all are counted
  in the import report, never silently dropped.

**Acceptance criteria.**
1. The same raw files and parameters produce the same dataset checksum.
2. Session boundaries come from the calendar; the coverage report is stored
   in the manifest; missing rows never move the session.
3. Prices convert exactly (no floats, no silent rounding); tests cover
   sub-cent values.
4. `snapshot_at` never replaces `observed_at`; stale observations stay stale.
5. The contract universe is point-in-time; no future highs or lows are used.
6. A historical dataset replays in a `HISTORICAL_PAPER` run with `CheckedRun`
   and no books discrepancy.
7. The existing suite passes; synthetic results are unchanged.
8. No network calls in tests; credentials (if ever needed) come from
   environment variables documented in `.env.example` without values.

---

## FA-2: Strategy evaluation (measurement only)

**Goal.** Run `sample_spy_long_call` v1.0.0 unchanged over a set of datasets
and produce a deterministic, reconciled report of what happened. This is
**not** optimization, learning, or evidence of profitability. The report must
say so.

**Owner decision required:**
- **D5:** which metrics to show, and the wording of the non-profitability
  disclaimer.

**File ownership.**

| Owns | May touch, with lead review | Must not change |
|---|---|---|
| `paper_trading/evaluation/` (new: `runner.py`, `metrics.py`, `report.py`), CLI subcommand `evaluate`, `tests/test_evaluation.py`, docs | `app/queries.py`: new read-only helpers only | Strategy rules and parameters, risk, broker, accounting, replay, migrations (evaluation needs no schema change) |

**Interfaces.**
- `evaluation.runner.evaluate(fixture_paths, *, db_path, run_key_prefix) -> EvaluationReport`
  - Uses a **separate** database (default `data/evaluation.sqlite3`), never
    the user's main database unless explicitly passed.
  - Creates one fresh trading run per fixture through the public commands
    (`init_sample(trading=True)`, `load_fixture`, `start_trading`,
    `run_to_end`), never by writing tables.
- `EvaluationReport` is a frozen, JSON-serializable dataclass with:
  - per run: status, trades, realized P&L, fees, exit reasons, open exposure;
  - aggregate: trade count, wins/losses, P&L sum and distribution, fee total,
    exit-reason counts, `COMPLETED` vs `INCOMPLETE`.
- `evaluation.report.render_text(report)` and `render_json(report)`.

**Acceptance criteria.**
1. The same fixtures and versions produce an identical report (IDs and
   wall-clock timestamps excluded).
2. Every metric reconciles to stored records: aggregate realized P&L = sum of
   `closed_trades.realized_pnl_cents`; fees = sum of fill fees.
3. Each run's `reconcile` must pass; a failing run is reported as failed and
   excluded from aggregates, never silently.
4. `INCOMPLETE` runs show open exposure and contribute **no** realized P&L.
5. The worked example alone reports 1 trade, realized +$78.70, fees $1.30.
6. The report header states that the rules are demonstration rules and that
   results are not evidence of profitability.
7. No parameter sweeps, fitting, or learning; any such request is out of
   scope.

---

## FA-3: Dashboard improvements (read-only views and UX)

**Goal.** Make runs easier to inspect without changing what the engine does.
All values are still computed on the server.

**Owner decision required:**
- **D6:** which views to prioritize (proposed: quote/underlying timeline,
  equity-by-event chart, event-log filter, auto-refresh toggle) and whether a
  small vendored chart library is acceptable. The app must keep working
  offline.

**File ownership.**

| Owns | May touch, with lead review | Must not change |
|---|---|---|
| `paper_trading/web/` (templates, CSS, JS), new **GET** endpoints in `app/api.py`, new read-only functions in `app/queries.py`, `tests/test_dashboard_views.py` | README screenshots and usage | Any write endpoint or command, trading/accounting/storage modules, migrations |

**Interfaces (proposed).**
- `GET /api/series/quotes?run=KEY&contract=ID`: accepted quotes in event order
  (`event_sequence`, `observed_at`, bid, ask, sizes, underlying). Rejected
  inputs are listed separately.
- `GET /api/series/equity?run=KEY`: one point per committed run event, with
  cash (ledger up to that event), market value (the position's mark at that
  event), equity, and valuation status. Computed server-side in `queries.py`
  from stored records.
- JavaScript only renders these responses; it never computes balances.

**Acceptance criteria.**
1. The SAMPLE DATA — PAPER ONLY banner, the demonstration-strategy notice, and
   the valuation conventions stay visible.
2. Each series point matches existing records: final equity point = the
   `/api/account` snapshot; cash points = ledger balances.
3. When reconciliation fails, the new views are labeled UNTRUSTED, and
   commands stay disabled (existing behavior preserved).
4. No new write endpoints; the existing test of allowed write routes still
   passes unchanged.
5. Browser check at 1280 px and 390 px: no horizontal page scroll, keyboard
   operable, no console errors.
6. Works with no internet connection: no CDN at runtime.
7. The existing suite passes.

---

## Deferred (not assignable yet)

| Item | Why deferred | Precondition to reconsider |
|---|---|---|
| AI / learning loops, parameter optimization | Outside MVP; risk of overfitting and of the demo strategy being mistaken for an edge | New SPEC section, owner approval, FA-2 results reviewed |
| Real-money execution / broker adapter | Safety, credentials, regulatory, and financial risk | Separate specification and security review; a distinct mode, never `SAMPLE_PAPER` |
| Live streaming market data | Needs licensing, clock/latency handling, and a new intake source | FA-1b complete and a live-data SPEC amendment approved |
