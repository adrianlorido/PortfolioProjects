# Finance calculation rules

All rules below are implemented in `src/modules/finance/` and `src/modules/sync/` and covered by
tests. The worked scenarios are executable in
`src/modules/finance/accounting-scenarios.test.ts` and `src/modules/sync/lifecycle.test.ts`.
If a rule changes, its test must change with it.

## Money representation

- Amounts are **integers in minor units** (cents): TypeScript `Money` (a branded `number`),
  Postgres `bigint` (`*_minor` columns).
- **Safe range:** |value| ≤ `Number.MAX_SAFE_INTEGER` = 9,007,199,254,740,991 minor units =
  **$90,071,992,547,409.91**. `MAX_MONEY` / `MIN_MONEY` export the bounds.
- `Number.isSafeInteger` is enforced by `assertMoney()`, which every constructor and operation
  goes through: `money()`, `add`, `subtract`, `negate`, `abs`, `sum` (checked after every step),
  `parseMoney`, `moneyFromBigInt`, `multiplyByFraction`. Overflow **throws**; it never wraps or
  rounds. (A true sum beyond 2^53−1 always rounds to a value ≥ 2^53, which fails the check.)
- **Multiplication** (interest, market moves, future quantity × price) must use
  `multiplyByFraction(amount, numerator, denominator)`: the product is formed in BigInt, so an
  intermediate above 2^53 stays exact, and the result is rounded once, half away from zero.
  Naive `Math.round(a * n / d)` is demonstrably off by a cent at large magnitudes (a pinned
  counterexample is in `money.test.ts`). Rates are expressed as integer ratios (5.90% APR monthly
  = `590 / 120_000`). Fractional share quantities will need their own decimal type; they must not
  be squeezed into `Money`.
- **Ratios** (savings rate, category share) are integer basis points computed in BigInt; a ratio
  too large to be a safe integer throws.
- **Parsing:** decimal strings are parsed by string manipulation; more than two fractional digits
  is rejected, never rounded.
- **Display:** the exact decimal *string* is handed to `Intl.NumberFormat`; no float conversion.

### Where untrusted numbers enter, and how they are checked

| Entry point | Check |
|---|---|
| Provider adapters → sync | `normalized-schemas.ts` (Zod) validates **every** record before any write: safe-integer amounts/balances, real calendar dates, ISO currency, id/string lengths matching DB limits |
| User edits (server action) | strict Zod schema; users cannot submit amounts at all (except split lines, which must be safe integers and sum exactly to the provider amount) |
| Database → app (Phase 2) | `src/db/money-codec.ts#moneyFromDb` — accepts integer strings, `bigint`, or safe-integer numbers only |
| Database itself | `CHECK (x BETWEEN -9007199254740991 AND 9007199254740991)` on every money column |

**Why the database bound matters:** Postgres `bigint` goes to 2^63−1, but PostgREST/supabase-js
serialise `int8` as a JSON number, and `JSON.parse` silently rounds anything above 2^53.
The CHECK constraints make such values unstorable, and the codec rejects them on read.
node-postgres returns `int8` as a string, which the codec parses exactly via BigInt.
A Supabase repository should still select `amount_minor::text` so values travel as strings.

## Sign convention

**Positive = increases the user's net worth. Negative = decreases it.** The rule applies to both
transaction amounts and account balances, and is stated as arithmetic in
`finance/ledger.ts`: for ledger accounts, `balance_after = balance_before + Σ posted amounts`.
Consequently **liability balances are normally negative** (a card with $1,221.54 owed =
`-122154`); the UI shows liabilities as a positive "owed" amount (`displayBalance`, display only).
Provider adapters convert on the way in (Plaid: negate transaction amounts; negate liability
balances).

Every row below is an executable test ("sign convention (area B)").
Opening balances: checking $5,000, savings $6,000, card −$500, loan −$10,000, brokerage $20,000.

| Event | Source leg | Counterpart leg | Category kind | Income | Spending | Balance effect | Net worth |
|---|---|---|---|---|---|---|---|
| Paycheck | checking **+3,000** | — (employer, external) | income | +3,000 | — | checking +3,000 | **+3,000** |
| Grocery purchase (debit) | checking **−120** | — (merchant) | expense | — | +120 | checking −120 | **−120** |
| Credit-card purchase | card **−80** | — (merchant) | expense | — | +80 | card −80 (owed +80) | **−80** |
| Card payment from checking | checking **−500** | card **+500** | transfer (Credit Card Payment) | — | — | checking −500, card +500 | **0** |
| Checking → savings | checking **−1,000** | savings **+1,000** | transfer | — | — | −1,000 / +1,000 | **0** |
| Savings → checking | savings **−1,000** | checking **+1,000** | transfer | — | — | −1,000 / +1,000 | **0** |
| Refund | card **+40** | — (merchant) | expense (same category as purchase) | — | **−40** | card +40 | **+40** |
| Loan principal payment | checking **−420** | loan **+420** | transfer (Loan Payment) | — | — | checking −420, loan +420 | **0** |
| Loan interest | loan **−80** (lender charge) | — | expense (Interest & Fees) | — | +80 | loan −80 | **−80** |
| Investment contribution | checking **−400** | brokerage **+400** | transfer (Investment Contribution) | — | — | −400 / +400 | **0** |

**Invariant (tested for every row and for all rows combined):** when every counterpart account
is tracked and nothing is pending or excluded, **Δ net worth = income − spending**.

## Net worth

`calculateNetWorth(accounts)` → `{ assets, liabilities, netWorth }`

- Classification by **account type**: `checking, savings, cash, investment, other_asset` are
  assets; `credit, loan, other_liability` are liabilities. The balance's sign never changes the
  class (an overdrawn checking account is a negative asset).
- `assets = Σ asset balances`; `liabilities = −Σ liability balances`; `netWorth = assets − liabilities`
  (= Σ of all signed balances, cross-checked by a test).
- **Not derived from transactions**: history is partial and investments change value without
  transactions.
- **History:** `calculateNetWorthHistory(accounts, snapshots, dates)` takes **no current
  balances**. For each date and account it uses the latest `BalanceSnapshot` on or before the
  date. Explicit gap policy: before an account's first snapshot it contributes **$0** (not yet
  tracked); between snapshots the last value is **carried forward**. Snapshots for unknown
  accounts throw.
- **Currency:** a single calculation refuses mixed currencies (`MixedCurrencyError`).

## Cash flow

A single function, `classifyForReports`, decides whether a transaction (or split line) counts:

1. **Excluded** (`excludedFromReports = true`) → not counted. Balances are unaffected.
2. **Pending** → not counted by default. *Policy:* pending amounts can change or disappear and are
   re-issued when posted, so counting them risks double counting. Callers may opt in with
   `{ includePending: true }`. Account balances are the institution's posted balance.
3. **Category kind:**
   - `income` → income (sum of amounts; a negative entry such as a payroll reversal reduces income)
   - `expense` → spending (reported positive = −Σ amounts, so refunds reduce it)
   - `transfer` → **neither**
   - uncategorized → treated as `expense`, so unknown outflows are never hidden
4. **Splits:** a split transaction is reported line by line, each line classified by its own
   category. Exclusion and pending apply to the whole transaction. Lines must sum exactly to the
   amount (`validateSplits`; also a deferred constraint trigger in Postgres).

Derived: `savings = income − spending`; `savingsRate = savings / income` in basis points, `null`
when income ≤ 0. `calculateSpendingByCategory` uses the same lines, so its rows always sum to
`calculateSpending`.

### Credit-card payments

Purchases are spending **when made**, on the card account. The payment is two legs of one
transfer — checking **−$500** and card **+$500** — both categorised `Credit Card Payment`
(kind `transfer`), so neither leg is income or spending and net worth is unchanged
(checking $5,000 → $4,500, card −$500 → $0, net worth $4,500 → $4,500; spending stays exactly the
original $500).

### Loan payments: principal vs interest

A $500 payment of $420 principal + $80 interest must give: checking −$500, loan +$420,
spending $80, net worth −$80. Two representations are supported, both tested:

1. **Lender posts interest separately** (typical when the loan account is linked):
   checking −500 `Loan Payment` / loan +500 `Loan Payment` / loan −80 `Interest & Fees`.
2. **One payment, split** (typical when only the checking side is visible, or the lender
   reports net principal): checking −500 split into −420 `Loan Payment` + −80
   `Interest & Fees`; loan +420 `Loan Payment`.

Without a split, a single $500 line is either all transfer ($0 spending) or all expense ($500);
both are wrong, and the Δnet worth = income − spending invariant exposes it.

### Refunds

A refund is a positive amount in an expense category and reduces that category's spending.
Reports are **cash-basis by transaction date**: a refund in a later month reduces *that* month,
so a category — or a month's total spending — can be **negative** when refunds exceed purchases.
This is intentional (matching refunds to original purchases would need a matching engine);
across both months the totals are exact ($100 − $40 = $60).

### How transfers are identified

By **explicit category only** (kind `transfer`). The category is assigned, in precedence order:
a user edit (never overwritten) > a user's category rule (description/merchant match) > the
provider's `categoryHint` (a slug of our taxonomy, mapped inside the adapter) > none.
There is **no linked transfer pair, no provider transfer metadata beyond the hint, and no
inference**. Limitations:

- If neither leg is recognised, both are uncategorised (treated as expense). In the same period
  they still net to zero spending (the incoming leg acts like a refund), but category breakdowns
  show the noise, and legs posting in different months distort each month.
- A `transfer` category on a leg whose counterpart is *not* the user's own account (e.g. a
  payment to a friend) hides real spending. Users can re-categorise; a future matching engine
  could flag unpaired transfers.

## Sync, idempotency and ownership

### Field ownership (`TRANSACTION_FIELD_OWNERSHIP` in `domain/models.ts`, completeness tested)

| Owner | Fields | Behaviour |
|---|---|---|
| **provider** | `date`, `merchantName`, `originalDescription`, `amount`, `currency`, `pending` | Refreshed on every sync; not editable by users (DB column privileges) |
| **user** | `categoryId`, `categorySource`, `splits`, `notes`, `excludedFromReports` | Set by user (or by rule/hint at first import); **never overwritten by re-sync** |
| **system** | `id`, `userId`, `accountId`, `externalTransactionId`, `createdAt`, `updatedAt` | Immutable identity (DB trigger) + timestamps |

Two documented exceptions: (1) pending → posted carries user fields **over** to the posted row;
(2) if the provider changes the amount of a split transaction, the now-unbalanced splits are
**cleared** (reported in `SyncResult.transactions.splitsCleared`) rather than left wrong.
Rules and hints apply only at first import; a later description change never re-categorises.

### Idempotency

Natural keys: connection `(user, provider, provider id)`, account `(connection, external id)`,
transaction `(account, external id)`, snapshot `(account, date)`. Order of work per sync:
**fetch all pages → validate every record → write → advance cursor**. An invalid record aborts
the sync with nothing written and the cursor unchanged. Replaying data converges to the same
state; replaying a removal is a no-op. An account whose currency changes between syncs is rejected.

### Pending → posted lifecycle

`NormalizedTransaction.pendingExternalTransactionId` (provider-neutral) lets a posted record name
the pending record it replaces. On insert of the posted row, sync copies the pending row's user
fields (category, notes, exclusion; splits only if they still balance) and **deletes the pending
row in the same step**, so the two never coexist — regardless of whether the provider's removal
arrives in the same page, a later page, or a later sync (a late removal is a no-op).
Providers that don't link the pair send the pending id in `removed`; until it arrives both rows
exist, but default reports ignore pending, so nothing is double counted (only
`includePending: true` would see both for that window), and user edits on the pending row are lost.

## Currency

Phase 1 is single-currency per calculation. `add()` itself is currency-blind; the guard sits at
every aggregation entry point (`calculateNetWorth`, `calculateNetWorthHistory`, cash flow and
spending by category), which throw `MixedCurrencyError` rather than add $1,000 + €1,000.
Path forward, without changing stored data: (1) per-currency reporting — group accounts and
transactions by currency and run the same pure functions per group (tested); (2) an explicit FX
layer — a `convert(money, from, to, rateDate)` service with stored, dated rates and a documented
rounding rule, applied *before* aggregation and surfaced in results as "converted at …". FX is
not implemented.
