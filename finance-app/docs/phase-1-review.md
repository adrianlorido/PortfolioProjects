# Phase 1 technical review

Scope: the financial model and synchronization foundation of Phase 1 (commit `659931e`).
No Phase 2 features were added. Fixes are in a separate review commit on the same branch.

**Verdict: READY FOR PHASE 2**, subject to the Phase 2 preconditions at the end of this document.

## Method

1. Read the code, not the earlier report.
2. Probe suspected defects with throwaway tests before fixing anything (evidence first).
3. Fix with the smallest provider-neutral change; add regression tests.
4. Mutation-check: inject accounting bugs and confirm tests fail.
5. Re-run database verification against PostgreSQL 16.

## Issues found

| # | Severity | Issue (evidence) | Consequence | Fix |
|---|---|---|---|---|
| 1 | High | Provider data was not validated at runtime. Probe: sync stored `amount = NaN`, `amount = 12.5` (fractional cent) and `date = "2026-02-31"` without error. | Corrupt money persisted; later every report touching it throws (or an invalid date silently falls outside all periods). | `modules/sync/normalized-schemas.ts` (Zod) validates every account/transaction/removal/balance; sync is now fetch-all → validate-all → write → advance cursor. Nothing is written if any record is invalid. |
| 2 | High | A single $500 loan payment could not be reported as $420 principal + $80 interest. | Either $0 or $500 of spending (both wrong) whenever the lender doesn't post interest separately. | `TransactionSplit` in the domain; split-aware reporting (`reportLinesFor`); `validateSplits`; repository `setTransactionSplits`; `transaction_splits` table with composite FKs, RLS and a deferred "sums exactly" trigger. |
| 3 | High | Postgres `bigint` → JS `number` conversion was implicit. `bigint` allows 2^63−1; PostgREST/supabase-js deliver `int8` as JSON numbers, which `JSON.parse` rounds above 2^53. | A large stored amount would be silently rounded when read in Phase 2. | CHECK constraints limit every `*_minor` column to ±(2^53−1); `db/money-codec.ts` is the single, validating DB → `Money` conversion (strings/bigint/safe numbers only). |
| 4 | Medium | Pending → posted lost user edits and allowed both rows to coexist until the provider's removal arrived (probe: note lost; both rows present). | User annotations silently discarded; `includePending: true` reports double counted during the window. | Provider-neutral `pendingExternalTransactionId`: the posted row inherits the pending row's user fields and the pending row is deleted in the same step. |
| 5 | Medium | An account's currency could change on re-sync (probe: USD → EUR accepted). | Stored transactions/snapshots silently re-denominated. | Sync rejects currency changes on existing accounts. |
| 6 | Medium | In the import path, card/loan payments and transfers were classified only by description-text rules. | An unrecognised description made both payment legs "uncategorized" (distorting category and cross-month reports). | Provider-neutral `categoryHint` (slug of our taxonomy; adapter maps provider categories). Precedence: user edit > user rule > hint > none. Sample transfers/payments now classified by hint, not text. Transfer *pairing* remains a documented limitation. |
| 7 | Medium | Sync wrote page by page. | An invalid record on page N left pages 1..N−1 applied. | Same fix as #1 (validate before writing). DB repositories must also wrap the write phase in a transaction (Phase 2 precondition). |
| 8 | Low | `ratioInBasisPoints` could return an unsafe number (probe: 9e19). | Lossy ratio for absurd inputs. | Throws instead. |
| 9 | Low | Sample interest/market maths used `Math.round(a * n / d)` in floating point. | Correct at sample magnitudes, but the pattern is demonstrably off by a cent at large magnitudes (pinned counterexample). | `multiplyByFraction` (BigInt product, one rounding); used by the sample generator. |
| 10 | Low | The dashboard page computed month-over-month deltas and the "other categories" total itself. | UI duplicating domain arithmetic. | Moved into `modules/dashboard`; an architecture test forbids money arithmetic in `app/` and `components/`. |
| 11 | Low | `app/layout.tsx` imported the sample integration directly. | UI coupled to a provider adapter. | Data-source info exposed via `db/getDataSourceInfo()`; architecture test enforces that only the sample bootstrap imports the sample adapter. |
| 12 | Low | Test weaknesses: some "after" balances were hand-typed; a test named "payments exactly pay off the previous month" only checked leg pairing; one test re-asserted the implementation's own formula; one asserted only `spending > 0`. | Tests could pass despite a sign/ledger bug. | Balances now derived from transactions via `applyPostedTransactions`; the payment test checks amounts; net worth is cross-checked with an independent formula (Σ signed balances); exclusion checked by an exact delta; new ledger-integrity test across all sample snapshots. |

Probes that found **no** defect: `toDecimalString` is exact at ±(2^53−1); the finance engine
imports only domain types; no network code exists anywhere; the original test suite already
caught ten simple logic mutants (see below).

## Mutation check

Each mutant was injected alone and the full suite run; every mutant was killed.

| Injected bug | Failing tests |
|---|---|
| transfers counted as spending | 6 |
| pending counted by default | 3 |
| exclusion ignored | 5 |
| refunds not netted | 8 |
| splits ignored in reports | 1 |
| liability sign flipped | 18 |
| accounts classified by balance sign | 1 |
| history ignores snapshot dates | 4 |
| currency guard removed | 5 |
| re-sync overwrites user fields | 4 |
| pending row not deleted on replacement | 1 |
| provider validation skipped | 10 |
| `add()` without overflow check | 2 |
| repository lets another user edit | 1 |

## Finance invariants now guaranteed (each backed by tests)

1. Money is an integer number of minor units within ±(2^53−1); every operation throws rather
   than overflow, round, or accept a fraction. Same bound enforced in Postgres.
2. For ledger accounts, balance change = Σ posted transaction amounts (sign convention as
   arithmetic); verified across every snapshot interval of the sample data.
3. Net worth = Σ asset balances − owed liabilities = Σ signed balances, classified by account type.
4. With all counterparts tracked, Δ net worth = income − spending for every modelled event.
5. Transfer-kind lines are never income or spending; card and loan payments never double count.
6. Excluded transactions never affect cash flow; pending transactions don't unless opted in.
7. Split lines always sum exactly to the transaction amount (app and database).
8. Spending by category always sums to total spending.
9. A calculation never adds different currencies.
10. Net-worth history depends only on snapshots dated on or before each date.
11. Re-syncing never changes user-owned fields; replays converge to the same state; invalid
    provider data writes nothing; posted transactions replace linked pending ones atomically.
12. Users can read and change only their own rows; provider-owned fields and identifiers are
    immutable from user sessions; provider credentials are service-role only.

## Repository placement (area O)

The app lives in `finance-app/` inside `adrianlorido/PortfolioProjects`, which is a **public**
SQL/Tableau portfolio repository.

| Concern | Impact |
|---|---|
| Deployment | Works (Vercel "Root Directory" = `finance-app`), but every push to the portfolio triggers a deploy unless an ignored-build-step is configured, and each build clones the 21 MB `CovidDeaths.xlsx`. |
| CI | Workflows live in the shared root `.github/`, need `working-directory` and path filters, and download the whole repo per run. |
| History | Finance history interleaves with unrelated portfolio commits; the repo name is misleading. Splitting later is easy now (`git filter-repo --subdirectory-filter finance-app` preserves history), harder once both evolve. |
| Permissions / secrets | GitHub secrets, environments, branch protection, CODEOWNERS, Dependabot and app installations are per-repository. Phase 2 adds Plaid/Supabase secrets; in a **public** repo they'd sit alongside a portfolio anyone can fork, and access can't be scoped to the app. The app's source and security design are already public. |
| Maintainability | Mixed issues/PRs, mixed licensing, tooling config pointed at a subdirectory. |

**Recommendation:** move the app to its own **private** repository before Phase 2 adds any
secrets, CI or a Vercel project, using `git filter-repo --subdirectory-filter finance-app` to
keep history. Not done in this review, as instructed.

## Phase 2 preconditions

These are conditions on Phase 2 work, not open Phase 1 defects:

1. The Supabase repository must read money only through `db/money-codec.ts` and run each sync's
   write phase inside a single database transaction.
2. Credentials go through one server-only, service-role module that filters by `user_id`
   explicitly (see ARCHITECTURE.md).
3. The Plaid adapter must map `pending_transaction_id` → `pendingExternalTransactionId` and
   `personal_finance_category` → `categoryHint`, and be run through the same lifecycle
   scenarios as `modules/sync/lifecycle.test.ts` (idempotent replay, modify, remove,
   pending → posted, invalid input).
4. Decide on the repository split first (recommendation above).
