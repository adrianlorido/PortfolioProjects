# Step 6 validation: sample paper-trading engine

Scope: **simulator correctness**, not strategy profitability. Branch
`paper-trading-step6`, based on `paper-trading-step5` at `601cc1d`.

**How to reproduce:** from `paper-trading/`, run
`python -m pytest tests/test_step6_stress.py` (Step 6) or `python -m pytest`
(full suite: 324 passed).

## Method

- **E2E vs pure.** Tests marked **E2E** run a fresh trading run through the
  real replay → intake → broker → accounting path, each with its own synthetic
  fixture. **Pure** tests call strategy or risk functions directly. The
  original worked-example fixture is never modified.
- **Independent books check.** `tests/trading_helpers.py::assert_books`
  recomputes everything from raw tables, without calling `reconcile`, which is
  code under test. `CheckedRun` runs it after **every event** of every Step 6
  scenario. It checks:
  - cash = sum of ledger deltas = start + fill cash flows;
  - available = cash − reservations, and ≥ 0;
  - cash and contract reservations exactly match open orders, and terminal
    orders hold none;
  - position quantity (buys − sells, never negative) and cost basis match the
    fills;
  - mark = latest bid × 100 × qty;
  - fees and realized P&L match the fills;
  - equity = start + realized + unrealized = cash + market value, when
    valuation exists.
- **Mutation check of this suite.** Ten realistic engine bugs were injected
  one at a time; all ten were caught. Every file was restored afterward (see
  the last section).
- **Concurrency.** Real threads, each with its own SQLite connection, start
  together at a barrier. The concurrency tests passed 15 out of 15 repeated
  runs.

`S6` = `tests/test_step6_stress.py`, `T` = `tests/test_trading.py`,
`R` = `tests/test_step5_review.py`, `ST` = `tests/test_strategy.py`,
`RS` = `tests/test_restart.py`.

## Scenario matrix

| # | Scenario | Expected | Actual (verified) | Test reference | Remaining limitation |
|---|---|---|---|---|---|
| 1a | Price gap through the loss threshold ($3.90 → $3.00; threshold $3.60) | LOSS_THRESHOLD intent; sell limit = current bid $3.00; no fill below the limit; after the TTL, EXIT_RETRY at the new bid; fill at an eligible bid, not at $3.60 | As expected: filled at $2.90 after a retry; realized −$111.30; orders FILLED / EXPIRED (TTL) / FILLED | E2E `S6::test_gap_through_loss_threshold_fills_at_eligible_bid_not_a_stop_price`; pure `ST::test_price_exit_boundaries` | — |
| 1b | Gap to a $0 bid | Intent recorded, no zero-limit sell; proposal on the next positive bid | As expected: LOSS_THRESHOLD proposal at $2.50 | E2E `S6::test_gap_to_zero_bid_waits_for_positive_bid` | — |
| 2a | Buy limit never reached | Unfilled, EXPIRED at submitted + 60 s, cash reservation released, cash unchanged | As expected: expiry effective 14:01:00, reserved $0, available $100,000 | E2E `S6::test_buy_outside_limit_expires_and_releases_cash`; also `T::test_buy_limit_enforced`, `T::test_quote_at_exact_expiry_cannot_fill`, `T::test_fixture_time_jump_expires_before_quote` | — |
| 2b | Sell limit never reached | Unfilled, EXPIRED, contracts released, intent kept, no retry on an invalid quote | As expected; expiry also runs on a rejected-input event | E2E `S6::test_sell_outside_limit_expires_releases_contracts_keeps_intent`; also `T::test_sell_limit_enforced` | — |
| 3a | Stale, missing, invalid, crossed, duplicate, out-of-order, or future quotes | Rejected at intake; never fill; do not move market state | As expected | E2E `T::test_invalid_quotes_never_fill`; Step 4 `test_replay.py`, `test_intake.py` | Checks that need an order's context (predates submission) are enforced by `fill_price` and a DB trigger (`T::test_no_fill_from_the_generating_quote`) |
| 3b | Insufficient displayed size (buy and sell) | No fill until the full size is displayed; capacity is never reused | As expected: 0 size / missing size → no fill; size 1 → fill | E2E `S6::test_sell_needs_full_displayed_bid_size`, `T::test_insufficient_displayed_size`; unit `T::test_displayed_capacity_is_not_reused`; DB trigger | One contract per order in the MVP, so capacity reuse is only exercised directly on `fill_price` |
| 3c | Valuation freshness | Mark CURRENT at ≤ 2 s old, STALE at 3 s; STALE keeps its value; a new quote makes it CURRENT again | As expected at the exact 2 s / 3 s boundary | E2E `S6::test_mark_freshness_boundary_end_to_end`; `R::test_marks_and_stale_relabel_do_not_bump_revision` | — |
| 4a | Concurrent steps, distinct keys, 9 connections | Each of the 6 events is processed exactly once; the rest are refused as exhausted | As expected: positions 1–6 once, 3× ReplayExhausted, final cash $100,078.70 | E2E `S6::test_concurrent_steps_with_distinct_keys_process_each_event_once` | Serialization relies on SQLite's single-writer lock (5 s busy timeout) |
| 4b | Concurrent retries of one key, 8 connections | Executed once; all callers get the same result | As expected: 1 execution, 7 idempotent replays | E2E `S6::test_concurrent_retries_of_one_key_execute_once` | — |
| 4c | Concurrent manual closes, 6 connections | One closing order, one intent, no overselling | As expected | E2E `S6::test_concurrent_manual_closes_create_one_closing_order` | — |
| 4d | Cancel racing a fill | Exactly one consistent outcome | As expected (either canceled with no fill, or filled with the cancel refused) | E2E `S6::test_cancel_races_fill_with_one_consistent_outcome` | Which side wins is scheduler-dependent; both outcomes are asserted |
| 4e | Concurrent replay-to-end and steps | Same final state as sequential | As expected | E2E `S6::test_concurrent_run_to_end_and_steps_match_sequential_result` | — |
| 4f | Duplicate or conflicting commands | Same key + payload → stored result; different payload → conflict; duplicate submit/fill refused | As expected | `T::test_conflicting_idempotency_keys`, `T::test_duplicate_submission_and_fill_are_refused` | — |
| 5a | Restart with pending entry, open position, or pending exit | Cash, reservations, orders, TTL, intent, cursor, and clock identical after restart; completes to $100,078.70 | As expected for all three states | E2E `S6::test_restart_recovers_every_open_state` (parametrized) | The restart is simulated by a fresh connection; real process restarts are covered by `RS::test_trading_demo_across_process_restarts` |
| 5b | Restart, then TTL elapses | Pending entry expires by TTL on the next event | As expected | E2E `S6::test_restart_with_pending_entry_expires_it_by_ttl`; `T::test_exit_order_expiry_retries_and_survives_restart` | — |
| 6a | Failure before commit (mid-event, mid-command) | Nothing persisted; retry with the same key succeeds once | As expected | E2E `T::test_failure_mid_event_rolls_back_everything`, `S6::test_manual_close_failure_before_commit_leaves_nothing` | — |
| 6b | Failure after commit, before the response (HTTP) | Client sees 500; retry with the same key returns the stored result; no double fill | As expected | E2E `S6::test_failure_after_commit_before_http_response_is_safe_to_retry`; `T::test_restart_does_not_double_execute` | See F2: dashboard fix verified in a browser, not in pytest |
| 6c | Replay-to-end interrupted mid-run | Completed events kept; retry with the same key resumes; no duplicates | As expected: 3 committed, 3 resumed, then idempotent | E2E `S6::test_replay_to_end_interrupted_mid_run_resumes_without_duplicates` | — |
| 7 | Closing order canceled or expired | Intent persists; retry on the next valid quote with EXIT_RETRY at the current bid; original reason recorded | As expected | E2E `T::test_cancel_exit_keeps_intent_and_retries`, `T::test_exit_order_expiry_retries_and_survives_restart`, `S6` 1a | — |
| 8 | Session end with open exposure | Open orders expired (SESSION_END), reservations released, run INCOMPLETE, position STALE at its last bid, no closed trade, intent unresolved | As expected, with a closing order still OPEN at the close | E2E `S6::test_session_end_with_open_closing_order`, `T::test_session_end_with_open_exposure_is_incomplete`, `T::test_session_end_expires_open_orders` | — |
| 9 | Multiple qualifying contracts | Among in-scope contracts with 30–45 days to expiration and strike ≥ underlying: **earliest expiration, then lowest strike, then contract ID** (rule 6). Only quotes already replayed are used; no substitution when the selected contract has no current quote; out-of-window expiries skipped | As expected. An earlier expiration with a higher strike beats a later expiration with a lower strike (see the interpretation note below) | E2E `S6::test_multi_contract_selection_*` (3 tests), `S6::test_earlier_expiration_with_higher_strike_is_selected_end_to_end`; pure `ST::test_earlier_expiration_beats_lower_strike`, `ST::test_strike_selection_and_tie_breaks`, `ST::test_expiration_window`, `ST::test_expiration_uses_new_york_date_not_utc` | Rules 5–6 interpretation needs owner confirmation (SPEC.md §13.20). The contract ID tie-break cannot be reached, because economic identity is unique; it is covered only by the code path |
| 10 | Determinism | Identical event ordering and economics across databases and between step-by-step vs replay-to-end | As expected for the worked example and two stress fixtures | E2E `S6::test_identical_inputs_identical_results` (×2), `T::test_deterministic_trading_replay`, Step 4 `test_replay.py` | Record IDs and wall-clock audit timestamps differ by design |
| 11 | Failed reconciliation | Every trading mutation blocked; pause and reads allowed | As expected | `R::*` (15 tests), `S6::test_pause_is_safe_on_unreconciled_running_run`, `S6::test_f1_*` | Replay-only runs have no trading books and are not guarded |

### Interpretation note: entry rules 5 and 6 (needs owner confirmation)

The Step 6 report first described the selection as "strike, then expiry". That
was a **wording error in the report**; the code was not changed.

**What the code does.** `select_entry_contract` keeps contracts that are in
scope, 30–45 days to expiration, and have strike ≥ underlying. It then picks
the minimum by **(expiration, strike, contract ID)**, which is rule 6's
ordering. Example with SPY at $600.00:
- A: Oct 30, $605 strike
- B: Nov 6, $600 strike

The code selects **A**. Expiration is the primary key; rule 5's "lowest strike"
applies within the chosen expiration.

**The alternative.** A literal global reading of rule 5 ("the lowest eligible
strike at or above the underlying", across all expirations) would select **B**,
leaving only rule 6's expiration and ID keys to break ties among $600 strikes.

This choice is recorded in SPEC.md §13.20 and pinned by tests, so any change is
deliberate. Neither the worked example nor the bundled fixture is affected: it
has one contract.

**Reconciliation mark check (F1).** It compares a position with the latest
accepted quote **for that position's own contract**: the query filters on
`run_id` and `contract_id`. A newer quote for a different contract does not
flag the position, and a mark that points at another contract's quote is
rejected. Tested by `S6::test_mark_check_uses_the_positions_own_contract`; the
test fails if the contract filter is removed.

## Findings and fixes

| ID | Finding | Impact | Fix | Regression test |
|---|---|---|---|---|
| **F1** | `reconcile` accepted an inflated position valuation. With market value set to $9,000 (and unrealized P&L consistent with it) it reported PASS while the account showed **$108,599.35 equity instead of $99,989.35**. The equity identity cannot detect a wrong mark. | Corrupt valuation could pass as reconciled, and trading was not blocked | Reconciliation now requires an open position's value to equal its mark bid × multiplier × qty, and the mark to be the contract's latest accepted quote (`accounting/ledger.py::_mark_discrepancies`) | `S6::test_f1_inflated_valuation_fails_reconciliation_and_blocks_trading`, `S6::test_f1_mark_must_be_latest_accepted_quote` (both fail without the fix) |
| **F2** | The dashboard reused the idempotency key only when the network request failed. After a 5xx following a committed command, the user's re-click sent a **new** key, so a step advanced one event more than intended. No event was executed twice. | One click could do two steps | On a 5xx the dashboard retries with the **same** key and gets the stored result (`web/static/dashboard.js`) | Browser check (Playwright, not in pytest): first response replaced by a 500 after commit → 2 attempts, same key, progress advanced exactly 1 event |
| **F3** | With several contracts, "Latest accepted quote" and the watchlist underlying showed the alphabetically first contract's quote, which can be older than another contract's newer quote | Misleading market display | Latest quotes are ordered most-recent first (`app/queries.py::latest_market_state`) | `S6::test_f3_latest_quote_is_most_recent_across_contracts` (fails without the fix) |

No approved trading or accounting rule was changed, and no assertion was
weakened.

## Mutation check of the Step 6 suite

Each bug was injected on its own, `tests/test_step6_stress.py` was run, and the
file was restored. All ten were caught:

1. Marking at the ask
2. Not releasing contracts on expiry or cancel
3. Retry limit not equal to the current bid
4. Substituting another contract when the selected one has no quote
5. Staleness boundary `>=`
6. Missing idempotency check
7. Deferred (`BEGIN`) instead of `BEGIN IMMEDIATE` transactions
8. Wrong exit fee
9. No session-end expiry
10. Ignoring the displayed bid size

After the run, `git status` showed no changes under `paper_trading/`.

## Verified vs assumed vs deferred

- **Verified by automated tests:** every row above marked with a test
  reference. The full suite has 321 tests.
- **Verified manually:** F2 dashboard retry in headless Chromium; dashboard
  rendering from Step 5.
- **Assumed:**
  - SQLite's write lock and 5 s busy timeout are enough for one local user.
    Longer contention would surface as a `database is locked` error, and
    nothing is committed in that case.
  - Commands issued **without** an idempotency key (CLI without `--key`) are
    new commands by design. Repeating `step` without a key advances the next
    event. It never re-executes one, and duplicate close/cancel/start requests
    are refused by state.
- **Deferred / not supported (unchanged scope):**
  - live data, brokers, AI;
  - partial fills, multi-contract orders, exercise, assignment,
    option-expiration handling;
  - quote capacity shared by several simultaneous orders (at most one order
    per run exists);
  - process crash *during* an SQLite write, which relies on SQLite's
    atomic-commit guarantee rather than being tested here.
