# Plaid adapter (not implemented — Phase 2+)

This directory is reserved for the Plaid implementation of `FinancialDataProvider`
(`src/integrations/provider.ts`). Nothing here is wired up in Phase 1.

Rules for the future adapter:

- **Server-only.** Start every file with `import "server-only"`. Plaid client id/secret come
  from server env vars (never `NEXT_PUBLIC_*`); access tokens are stored in the
  `connection_credentials` table, which has RLS enabled with **no** client policies, so only
  the service role can read it. The browser only ever sees Plaid Link's `link_token` /
  `public_token`, which are exchanged server-side.
- **Normalize at the edge.** Map Plaid → domain before returning:
  - `amount`: Plaid uses positive = money leaving the account → **negate**.
  - Balances: Plaid reports credit/loan `current` as amount owed (positive) → **negate** for
    liability types.
  - Amounts → integer minor units via `parseMoney(value.toFixed(2))`-style string conversion,
    never `Math.round(x * 100)` on arbitrary floats without review.
  - `type`/`subtype` → our `AccountType` (`depository/checking` → `checking`, `credit` →
    `credit`, `loan/*` → `loan`, `investment/*` → `investment`, …).
  - `merchant_name ?? name` → `merchantName`; `original_description ?? name` →
    `originalDescription`.
- **Idempotent sync.** Use `/transactions/sync` with the stored cursor and feed pages into
  `syncConnection()` (`src/modules/sync/ingest.ts`), which upserts on
  `(account_id, external_transaction_id)` and never overwrites user edits.
- Core modules must not import anything from this directory.
