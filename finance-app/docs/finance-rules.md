# Finance calculation rules

All rules below are implemented in `src/modules/finance/` and covered by tests
(`*.test.ts` beside each file). If a rule changes, its test must change with it.

## Money representation

- Amounts are **integers in minor units** (cents), branded `Money` in TypeScript and `bigint`
  (`*_minor` columns) in Postgres.
- Integer addition is exact up to 2^53 − 1 (~$90 trillion). Every operation asserts the result
  is a safe integer, so overflow or fractional cents throw instead of silently drifting.
- Decimal strings are parsed by string manipulation (`parseMoney("12.34") → 1234`); more than two
  fractional digits is rejected, never rounded.
- Ratios (savings rate, category share) are **integer basis points** (3000 = 30.00%) computed with
  BigInt, rounding half away from zero.
- Display formatting passes the exact decimal *string* to `Intl.NumberFormat`, so no float
  conversion happens even for display.
- Why not `Decimal`/`numeric`? Integers need no dependency, serialize cleanly through React
  server components, and map 1:1 onto `bigint`. Multi-currency/fractional-cent needs (FX, crypto,
  share quantities) can add a decimal type later where needed.

## Sign convention

**Positive = increases the user's net worth. Negative = decreases it.** This applies to both
transaction amounts and account balances:

| Event | Account | Amount |
|---|---|---|
| Paycheck deposited | checking | `+315000` |
| Groceries on credit card | credit | `-8712` |
| Card payment | checking / credit | `-50000` / `+50000` |
| Refund | credit | `+3499` |
| Loan interest charged | loan | `-7653` |

Consequently **liability balances are normally negative** (card with $1,221.54 owed =
`-122154`). The UI shows liabilities as a positive "owed" amount (`displayBalance`) — display only.
Provider adapters convert on the way in (Plaid: negate transaction amounts; negate liability
balances).

## Net worth

`calculateNetWorth(accounts)` → `{ assets, liabilities, netWorth }`

- Classification by **account type**: `checking, savings, cash, investment, other_asset` are
  assets; `credit, loan, other_liability` are liabilities. Balance sign never changes the class
  (an overdrawn checking account is a negative asset).
- `assets = Σ asset balances`; `liabilities = −Σ liability balances`; `netWorth = assets − liabilities`.
- **Not derived from transactions** — transaction history is partial and investments change value
  without transactions.
- History: `calculateNetWorthHistory(accounts, snapshots, dates)` uses, per account, the latest
  `BalanceSnapshot` on or before each date; accounts without a snapshot yet contribute 0.
- Mixed currencies throw (`MixedCurrencyError`) — Phase 1 has no FX.

## Cash flow

A single function, `classifyForReports`, decides whether a transaction counts, in this order:

1. **Excluded** (`excludedFromReports = true`) → not counted. Balances are unaffected.
2. **Pending** → not counted by default. *Policy:* pending amounts can change or disappear and are
   re-issued when posted, so counting them risks double counting. Callers may opt in with
   `{ includePending: true }`. Account balances are the institution's posted balance.
3. **Category kind**:
   - `income` → income (sum of amounts; a negative entry such as a payroll reversal reduces income)
   - `expense` → spending (reported positive = −Σ amounts, so refunds reduce it)
   - `transfer` → **neither**
   - no category (uncategorized) → treated as `expense`, so unknown outflows are never hidden

| Scenario | Treatment |
|---|---|
| Checking → savings transfer | Both legs are `Transfer` (kind transfer) → no income, no spending |
| Brokerage contribution | `Investment Contribution` (transfer) → not spending |
| Credit-card purchase | Spending **when purchased**, on the card account |
| Credit-card payment | Both legs `Credit Card Payment` (transfer) → the purchase isn't counted twice |
| Loan payment | Both legs `Loan Payment` (transfer) → reduces a liability, not spending |
| Loan interest | Posted by lender as a separate charge → `Interest & Fees` (expense) |
| Refund | Positive amount in an expense category → reduces that category's spending |
| Excluded (e.g. reimbursable work trip) | Ignored by all cash-flow reports |

Derived figures:

- `savings = income − spending` (negative when overspending)
- `savingsRate = savings / income` in basis points; `null` when income ≤ 0 (undefined/meaningless)
- `calculateSpendingByCategory` uses exactly the same inclusion rules, so its rows always sum to
  `calculateSpending` (tested). A category can go net‑negative if refunds exceed purchases.
- Periods are inclusive calendar-date ranges (`YYYY-MM-DD`, no time zones); `monthPeriod("2026-09")`.

## Import idempotency

`modules/sync/ingest.ts` upserts on natural keys — connection `(user, provider, provider id)`,
account `(connection, external id)`, transaction `(account, external id)`, snapshot
`(account, date)`. Re-running a sync (with the stored cursor or a full replay) converges to the
same state. Provider-owned fields (date, amount, description, pending) are refreshed; user-owned
fields (category set by the user, notes, exclusion, hidden) are never overwritten. Category rules
apply only when a transaction is first imported.
