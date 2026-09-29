# Future assignments

These are scoped work packages for after Step 7. **None is implemented.** Each
starts on a new branch from the latest step branch, begins by reading
SPEC.md, `docs/HANDOFF.md`, and `STEP6_VALIDATION.md`, and ends with the full
suite passing plus its own acceptance tests.

**Rules for every assignment:**
- Mode stays `SAMPLE_PAPER`, with no real-money execution and no AI/learning.
  Both remain deferred (see `docs/HANDOFF.md`).
- Don't change approved trading or accounting rules. If a rule must change,
  write the SPEC amendment first and get owner approval.
- Leave these untouched unless the assignment explicitly says otherwise:
  `strategy/`, `risk/`, `broker/`, `accounting/`, `app/trading.py`, and
  `app/replay.py` (trading logic).
- Never edit an applied migration. New tables or columns go in a new migration.
- No network access in tests. No credentials in the repository.

| ID | Assignment | Depends on | Blocking owner decisions |
|---|---|---|---|
| FA-1 | Market-data integration (recorded/historical → fixtures) | — | D1–D4 below |
| FA-2 | Strategy evaluation (measurement only) | none (FA-1 optional, for more fixtures) | D5 |
| FA-3 | Dashboard improvements (read-only views and UX) | none | D6 |

---

## FA-1: Market-data integration (recorded/historical data into fixtures)

**Goal.** Convert externally recorded option quotes (a vendor export file) into
the existing versioned fixture format. The data then flows through the
unchanged intake → replay → trading path. This is an offline import, not a
live feed.

**Owner decisions required before coding:**
- **D1:** data source and licensing; whether imported data may be committed or
  must stay local.
- **D2:** labeling. Imported fixtures are real historical prices, not
  synthetic. Decide the `data_label`, a new registered `source` id (e.g.
  `historical_import_v1`), and whether `is_sample` / `SAMPLE_PAPER` wording
  changes. This requires a SPEC amendment.
- **D3:** session calendar (holidays, early closes) and how session
  boundaries and the reference price are derived.
- **D4:** contract universe to import (still SPY calls within scope).

**File ownership.**

| Owns (creates or edits) | May touch, with lead review | Must not change |
|---|---|---|
| `paper_trading/market_data/importers/` (new package), `tests/test_importers.py`, `tests/fixtures/import_samples/`, CLI subcommand `import-fixture` in `__main__.py`, docs | `market_data/fixtures.py`: register the new source id only; SPEC.md amendment | `market_data/intake.py` rules, `app/replay.py`, all trading/accounting modules, existing fixtures |

**Interfaces.**
- `importers.<vendor>.read(path) -> Iterable[RawQuoteRow]`: vendor parsing
  only.
- `importers.build_fixture(rows, *, contracts, session, reference_cents, fixture_id, fixture_version, source, data_label) -> dict`
  returns a fixture document with a computed checksum.
- The output must pass `market_data.fixtures.parse_fixture` unchanged, and
  loads with the existing `load-fixture --path`.
- Malformed vendor rows are **emitted as raw quote inputs**, so intake rejects
  them with reason codes. Rows that cannot be represented at all are listed in
  an import report, never silently dropped.

**Acceptance criteria.**
1. The same input file and parameters produce a byte-identical fixture and
   checksum.
2. Timestamps are converted to RFC 3339 UTC `Z`. The session date is derived
   in America/New_York, and daylight-saving transitions are covered by tests.
3. Prices are converted to integer cents exactly (no float rounding); a test
   covers sub-cent vendor values.
4. Contracts outside MVP scope are rejected at import with a clear message.
5. The import report counts rows read, emitted, and unrepresentable, with
   reasons.
6. An imported fixture replays in a trading run with `CheckedRun` and no
   books discrepancy.
7. The existing suite passes; the worked example and bundled fixture are
   unchanged.
8. No network calls or API keys. Any credentials needed later come from
   environment variables, documented in `.env.example` without values.

---

## FA-2: Strategy evaluation (measurement only)

**Goal.** Run `sample_spy_long_call` v1.0.0 unchanged over a set of fixtures
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
| Live streaming market data | Needs licensing, clock/latency handling, and a new intake source | FA-1 complete and a live-data SPEC amendment approved |
