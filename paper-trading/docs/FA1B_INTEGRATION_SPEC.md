# FA-1b integration specification: historical SPY options data (Databento candidate)

Status: **specification only.** Nothing here is implemented, purchased, or
downloaded. No API key has been created or used. No spending is authorized.
FA-1a (engine readiness) is accepted as reported; it is on branch
`historical-engine-readiness`, and this document is on branch
`fa1b-integration-spec`.

Contents:
1. Owner decisions this spec implements
2. Vendor facts: confirmed vs unresolved
3. Opening reference price: proposed exact definition
4. Exact prices and units
5. One-second observations: unchanged vs stale vs missing
6. Point-in-time contract universe
7. Simulation window
8. Smallest useful diagnostic dataset
9. Reproducible cost-estimation request (account steps, then stop)
10. Engine changes FA-1b needs (SPEC amendment required)
11. Importer design: files, interfaces, validation, provenance
12. Acceptance tests
13. Answers: two transactions per event; pagination semantics
14. Remaining decisions

---

## 1. Owner decisions this spec implements

| # | Decision (owner, this round) | Where |
|---|---|---|
| D1 | Raw vendor data and API keys stay out of Git. Commit only code, docs, and clearly labeled synthetic test fixtures. | §11.1, §11.6 |
| D2 | Keep the session-opening reference. Define it exactly from the selected underlying feed, with an opening window and missing-data behavior. Never substitute the previous close. | §3 |
| D3 | Exact prices: underlying bid/ask stored in the provider's integer units, midpoint compared algebraically; option accounting in cents only where conversion is exact; unsupported precision rejected explicitly. | §4, §10 |
| D4 | Target 1 s observations, subject to confirming vendor semantics. Distinguish an unchanged valid quote from a stale feed or missing coverage. Never relabel old observations with fresh timestamps. | §5 |
| D5 | Contracts chosen only from information available at the simulated time, with the approved expiration/strike ordering; never from the day's eventual high or low. | §6 |
| D6 | Pilot trades only in the underlying equity regular session (including early closes), labeled as *our simulation window*, not the full options session. Keep INCOMPLETE behavior. Reject dates outside the supported calendar. | §7 |

Earlier decisions still in force (`docs/HISTORICAL_DATA_PLAN.md`): Databento
is a candidate, not an approved purchase; synthetic and historical classes stay
separate and honest; hand-picked days are diagnostic only.

---

## 2. Vendor facts: confirmed vs unresolved

**Sources and their limits.** The vendor's website (`databento.com`) is
blocked by this environment's network policy. The primary sources read are
Databento's own open-source repositories:
- `github.com/databento/dbn` @ `d368005` (2026-09-29): the DBN record format
  specification in Rust, whose field doc comments are the record schema docs;
- `github.com/databento/databento-python` @ `25eef4e` (2026-09-22): the
  official client, including the metadata and cost endpoints.

Facts marked *search snippet* came from web-search excerpts of databento.com
pages, not a direct read. Treat them as leads to confirm.

### 2.1 Confirmed (primary source: official repositories)

| Topic | Fact | Source |
|---|---|---|
| Datasets | `OPRA.PILLAR` ("OPRA Binary") exists. `EQUS.SIP` ("US Equities Security Information Processor"), `EQUS.MINI` ("Databento US Equities Mini"), `EQUS.SUMMARY`, `XNAS.ITCH`, `ARCX.PILLAR` (NYSE Arca Integrated), and `DBEQ.BASIC` also exist. | `dbn/rust/dbn/src/publishers.rs` |
| Schemas | `cbbo-1s`: "Consolidated best bid and offer subsampled at one-second intervals, in addition to trades." `bbo-1s`: "Best bid and offer subsampled at one-second intervals, in addition to trades." `cmbp-1`: "Consolidated best bid and offer" (tick level). `tcbbo`, `definition`, `statistics`, `status`. | `enums.rs` (`Schema`) |
| `cbbo-1s` record (`CbboMsg`) | Fields: header (`rtype`, `publisher_id`, `instrument_id`, `ts_event`), `price` and `size` of the **last trade** (`UNDEF_PRICE` if no trade in the session), `side`, `flags`, `ts_recv`, and one `ConsolidatedBidAskPair` (`bid_px`, `ask_px`, `bid_sz`, `ask_sz`, `bid_pb`, `ask_pb` = publisher of the best bid/ask). No `sequence` field. | `record.rs` |
| `ts_recv` on `cbbo-1s` / `bbo-1s` | "The **end timestamp of the interval** capture-server-received timestamp expressed as the number of nanoseconds since the UNIX epoch." It is the index timestamp. | `record.rs` (`CbboMsg`, `BboMsg`) |
| `ts_event` (generic header) | "The matching-engine-received timestamp expressed as the number of nanoseconds since the UNIX epoch." | `record.rs` (`RecordHeader`) |
| Price units | Every price field is `i64` where "every 1 unit corresponds to 1e-9". `FIXED_PRICE_SCALE = 1_000_000_000`. `UNDEF_PRICE = i64::MAX` means null. | `record.rs`, `lib.rs` |
| Size units | `bid_sz`, `ask_sz`: `u32`, documented only as "The bid size" / "The ask size". `UNDEF_ORDER_SIZE = u32::MAX`. | `record.rs`, `lib.rs` |
| Flags | `LAST`, `TOB`, `SNAPSHOT`, `MBP`, `BAD_TS_RECV` ("`ts_recv` value is inaccurate due to clock issues or packet reordering"), `MAYBE_BAD_BOOK` ("an unrecoverable gap was detected in the channel"), `PUBLISHER_SPECIFIC`. | `flags.rs` |
| Instrument definitions | `definition` records carry `strike_price` (1e-9 units), `expiration` (ns; "some publishers only provide date-level granularity"), `activation`, `instrument_class`, `raw_symbol`, `underlying`, `underlying_id`, `unit_of_measure_qty` (1e-9 units), `min_price_increment`, `security_update_action` (added/modified/deleted), `currency`, `ts_recv`. | `record.rs` (`InstrumentDefMsg`) |
| Symbology | `parent` symbology groups instruments under one parent symbol (format `[ROOT].[ASSET_CLASS]`; the client's example is `ES.OPT`). `raw_symbol` is the publisher's symbol. `instrument_id` is numeric. | `enums.rs` (`SType`), client `validation.py` |
| Access | Every metadata call (`list_schemas`, `get_dataset_range`, `get_dataset_condition`, `list_unit_prices`, `get_record_count`, `get_billable_size`, `get_cost`) uses HTTP basic auth, **so it needs an API key.** `get_cost` returns US dollars and "respects any discounts provided by flat rate plans". Symbol lists take up to 2,000 symbols per request. | client `historical/api/metadata.py` |
| Dataset condition | `get_dataset_condition(dataset, start_date, end_date)`: "Use this method to discover data availability and quality", per date. | client `metadata.py` |

### 2.2 Reported but not directly verified (search snippets)

- `OPRA.PILLAR` `cbbo-1s` is available from **2023-03-28**. Since 2025-05-21
  the dataset also has history from 2013-04-01 for trades, OHLCV,
  statistics, definitions, and **`cbbo-1m`** (not `cbbo-1s`).
- A free-credit offer ($125) is advertised on vendor pages.
- Earlier research (HISTORICAL_DATA_PLAN) listed pricing; none of it is
  verified here.

### 2.3 Unresolved: must be confirmed before implementation

| # | Question | Why it matters | How to resolve |
|---|---|---|---|
| U1 | On `cbbo-1s`, what exactly is the header `ts_event`? The time of the last BBO change? The last event of any kind in the interval? | Determines the market observation time (decision 4). | Vendor docs page `schemas-and-data-formats/cbbo`; vendor support. |
| U2 | Does `cbbo-1s` emit a record **every second for every instrument** with a live book (including unchanged quotes), or only when something changed, or only after the first update of the day? | Distinguishes unchanged from missing (§5). | Same, plus `get_record_count` for one contract-day (≈23,400 would mean every second). |
| U3 | Liveness: when the book is unchanged, what evidence says the feed was healthy at `ts_recv`? Are OPRA channel gaps flagged with `MAYBE_BAD_BOOK` on subsampled records? | An unchanged quote may only be treated as observed at `T` with liveness evidence. | Vendor docs on flags for subsampled schemas; `get_dataset_condition`. |
| U4 | How an empty side is represented on `cbbo-1s` (`UNDEF_PRICE` with size 0? price 0?). | Mapping to "missing" vs a zero bid. | Vendor docs. |
| U5 | Size unit for OPRA `bid_sz`/`ask_sz` (contracts, by OPRA convention). For SPY (`EQUS.SIP`): shares, not round lots? | Displayed-size fill rule. | Vendor docs for each dataset. |
| U6 | `EQUS.SIP`: historical start date, supported schemas (`bbo-1s`? `cbbo-1s`? `cmbp-1`?), and whether it is the CTA/UTP consolidated NBBO for SPY (a Tape B security). Fallback candidates: `EQUS.MINI` (a vendor-built consolidation), `ARCX.PILLAR` (primary listing venue BBO, not an NBBO). | The underlying feed defines the opening reference and rule 2/5 comparisons. | `list_schemas`, `get_dataset_range` (§9), vendor docs. |
| U7 | How to recognize adjusted or non-standard SPY options in OPRA definitions (non-100 deliverable, e.g. a root other than `SPY`). | Contract scope (standard, unadjusted, ×100). | Vendor docs for `definition` on OPRA; inspect `unit_of_measure_qty`, `raw_symbol`, `underlying`. |
| U8 | Exact parent symbol for SPY options (expected `SPY.OPT` by the documented format) and for the underlying (`SPY` raw symbol). | Requests. | `metadata` / `symbology.resolve` with a key. |
| U9 | Whether `cmbp-1` (tick-level consolidated BBO) is offered historically for OPRA, and its cost. | Fallback if U1–U3 cannot be confirmed (§5.4). | `list_schemas("OPRA.PILLAR")`, `get_cost`. |
| U10 | License terms for local storage and derived datasets; whether metadata/cost calls are free and do not consume credits. | D1; no spending authorized. | Vendor terms page, account portal. |

---

## 3. Opening reference price: proposed exact definition

The concept is unchanged: one fixed **session reference price** per session,
taken at the opening. Rule 2 compares the current underlying midpoint with it.

**Proposed definition (`opening_reference_v1`):**
1. **Feed:** the approved underlying consolidated top-of-book feed (proposed:
   `EQUS.SIP` 1 s consolidated BBO for raw symbol `SPY`, subject to U6).
2. **Window:** snapshots whose interval-end time `T` (`ts_recv`) satisfies
   09:30:01 ≤ T ≤ 09:31:00 America/New_York on the calendar's scheduled
   session date. The 09:30:00 snapshot is excluded because its interval
   ends *at* the open and covers pre-open time.
3. **Valid observation:** the first snapshot in the window such that:
   - both sides are present (neither price is `UNDEF_PRICE`), with bid > 0
     and ask > 0;
   - bid ≤ ask (locked is allowed; crossed is not);
   - neither `MAYBE_BAD_BOOK` nor `BAD_TS_RECV` is set;
   - its observation time satisfies §5: it must be observed **at or after
     09:30:00** (a quote last updated before the open does not count), and
     it must meet the 2 s freshness rule at `T`.
4. **Value:** the reference is the exact pair (`ref_bid`, `ref_ask`) in
   provider units (1e-9 USD). The midpoint is the rational
   (ref_bid + ref_ask) / 2, **never rounded or stored rounded**. For
   display, show it as an exact decimal (e.g. $600.015).
5. **Missing data:** if no valid observation exists in the window, the
   importer **refuses the day** (`OPENING_REFERENCE_MISSING`, listed in the
   import report). No dataset is produced. There is no substitution: not the
   previous close, not a later quote, not a trade price.
6. **Provenance:** the manifest records the definition id
   (`opening_reference_v1`), the feed and schema, the chosen snapshot's `T`,
   its `ts_event`, the raw bid/ask, flags, and the reasons for any rejected
   earlier snapshots in the window.

---

## 4. Exact prices and units

| Value | Provider units | Stored as | Rule |
|---|---|---|---|
| Underlying bid/ask (SPY) | i64, 1e-9 USD | **Exact provider integers** (`underlying_bid_nanos`, `underlying_ask_nanos`) | Never converted to cents. Midpoint comparisons are algebraic (§10). |
| Session reference | i64 pair | `ref_bid_nanos`, `ref_ask_nanos` | As above. |
| Option bid/ask | i64, 1e-9 USD | Integer cents | Converted only if `px % 10_000_000 == 0` (an exact whole cent). Otherwise the quote is **rejected** with the new reason `UNSUPPORTED_PRECISION`, and the raw value is kept in `rejected_inputs`. |
| Option strike | i64, 1e-9 USD | Integer cents | Exact whole cents only; otherwise the contract is excluded from the universe and reported (`UNSUPPORTED_PRECISION`). |
| Contract size | `unit_of_measure_qty` (1e-9 units) | Multiplier | Must equal exactly 100 (i.e. 100·10⁹), or the contract is out of scope. |
| Sizes | u32 | Integer | `UNDEF_ORDER_SIZE` is treated as missing (§5), never as a number. |
| Fees, cash, P&L | — | Integer cents | Unchanged. Premiums are whole cents, so accounting stays exact. |

No floats anywhere in the importer. The DBN Python bindings expose `*_px` as
integers; the importer must read those, never the `pretty_*` float
conveniences.

---

## 5. One-second observations: unchanged vs stale vs missing

Definitions, for one contract (or the underlying) at snapshot time `T`
(interval end, `ts_recv`):

| State | Evidence | Emitted? | `observed_at` | Result in engine |
|---|---|---|---|---|
| **Changed quote** | A record at `T` whose `ts_event` is inside (T−1 s, T]. | yes | `ts_event` | Normal. |
| **Unchanged valid quote** | A record at `T`, no bad flags, and **liveness evidence** (U3) that the feed was healthy through `T`. | yes | `T` (the time the data proves the quote was still in force) | Fresh, if within 2 s of the clock. |
| **Stale feed** | A record at `T` but no liveness evidence (bad flags, degraded dataset condition, or vendor semantics that don't guarantee a live book). | yes, as a raw input | `ts_event` (its true last observation) | Rejected `STALE_QUOTE` when older than 2 s; counted in the report. |
| **Missing coverage** | No record for the instrument at `T`. | no | — | The engine's latest quote ages normally, so marks go STALE and entries stop. A coverage gap is reported. |

Rules:
1. `observed_at` is set to `T` **only** for the "unchanged valid" state, and
   only with liveness evidence. Otherwise it is the provider's own
   observation time. A timestamp is never refreshed for convenience.
2. Every emitted quote also records `snapshot_at = T` and a new provenance
   field `last_update_at = ts_event`, so the audit trail shows exactly when
   the market last changed. Rule: `last_update_at ≤ observed_at ≤ snapshot_at`.
3. The option quote at `T` is joined with the underlying snapshot at the
   same `T`. The underlying's `observed_at` follows the same table. If the
   underlying is stale or missing at `T`, the option quote is still emitted
   with the true underlying observation time, and intake rejects it
   (`STALE_UNDERLYING`). The importer never borrows a different second.
4. Until U1–U3 are confirmed, the "unchanged valid" row is **disabled**: any
   record whose `ts_event` is older than `T − 1 s` is emitted with
   `observed_at = ts_event`. This is conservative; unchanged quotes become
   stale, which may block entries on quiet contracts but can never
   fabricate freshness.

**Fallback (5.4) if the vendor cannot guarantee liveness for `cbbo-1s`:**
build the 1 s snapshots from tick-level consolidated BBO (`cmbp-1`, U9),
where every change is present and gaps are flagged. At each `T` the state is
the last update at or before `T`. It is "unchanged valid" when no gap flag has
appeared since that update. This costs more (to be estimated in §9).

---

## 6. Point-in-time contract universe

Strategy facts: eligibility (rules 1–5) is decided per contract and does not
depend on quotes. The selection picks the **earliest eligible expiration**,
then the **lowest strike at or above the current underlying midpoint** (rules
5–6). Spread and freshness are checked only on the selected contract.

**Universe rule `pit_universe_v1`:**
1. **Listed set (pre-open).** From OPRA `definition` records with
   `ts_recv` before 09:30:00 ET on date D, take SPY calls that are:
   standard (U7), unadjusted, multiplier 100, whole-cent strike, not
   deleted as of 09:30:00.
2. **Expiration.** The earliest listed expiration E with
   D + 30 ≤ E ≤ D + 45 calendar days (New York dates, rule 4). This is fixed
   for the day, because eligibility is date-based. If no expiration
   qualifies, the day is refused (`NO_ELIGIBLE_EXPIRATION`).
3. **Outer band (header contracts).** All listed strikes of E within
   [0.95 × R, 1.05 × R], where R is the opening reference midpoint (§3),
   known at the open. These form the dataset's `contracts`.
4. **Emission band (per second, sticky).** At each `T`, emit quotes for the
   header contracts whose strike lies within [0.99 × U_T, 1.02 × U_T],
   where U_T is the underlying midpoint at `T`. A contract **also** keeps
   being emitted once it has been in the band at any earlier time. This
   only uses information up to `T`, and it keeps quotes flowing for a
   position the strategy may hold.
5. **Boundary.** If U_T leaves the outer band, the importer records
   `UNIVERSE_BOUND_REACHED` with the time. From then on the strategy may
   see fewer contracts than the full chain. The day is still replayable but
   flagged in the manifest and report.

Never used: the day's high, low, close, or any later quote. The band
parameters (0.95/1.05, 0.99/1.02) are owner-approvable constants, recorded
in the manifest. Why this matches the full chain while inside the outer
band: the selected contract is always the lowest strike ≥ U_T, which lies in
[U_T, U_T + one strike increment], inside the emission band.

---

## 7. Simulation window

- **Our simulation window** = the underlying equity regular session from the
  versioned calendar: 09:30–16:00 ET, or 09:30–13:00 ET on early-close days.
  Labeled in the manifest (`simulation_window: "equity_regular_session"`)
  and on the dashboard as "Simulation window: equity regular session (not
  the full options session)". On early-close days eligible options may trade
  until 13:15; that interval is deliberately excluded.
- Dates outside the calendar (`xnys_2023_2026_v1`), holidays, and weekends
  are rejected (`CalendarRangeError` / not a trading day). OPRA `cbbo-1s`
  coverage (from 2023-03-28, per search snippet) must also include the date.
- At the window end the existing behavior applies: open orders expire
  (`SESSION_END`); a run with open exposure ends **INCOMPLETE**. No close is
  invented.

---

## 8. Smallest useful diagnostic dataset

One diagnostic day. It exercises the code paths and is **not an evaluation**.

| Item | Proposal |
|---|---|
| Date D | **2025-06-02** (Monday). Chosen by a fixed rule: the first full, regular trading day of June 2025. It is inside `cbbo-1s` coverage and the calendar, not an early close, and not chosen from outcomes. An optional second diagnostic (early close): **2025-07-03**. |
| Options | `OPRA.PILLAR` `definition` for parent `SPY.OPT` on D (listed set); `cbbo-1s` for the header contracts of `pit_universe_v1` on D, 09:30–16:00 ET (13:30–20:00 UTC). |
| Underlying | `EQUS.SIP` (or the approved fallback) 1 s consolidated BBO for `SPY`, 09:29–16:01 ET. |
| Size estimate | About 60 strikes in the outer band (for $1 strikes near $600) × 23,400 s. Records ≲ 1.4 M; emitted events ~0.3–0.6 M (sticky emission band), i.e. roughly 8–15 min of replay at ~1.5 ms/event. |

A cost upper bound uses the whole parent (`SPY.OPT`, all strikes and
expirations) because the listed set is not known without downloading
definitions.

---

## 9. Reproducible cost-estimation request (then stop)

An exact estimate **needs an account and an API key** (every metadata call
uses authentication, §2.1). Nothing may be spent.

**Account steps, for the owner:**
1. Create a Databento account at databento.com and verify the email.
2. Before anything else, read the terms on data licensing and local storage
   (U10), and confirm in the portal that metadata calls (cost, record count,
   schemas) are free and do not use credits.
3. Create an API key in the portal. Keep it **only** in your shell
   environment (`DATABENTO_API_KEY`). Never put it in `.env` files inside the
   repository, commit it, or paste it into chat.
4. `python -m pip install databento` (in a separate virtualenv; it is not a
   project dependency yet).
5. Run the script below. It **only calls metadata endpoints** (no
   `timeseries.get_range`, no `batch.submit_job`), so it downloads no market
   data.
6. Send the printed output back. **Stop there**; no data request until the
   owner approves a budget.

```python
# fa1b_cost_estimate.py -- metadata only; downloads no market data. Not committed code.
import os, json
import databento as db

client = db.Historical(os.environ["DATABENTO_API_KEY"])
D, D1 = "2025-06-02", "2025-06-03"
session = ("2025-06-02T13:30:00Z", "2025-06-02T20:00:00Z")   # 09:30-16:00 ET (EDT)
underlying_window = ("2025-06-02T13:29:00Z", "2025-06-02T20:01:00Z")

out = {}
for ds in ("OPRA.PILLAR", "EQUS.SIP", "EQUS.MINI"):
    try:
        out[ds] = {"schemas": client.metadata.list_schemas(ds),
                   "range": client.metadata.get_dataset_range(ds),
                   "condition": client.metadata.get_dataset_condition(ds, D, D)}
    except Exception as e:                       # report, never guess
        out[ds] = {"error": repr(e)}

requests = [
    # (label, dataset, schema, symbols, stype_in, start, end)
    ("opra definitions (listed set)", "OPRA.PILLAR", "definition", "SPY.OPT", "parent", D, D1),
    ("opra cbbo-1s, whole chain (upper bound)", "OPRA.PILLAR", "cbbo-1s", "SPY.OPT", "parent", *session),
    ("opra cmbp-1, whole chain (fallback 5.4)", "OPRA.PILLAR", "cmbp-1", "SPY.OPT", "parent", *session),
    ("spy sip bbo-1s", "EQUS.SIP", "bbo-1s", "SPY", "raw_symbol", *underlying_window),
    ("spy sip cbbo-1s", "EQUS.SIP", "cbbo-1s", "SPY", "raw_symbol", *underlying_window),
    ("spy mini bbo-1s (fallback)", "EQUS.MINI", "bbo-1s", "SPY", "raw_symbol", *underlying_window),
]
for label, ds, schema, sym, stype, start, end in requests:
    kw = dict(dataset=ds, schema=schema, symbols=sym, stype_in=stype, start=start, end=end)
    row = {}
    for name, fn in (("cost_usd", client.metadata.get_cost),
                     ("records", client.metadata.get_record_count),
                     ("bytes", client.metadata.get_billable_size)):
        try:
            row[name] = fn(**kw)
        except Exception as e:                   # e.g. schema not offered for this dataset
            row[name] = f"error: {e!r}"
    out[label] = row
print(json.dumps(out, indent=2, default=str))
```

The record count for the whole chain also helps answer U2 (every second vs
only on change): compare it with (number of listed contracts × 23,400).

---

## 10. Engine changes FA-1b needs (SPEC amendment required)

These change *representation*, not rule thresholds. Synthetic runs must
produce identical results, which the existing suite verifies.

| # | Change | Detail |
|---|---|---|
| E1 | Exact underlying | Quote inputs may carry `underlying_bid_nanos`/`underlying_ask_nanos` instead of `underlying_price_cents` (exactly one representation per quote). Historical quotes must use nanos. Storage: migration 0005 makes `market_quotes.underlying_price_cents` nullable, adds a side table `quote_underlying_exact(quote_id, bid_nanos, ask_nanos)`, and a trigger requires exactly one representation. |
| E2 | Algebraic rules | Rule 2: `10000·(b+a) ≥ 10050·(rb+ra)`. Rule 5: `2·strike_nanos ≥ b+a`, with `strike_nanos = strike_cents·10⁷`. For cents inputs, the same formulas use `b = a = price·10⁷`, which reproduces today's integer comparisons exactly. Proposal text shows exact decimals. Implemented as `market_data.prices.UnderlyingPrice`, an integer (bid, ask) pair with integer-only comparison methods (no floats, no rounding). |
| E3 | Exact reference | `datasets` and `runs` gain `ref_bid_nanos`/`ref_ask_nanos` (nullable; required for HISTORICAL). `session_reference_cents` stays for synthetic data. Intake's `REFERENCE_PRICE_MISMATCH` compares the pair when present. |
| E4 | Option precision | Intake accepts `bid_nanos`/`ask_nanos` for options and converts only exact whole cents; otherwise it rejects with the new reason `UNSUPPORTED_PRECISION`. |
| E5 | Provenance | `quote_provenance.last_update_at`, plus the rule `last_update_at ≤ observed_at ≤ snapshot_at` (intake reason `INCONSISTENT_PROVENANCE_TIME`). |
| E6 | Window label | The manifest `simulation_window` is shown on the dashboard beside the HISTORICAL banner. |
| E7 | Importer registry | `APPROVED_HISTORICAL_IMPORTERS = {"databento_opra_cbbo": {"1.0.0"}}`, added only when the owner approves vendor and budget. |

---

## 11. Importer design

### 11.1 Files (all committed files are code, docs, or synthetic fixtures)

```
paper_trading/market_data/importers/
    __init__.py
    databento_dbn.py      read local .dbn(.zst) files -> typed rows (no network)
    snapshots.py          1 s snapshot builder: states of section 5; underlying join
    universe.py           pit_universe_v1 (section 6)
    reference.py          opening_reference_v1 (section 3)
    build.py              orchestration -> datasets.store_dataset(...) + ImportReport
paper_trading/market_data/prices.py   exact underlying pair (E1, E2)
tests/test_importer_*.py
tests/fixtures/import_samples/         tiny SYNTHETIC files imitating the DBN layout,
                                       labeled "SYNTHETIC - NOT VENDOR DATA"
```

Local only, never committed: `vendor_data/` (raw `.dbn.zst`, git-ignored;
add `vendor_data/` and `*.dbn*` to `.gitignore`) and `DATABENTO_API_KEY` (an
environment variable only). The importer **reads local files only**. Any
download is a separate, manual, owner-approved step.

### 11.2 Interfaces

```python
read_dbn(path) -> Iterator[Row]            # streaming; exact ints; header metadata kept
build_listed_set(definition_rows, date) -> ListedSet
opening_reference(underlying_rows, calendar_session) -> Reference | refuse(OPENING_REFERENCE_MISSING)
select_universe(listed, reference, params) -> Universe         # pit_universe_v1
snapshots(option_rows, underlying_rows, universe, session) -> Iterator[EventDict]
import_day(files: DayFiles, *, date, calendar_id, params, dataset_version) -> ImportReport
```

`import_day` calls
`datasets.store_dataset(data_class="HISTORICAL", source="databento_opra_cbbo_v1", calendar_id=..., events=<generator>, manifest=...)`.
It is deterministic: the same files and parameters give the same dataset
checksum.

### 11.3 Validation rules (importer; intake re-validates every quote)

- **File level:** DBN header dataset, schema, and time range match the
  request. The SHA-256 of each file matches its manifest entry. Records are
  sorted by `ts_recv` per file; a regression is an error.
- **Calendar:** the date is a trading day in the calendar; the session comes
  from the calendar; `get_dataset_condition` recorded as `available` for D
  (otherwise refuse; override only by the owner).
- **Records:** unknown `instrument_id` → `UNKNOWN_CONTRACT` (emitted as a
  raw input, so it is recorded). Flags `MAYBE_BAD_BOOK`/`BAD_TS_RECV` → not
  live (§5). `UNDEF_PRICE`/`UNDEF_ORDER_SIZE` → missing side (emitted
  without that field → `MISSING_FIELD`/`MISSING_SIZE`), never 0. Crossed →
  emitted, rejected `CROSSED_QUOTE`.
- **Sequence:** `source_sequence` is importer-assigned, strictly increasing
  in emission order (documented; `cbbo-1s` has no vendor sequence).
- **Counts:** rows read = emitted + excluded (by reason) + unrepresentable
  (by reason); totals must balance or the import fails.

### 11.4 Provenance (HISTORICAL manifest; all fields required by FA-1a)

`vendor: "Databento"`, `vendor_dataset: "OPRA.PILLAR cbbo-1s + definition; EQUS.SIP <schema>"`,
`raw_files: [{name, sha256, bytes, dataset, schema, start, end}]`,
`retrieved_at`, `license_reference`, `importer: {name, version}`,
`transformation_rules: {opening_reference: "opening_reference_v1", universe: {"rule": "pit_universe_v1", params}, snapshot_rule, liveness_rule, source_sequence: "importer-assigned"}`,
`time_semantics: {observed_at, snapshot_at, last_update_at, ingested_at: null}` (with the vendor-document references),
`price_conversion: {underlying: "exact 1e-9 integers", options: "whole cents only; else UNSUPPORTED_PRECISION"}`,
`coverage: <CoverageReport per contract and underlying>`, `simulation_window`,
`calendar_id`, `dbn_version`, `client_version`, `import_report_digest`.

### 11.5 Import report

Per day: rows read per file; emitted events; exclusions by reason; states
(changed / unchanged-valid / stale / missing seconds) per contract;
`UNIVERSE_BOUND_REACHED` times; the opening-reference decision trail; and
coverage gaps. Stored beside the dataset as JSON, with its digest in the
manifest.

### 11.6 Git hygiene

`.gitignore` gains `vendor_data/`, `*.dbn`, `*.dbn.zst`. A test asserts that
no tracked file under `tests/fixtures/import_samples/` lacks the SYNTHETIC
label, and that no file in the repository starts with the DBN magic bytes
`DBN`.

---

## 12. Acceptance tests (FA-1b)

1. **Determinism:** the same synthetic sample files and parameters give the
   same dataset checksum and report digest.
2. **Opening reference:** first valid snapshot chosen; the 09:30:00 snapshot
   excluded; a pre-open last update excluded; crossed, one-sided, or flagged
   snapshots skipped; nothing valid → `OPENING_REFERENCE_MISSING` and no
   dataset; never the previous close.
3. **Exactness:** a $600.01/$600.02 underlying gives midpoint 600.015. Rule 2
   and rule 5 at exact boundaries in both directions; a sub-cent option price
   → `UNSUPPORTED_PRECISION`. Synthetic runs are unchanged (the full
   existing suite).
4. **Unchanged vs stale vs missing:** each state of §5 gives the documented
   `observed_at` and engine outcome. With liveness unconfirmed, no quote has
   `observed_at > ts_event + 1 s`. A missing second emits nothing, and marks
   go STALE.
5. **Universe:** built only from pre-open definitions and past underlying
   values; a test feeds a future high and proves it changes nothing before
   it happens. Sticky emission is tested; the outer-bound flag is tested.
6. **Window:** a regular day ends 16:00 ET; an early-close day ends 13:00 ET;
   a holiday, weekend, or out-of-range date is refused. Open exposure at the
   window end → INCOMPLETE.
7. **Provenance:** the manifest has every required field; banner
   HISTORICAL; the synthetic samples stay SYNTHETIC-labeled when exercising
   the importer (the full import path is exercised with a test-only importer
   registration that stores `data_class="SYNTHETIC"`).
8. **End to end:** the synthetic sample files go through the full import path
   under a test-only importer registration that stores the result as
   **SYNTHETIC** (a HISTORICAL label on test data is forbidden). The result
   replays in a `SAMPLE_PAPER` run under `CheckedRun`, with the books checked
   after every event. A real `HISTORICAL_PAPER` replay happens only after an
   approved purchase, outside the test suite.
9. **Hygiene:** no network in tests; no key; no vendor bytes committed.

---

## 13. Answers to two review questions

### 13.1 "Two durable commits per replay event" (correction)

My FA-1a report said each event costs "two durable commits". The accurate
statement: each replay step runs **two transactions**, but in normal
operation **only one writes**.

1. **Guard transaction** (`replay._guard_trading_mutation`). A
   `BEGIN IMMEDIATE` … `COMMIT` that takes the write lock and runs
   `reconcile` read-only. When the books reconcile, it writes nothing.
   Measured on this branch: 0 WAL frames, 0 row changes. It uses a write
   lock so that no other writer can change the books between the check and
   the decision. It writes only on failure: it pauses the RUNNING run and
   appends `RECONCILIATION_FAILED`, a self-contained record.
2. **Event transaction** (`_step_in_transaction` inside `BEGIN IMMEDIATE`).
   Everything economic and the checkpoint commit **together**: the accepted
   quote or rejection, the run event(s), orders, fills, ledger entries,
   positions, closed trades, the replay cursor (`next_position`), the
   simulated clock and `checkpoint_event_sequence`, and, for `step`, the
   command record. Reconciliation runs again inside it before `COMMIT`; a
   failure rolls the whole event back. Measured: 12 WAL frames, 5 row
   changes for one quote event (more when a trade happens).

**Can an interruption separate economic changes from their checkpoint?** No.
The only boundary between the two transactions comes *before* any economic
write. A crash after the guard commits and before the event commits leaves
the event entirely unapplied (SQLite rolls back the uncommitted transaction
on restart), and a retry repeats the guard and the event. A crash inside the
event transaction also rolls back as a unit. `run_to_end` records its own
command result in a final, third transaction after the loop. If it is
interrupted before that, a retry with the same key resumes from the
committed checkpoint (tested on 5,000 quotes in
`tests/test_large_restart.py`).

The measured commit cost (about 30% of a step) is therefore the one durable
`COMMIT` with `synchronous = FULL` plus lock acquisition, not two durable
writes.

### 13.2 Pagination: what the API actually supports

The public API is **offset/limit only**:
- List endpoints (`/api/replay/events`, `/api/quotes`,
  `/api/rejected-inputs`, `/api/proposals`, `/api/risk-decisions`,
  `/api/orders`, `/api/fills`, `/api/ledger`, `/api/run-events`) accept
  `limit` (1–5000, default 500) and `offset` (≥ 0, default 0).
- They return a JSON array in a fixed ascending order, with headers
  `X-Total-Count`, `X-Limit`, and `X-Offset`. An offset past the end returns
  `[]`.
- `/api/runs` takes only `limit` (the most recent runs). There are no cursor
  tokens.

"Keyset" describes only how two endpoints are **implemented** internally.
Replay events and run events are numbered 1..N without gaps (replay events
are enforced by a trigger; run events by `append_run_event`). So `offset=k,
limit=n` is served as the key range `k < position ≤ k + n`, which returns
exactly the rows SQL `OFFSET k LIMIT n` would. Their totals are read from
the cursor/checkpoint in O(1). Verified: `/api/run-events?limit=3&offset=2`
returns sequences 3, 4, 5.

The other endpoints use SQL `LIMIT/OFFSET`, which is O(offset + limit), and
`COUNT(*)` for the total. That cost is paid once per API read, never per
replay event. The dashboard always requests only the latest 50 rows.

---

## 14. Remaining decisions (owner)

1. **Account and budget:** create the account and key (§9) and run the
   metadata-only estimate. Then approve or decline a budget. **No spending is
   authorized until then.**
2. **Underlying feed:** `EQUS.SIP` if U6 confirms an NBBO for SPY on the
   date; otherwise choose `EQUS.MINI` (vendor consolidation) or
   `ARCX.PILLAR` (primary venue, not an NBBO).
3. **Liveness evidence** for "unchanged valid" quotes (U1–U3). Until the
   vendor confirms it, keep the conservative rule (§5.4 rule 4), or approve
   the `cmbp-1` fallback at its estimated cost.
4. **Opening reference `opening_reference_v1`** as specified (window
   09:30:01–09:31:00 ET, first valid two-sided snapshot observed at or after
   09:30:00, refuse the day if none). Approve or amend.
5. **Universe parameters:** the outer band ±5% and the emission band
   −1%/+2% (sticky). Approve or amend.
6. **Empty option bid** (U4): treat it as missing (recommended), not as
   $0.00.
7. **New intake reason `UNSUPPORTED_PRECISION`** and the engine changes
   E1–E7 (SPEC amendment, migration 0005).
8. **Diagnostic date(s):** 2025-06-02, with 2025-07-03 optional (early
   close).
9. **License confirmation (U10):** whether raw files may be kept locally,
   and for how long.
