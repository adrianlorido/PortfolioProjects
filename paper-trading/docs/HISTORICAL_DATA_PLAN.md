# Historical market-data plan

Status: **FA-1a (engine readiness) complete and accepted (branch
`historical-engine-readiness`). FA-1b is specified in
[`FA1B_INTEGRATION_SPEC.md`](FA1B_INTEGRATION_SPEC.md) (branch
`fa1b-integration-spec`) but not implemented. No data has been bought or
downloaded.**

This plan supersedes FA-1 in `docs/FUTURE_ASSIGNMENTS.md`. No data has been
purchased or downloaded, no API keys are used, and no vendor importer exists.

## Owner decisions

| # | Decision | Status |
|---|---|---|
| 1 | **Vendor selection and spending** | **Undecided.** Databento (OPRA `cbbo-1s` plus a US-equities dataset for SPY) is a *candidate*, not an approved purchase. ThetaData is the alternative candidate. Nothing may be bought or downloaded until the owner approves a vendor and a budget. |
| 2 | **Data classes** | **Approved.** Two distinct classes: `SYNTHETIC` (run mode `SAMPLE_PAPER`) and `HISTORICAL` (run mode `HISTORICAL_PAPER`). Both require honest provenance, have separate banners, and can coexist in one database. A run holds exactly one class. **Synthetic test data stays labeled synthetic**, including when it exercises the historical-data interfaces. |
| 3 | **Session reference price** | **The session-opening reference concept is kept** (no switch to the prior close). The exact *opening observation*, e.g. the first valid SPY observation at or after the scheduled open (which feed, which side or midpoint, and what happens if it is missing), is an **unresolved importer decision** for FA-1b. |
| 4 | **Time semantics** | Three distinct times: (a) **snapshot / as-of time**, the instant a vendor snapshot represents; (b) **market observation time**, when the market actually produced that quote; (c) **ingestion time**, when the vendor or importer recorded it. The engine's freshness rule uses **market observation time** (`observed_at`). A snapshot must **never** make stale or missing data look fresh by rewriting its timestamp. Any historical freshness semantics beyond this need documented vendor guarantees and explicit owner approval before integration. |
| 5 | **Price precision** | Option premiums: integer cents (U.S. options quote in whole-cent increments or coarser). The engine stores `*_cents` as integers and rejects non-integer values (`INVALID_TYPE`); no floating-point money anywhere. **SPY midpoints can be fractional cents** (e.g. bid $600.01 / ask $600.02 → $600.015). These must not be silently rounded. Instead, either store the underlying bid and ask in integer cents and compare with exact rational arithmetic (e.g. `(bid+ask)·10000 ≥ 2·reference·10050`), or use a half-cent unit with an explicit scale. Which one is chosen, and all provider-specific conversions, are **deferred until the chosen vendor's schema is verified** (FA-1b). |
| 6 | **Exchange calendar** | A **versioned** calendar defines scheduled sessions, holidays, and early closes. A historical dataset's session boundaries come from the calendar, not from the data. Coverage is validated against the calendar; **missing rows never redefine session boundaries**; gaps are reported. |
| 7 | **Diagnostic vs evaluation dates** | Hand-picked days (e.g. "an up day", "a gap day", "an early-close day") are **diagnostic cases only**, used to exercise code paths. Future strategy evaluation (FA-2) must use **dates selected independently of their outcomes** (e.g. every trading day in a range fixed in advance) and a **point-in-time contract universe**. What the strategy could know or select must **never** be determined using future information such as that day's high or low. |

## Why engine work came first (measured in Step 7)

The Step 7 engine could not replay a realistic day. Per-event cost grew with
the number of events already replayed:

| Events | Cost per event |
|---|---|
| 500 | 1.6 ms |
| 2,000 | 3.4 ms |
| 6,000 | 9.0 ms |

Total time was therefore quadratic. Profiling found:
- the full fixture JSON re-read and hashed several times per event;
- the accepted-sequence set rebuilt from every quote;
- a correlated MAX subquery for the latest quote;
- the contract list re-derived from the fixture on every quote.

The data model also hard-coded "synthetic sample" (`synthetic_fixture_v1`,
`is_sample = 1`, `mode = 'SAMPLE_PAPER'`), so honest historical provenance was
impossible.

**Sampling constraint.** With the approved 60 s order time-to-live and
"fill only on a later quote", 1-minute snapshot data can never produce a fill.
Historical data must be sampled well under 60 s.

## FA-1a: engine readiness (done, provider-independent)

Implemented as recorded in SPEC.md §14:

- **Data classes and run modes.** SYNTHETIC ↔ `SAMPLE_PAPER`, HISTORICAL ↔
  `HISTORICAL_PAPER`, enforced in the schema, with class-consistent quotes,
  separate banners, and coexistence in one database.
- **Incremental dataset storage** (`datasets`, `dataset_events`,
  `dataset_manifests`). Stores stream from any iterable. Replay verifies a
  dataset once per process, then reads one event per step by primary key.
- **Indexed lookups instead of per-event scans:** source sequences (duplicate
  and highest), the latest quote per contract, the entry-rejection cooldown
  window, and replay/run-event pages. No per-event full parse, hash, or scan
  remains; see *Remaining growth* below.
- **Immutable manifests with provenance validation**, in the application and
  in database CHECKs. **No historical source is approved**, so historical
  datasets cannot be stored until FA-1b registers an importer.
- **Quote provenance times** (`snapshot_at`, `ingested_at`). Freshness still
  uses the market observation time.
- **Versioned exchange calendar** (`xnys_2023_2026_v1`) and a coverage report
  that never moves session boundaries.
- **Bounded reads.** The dashboard shows the latest 50 rows per list; the API
  takes `limit`/`offset` (offset semantics; no cursors) and returns
  `X-Total-Count`; the CLI lists are bounded. Replay events and run events
  serve an offset as an equivalent key range internally (see
  `FA1B_INTEGRATION_SPEC.md` §13.2).
- **Migration 0004:** a safe table rebuild that preserves every row, index,
  trigger, and result of a Step 7 database (tested on a real Step 7 dump).

### Benchmarks

Measured with `python tools/bench_replay.py` on 2026-09-29.
- **Hardware:** Intel Xeon @ 2.10 GHz, 4 logical CPUs, 15.7 GiB RAM, Linux,
  Python 3.11.15, SQLite 3.45.1 (a shared cloud VM, so expect ±10% noise).
- **Workload:** synthetic data only. One trading run over N quotes for
  8 SPY calls (one complete trade, then a long tail), about 1% invalid inputs,
  full reconciliation before and after every event, and one durable commit
  per event (`synchronous = FULL`).
- **Timing:** "replay s" is `run_to_end`. "first/last 10%" is the average
  time inside each step in the first and last tenth of the run: flat means
  no growth.

**FA-1a engine, JSON fixture file** (the existing `load-fixture` path):

| Quotes | Replay s | ms/event | First 10% ms | Last 10% ms | Peak MB | Result |
|---:|---:|---:|---:|---:|---:|---|
| 1,000 | 1.36 | 1.35 | 0.72 | 0.78 | 45.8 | 1 trade, +$78.70, books OK |
| 2,000 | 2.73 | 1.36 | 0.69 | 0.70 | 52.5 | same |
| 4,000 | 5.62 | 1.40 | 0.74 | 0.69 | 63.3 | same |
| 8,000 | 11.70 | 1.46 | 0.70 | 0.72 | 87.1 | same |
| 16,000 | 24.39 | 1.52 | 0.74 | 0.73 | 134.6 | same |
| 32,000 | 48.09 | 1.50 | 0.76 | 0.76 | 233.6 | same |

**FA-1a engine, event-stream dataset stored from a generator**
(`datasets.store_dataset`):

| Quotes | Store s | Replay s | ms/event | First 10% ms | Last 10% ms | Peak MB |
|---:|---:|---:|---:|---:|---:|---:|
| 1,000 | 0.06 | 1.57 | 1.56 | 0.86 | 0.78 | 41.7 |
| 4,000 | 0.21 | 6.03 | 1.51 | 0.74 | 0.75 | 41.6 |
| 16,000 | 0.91 | 24.19 | 1.51 | 0.73 | 0.78 | 41.5 |
| 32,000 | 1.77 | 47.70 | 1.49 | 0.70 | 0.76 | 41.7 |

**Stress case** (`--entry-risk-limit-bps 1`: risk rejects every entry signal,
so a rejection is recorded about once per cooldown), 23,400 quotes (a full
day at 1 s), 344 risk rejections: 34.3 s, **1.47 ms/event**, first/last 10%
0.73/0.76 ms, peak 41.6 MB.

**Step 7 engine, same script and machine** (for comparison):

| Quotes | Replay s | ms/event | First 10% ms | Last 10% ms |
|---:|---:|---:|---:|---:|
| 1,000 | 2.79 | 2.79 | 1.07 | 2.12 |
| 2,000 | 7.78 | 3.89 | 1.29 | 3.77 |
| 4,000 | 27.90 | 6.97 | 2.13 | 7.30 |
| 8,000 | 100.58 | 12.57 | 4.48 | 14.25 |

**Reading the results.**
- Total replay time is now approximately linear: 32× the events take 35×
  the time, and per-event cost is flat at 1.35–1.56 ms, under the 3 ms
  aspiration. Step 7 was quadratic: 8× the events took 36× the time.
- Economic results are identical in every run, on both engines.
- Where the ~1.5 ms goes (profile at 4,000 quotes): ~30% transaction
  overhead: two transactions per event, of which **only the event's own
  writes** (one durable `COMMIT`). The reconciliation guard's transaction
  writes nothing unless reconciliation fails; see
  `FA1B_INTEGRATION_SPEC.md` §13.1, which corrects the earlier "two durable
  commits" wording. ~20% building latest-quote models for the strategy (one per contract per
  quote), ~18% reconciliation (twice per event, unchanged), and the rest SQL
  and validation.
- **Memory:** replay itself uses constant memory (event-stream rows: ~41.7 MB
  at every size). The JSON-fixture path grows with file size because
  `load-fixture` parses the whole document (~234 MB peak for a 32,000-quote
  file). Large or historical data should use the streaming store.

### Remaining growth, profiled

No per-event cost grows with the number of *events*. What remains:
- **Reconciliation** (before and after every event) scans the run's orders,
  fills, positions, ledger entries, and closed trades. Its cost grows only
  with *trading records*, which `sample_spy_long_call` caps (one position,
  one completed trade per run). It was not weakened. A strategy that trades
  many times per run would make reconciliation grow per trade; revisit then
  (e.g. incremental checks proven equal to the full check).
- **Entry-rejection cooldown**: previously re-read every rejected entry on
  every quote. It now reads only the last ~61 s through an index, with
  identical decisions. `tests/test_scaling.py` would catch a regression.
- **Page totals** for quotes, rejected inputs, proposals, and fills use
  `COUNT(*)` (an index scan) once per dashboard or API read, never per event.
  Replay-event and run-event totals and pages are O(1)/O(page).
- **Dataset verification** is O(events), once per process per dataset.


## FA-1b: vendor importer (not started; needs decisions 1, 3, 4, 5)

Scope when approved:
- read locally downloaded vendor files;
- build point-in-time snapshots that honor decision 4;
- write the dataset through the FA-1a storage API with a HISTORICAL manifest
  (vendor, dataset/schema, raw-file SHA-256s, retrieval time, license
  reference, importer version, transformation rules, calendar version,
  coverage report).

## Diagnostic pilot (when a vendor is approved)

- One regular trading day of SPY calls for the single earliest eligible
  expiration, plus SPY best bid/offer, sampled at ≤ 1 s during the calendar's
  scheduled session. This is a **diagnostic case, not an evaluation**.
- Contract universe: must be defined **point-in-time**, from information
  available before or at each event (e.g. strikes listed at the open within a
  band around the opening observation, extended as the underlying moves). It is
  never chosen from the day's eventual high or low.

## Decisions needed before vendor integration (FA-1b)

Superseded by the owner's FA-1b decisions (Git hygiene, opening reference,
exact prices, 1 s observations, point-in-time universe, simulation window)
and by the remaining decisions in `FA1B_INTEGRATION_SPEC.md` §14. The list
below is kept for history.

1. **Vendor and budget** (decision 1). Databento is a candidate only.
   Nothing may be bought or downloaded until this is approved.
2. **License terms.** May raw files or derived datasets be stored in the
   repository, or only locally? The manifest will record a license reference
   either way.
3. **Opening observation** (decision 3). The exact definition of the session
   reference price: which feed, bid/ask/midpoint/trade, the first observation
   at or after 09:30 ET or a window, and what happens if it is missing
   (refuse the day?).
4. **Time semantics** (decision 4). The vendor's documented meaning of each
   timestamp. How point-in-time snapshots are built (e.g. the last quote
   observed at or before each snapshot time, within the 2 s freshness limit).
   What counts as stale or missing.
5. **Price conversion** (decision 5). Integer bid/ask plus exact rational
   comparison, or a half-cent unit for SPY midpoints. The conversion rules for
   the chosen vendor's price format.
6. **Sampling interval** under 60 s (e.g. 1 s), given the 60 s order TTL and
   the "fill on a later quote" rule.
7. **Point-in-time contract universe** for the pilot (e.g. the strikes listed
   at the open within a band around the opening observation, extended as SPY
   moves). Never chosen from the day's high or low.
8. **Early closes:** keep the 13:00 equity close for SPY options, or add the
   13:15 options interval in a new calendar version.
9. **Calendar years:** add 2027+ (a new calendar version) when needed.
