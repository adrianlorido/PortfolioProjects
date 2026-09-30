# Architecture (Phase 1)

A **modular monolith**: one Next.js application, one deployable, one (future) Postgres database.
Modules are separated by folder and by import direction, not by network boundaries.

```
src/
  app/                      Next.js App Router: pages, server actions, layouts (UI only)
  components/               Presentational React components (ui/, layout/, charts/)
  domain/models.ts          Internal domain model — the app's source of truth for data shapes
  modules/
    finance/                Deterministic finance engine: money, periods, net worth, cash flow,
                            splits, ledger
    categories/             Default taxonomy + categorization rule engine
    accounts/               Account grouping / display helpers
    transactions/           Filters, validation schemas (Zod), edit service, pagination
    sync/                   Idempotent provider → domain ingestion + runtime validation of provider data
    analytics/              Finance query API (UI today, AI-assistant tools later)
    dashboard/              Dashboard view-model assembly
  integrations/
    provider.ts             FinancialDataProvider contract + normalized types
    sample/                 Offline deterministic sample provider & dataset
    plaid/                  Placeholder (README only) — not implemented
  db/
    repository.ts           Repository interfaces (user-scoped)
    in-memory-repository.ts Sample-mode/test implementation
    money-codec.ts          The only DB value → Money conversion (bigint-safe)
    sample-bootstrap.ts     Seeds taxonomy + rules and syncs the sample provider
    index.ts                getRepository() — server-only entry point
  lib/                      env (server-only), auth/session (server-only), errors, utils
supabase/
  migrations/               Postgres schema: constraints, RLS, column privileges
  tests/                    Schema assertions + local Supabase-auth shim
```

## Dependency direction

```
app/ ──► modules/analytics ──► modules/finance (pure)
  │            │
  │            └──► db/repository (interface)
  └──► modules/transactions/service ──► db/repository
modules/sync ──► integrations/provider (interface) + db/repository
db/sample-bootstrap ──► integrations/sample, modules/sync
```

- `modules/finance` imports nothing but `domain/models`. It has no I/O, no clock, no randomness.
- Nothing outside `integrations/*` knows provider field names. Adapters return normalized
  domain-shaped data (`NormalizedAccount`, `NormalizedTransaction`, …).
- UI components never compute money; they format results from the analytics layer.

## Frontend

Next.js 16 App Router, React 19, TypeScript (strict, `noUncheckedIndexedAccess`), Tailwind CSS v4
with CSS-variable design tokens (light + dark), small shadcn-style primitives written in-repo
(`components/ui`), Recharts for charts, lucide icons. Pages are **server components**; only
interactive pieces (nav highlighting, month picker, charts, the transaction edit dialog) are
client components. Filters are plain `GET` forms, so they work without JavaScript.

## Server boundary

- All data access goes through `getRepository()` (`import "server-only"`), called from server
  components and server actions.
- The **only mutation** in Phase 1 is `updateTransactionAction` (a server action). It reads
  whitelisted form fields, gets the user from the server session, and validates with a
  `.strict()` Zod schema that allows only `categoryId`, `notes`, `excludedFromReports`.
- Environment is parsed with Zod in `lib/env.ts` (server-only). Nothing secret is prefixed
  `NEXT_PUBLIC_`.
- Security headers (`X-Frame-Options`, `nosniff`, referrer and permissions policies) are set in
  `next.config.ts`. The error boundary never renders server error details.

## Database

`supabase/migrations/20260930000000_initial_schema.sql` defines the Postgres schema:

| Table | Purpose / key constraints |
|---|---|
| `profiles` | 1:1 with `auth.users` |
| `financial_connections` | One per (user, provider, provider_connection_id); holds sync cursor, **no secrets** |
| `connection_credentials` | Provider access tokens; RLS on with **no policies** + all client grants revoked → service role only |
| `accounts` | Type CHECK (8 types), `current_balance_minor bigint`, unique (connection_id, external_account_id) |
| `category_groups`, `categories` | `kind` CHECK (income/expense/transfer), unique (user_id, slug) |
| `category_rules` | Pattern rules → category |
| `transactions` | `amount_minor bigint`, unique (account_id, external_transaction_id) = import idempotency key; immutability trigger on user/account/external id |
| `transaction_splits` | Per-line category allocation; composite FKs to the same user's transaction/category; deferred trigger enforces "≥ 2 lines summing exactly to the amount" |
| `balance_snapshots` | unique (account_id, date); source of net-worth history |

All `*_minor` columns are CHECK-limited to ±(2^53−1) (migration `20261001000000_review_fixes.sql`)
so no stored amount can exceed what a JavaScript number represents exactly. Reads must go through
`src/db/money-codec.ts` (see [finance-rules.md](./finance-rules.md#money-representation)).

Every user-owned table has `user_id` and RLS (`user_id = auth.uid()`). Children reference parents
through **composite `(id, user_id)` foreign keys**, so a transaction can't point at another user's
account or category even if application code is wrong. Clients may read their data but can only
`UPDATE` the four user-editable transaction columns (column-level `GRANT`); provider-synced
tables are written by the service role only.

`npm run db:verify` applies all migrations to a throwaway local Postgres (with a tiny auth shim)
and runs every suite in `supabase/tests/` (constraints, idempotency keys, immutability,
cross-user RLS isolation, column privileges, split balancing, credential access). Phase 1 does **not** read from Postgres at runtime; see "Deviations" below.

## Authentication

`lib/auth/session.ts#requireUser()` is the single authorization boundary. In sample mode it
returns the fixed demo user. Every repository call is scoped by that server-derived `userId`
(never by request input), mirroring the RLS policies. Phase 2 swaps the implementation for a
Supabase Auth session (`@supabase/ssr` cookies) without changing callers.

## Finance domain layer

See [finance-rules.md](./finance-rules.md). Money is integer minor units; the sign convention is
"positive = net worth goes up". Net worth comes from balances + account-type classification;
cash flow comes from category *kinds* with explicit rules for transfers, card/loan payments,
refunds, pending and excluded transactions.

## Sample-data system

`integrations/sample/dataset.ts` generates six months (Apr–Sep 2026, as of 2026‑09‑28) of
fictional data for 5 accounts at 4 fictional institutions using a seeded PRNG — byte-identical
on every run. `SampleFinancialDataProvider` implements the real provider contract (cursor-paged
sync), and `db/sample-bootstrap.ts` pushes it through the **same ingestion pipeline** a real
provider would use. Merchant spending is categorised by ordinary `CategoryRule`s; income,
transfers, card/loan payments and interest carry provider `categoryHint`s, exactly as a real
adapter would supply them. A banner reading
"SAMPLE DATA — NOT REAL FINANCIAL INFORMATION" is rendered on every page in sample mode.

## Provider credentials (once Supabase is live)

`connection_credentials` has RLS enabled with **no policies** and every privilege revoked from
`anon` and `authenticated`, so no browser or user-session query can read or write it (tested).
Only the `service_role` can. Access will be confined to one server-only module, e.g.
`src/integrations/credentials.ts` (`import "server-only"`), which:

- creates a Supabase client with `SUPABASE_SERVICE_ROLE_KEY` (server env, never `NEXT_PUBLIC_*`),
  used for nothing else;
- stores tokens encrypted (Supabase Vault / pgsodium, or AES-GCM with a key from server env) and
  decrypts only inside the sync job;
- is called only by sync jobs and the token-exchange route, always passing the connection id
  *and* the session user id and checking they match before decrypting;
- never returns tokens to callers outside `integrations/` and never logs them.

Because the service role bypasses RLS, every service-role query must filter by `user_id`
explicitly; user-facing reads keep using the user's own (RLS-bound) client.

## Sync pipeline

`syncConnection()` fetches every page first, validates every record with Zod
(`modules/sync/normalized-schemas.ts`), then writes, then advances the cursor. An invalid record
aborts the sync before any write. A database-backed repository must run the write phase in a
single database transaction (e.g. a Postgres function called via RPC) so a crash mid-write can't
leave a partial sync with an advanced cursor.

## Future Plaid boundary

`FinancialDataProvider` (`integrations/provider.ts`) defines `connectInstitution`,
`getAccounts`, `syncTransactions(cursor)` and `getBalances`, all taking a
`ProviderConnectionRef` (never a token). A Plaid adapter will live in `integrations/plaid/`,
be server-only, fetch tokens from `connection_credentials` via the service role, and normalize
Plaid's sign conventions at the edge (see `integrations/plaid/README.md`). `modules/sync/ingest.ts`
already handles added/modified/removed pages idempotently and preserves user edits.

## Future AI boundary

`modules/analytics/finance-queries.ts` exposes deterministic, JSON-serialisable functions:
`getAccounts`, `getTransactions(filters)`, `getCashFlow(period)`, `getMonthlyCashFlow(months)`,
`getSpendingByCategory(period)`, `getNetWorth()`, `getNetWorthHistory(period)`. A future
assistant would call these as tools, scoped to the session user; it may explain results but must
never compute balances or totals itself.

## Testing strategy

- **Vitest unit tests** for everything with financial meaning: money arithmetic and safe-integer
  boundaries, periods, net worth and history, cash-flow rules, the sign-convention table and
  accounting scenarios (with balances derived from transactions, not hand-typed), splits,
  category rules, sample-data invariants (including ledger integrity), sync idempotency, field
  ownership, the pending → posted lifecycle, provider-input validation, edit authorization,
  analytics and dashboard assembly.
- **Architecture tests** (`src/architecture.test.ts`) enforce import boundaries: pure finance
  engine, no provider/network imports in core modules, no money arithmetic in UI code.
- **Isolation tests** block all outbound network APIs while the sample pipeline runs.
- **Mutation checks** (manual, during review): deliberately broken accounting rules were each
  caught by at least one test.
- **Schema tests** in SQL against real Postgres (`npm run db:verify`).
- **Manual/browser checks** of the running app (Phase 1 has no automated E2E suite).

## Deviations & decisions for review

1. **App lives in `finance-app/`**, because the repository root is an unrelated SQL/Tableau
   portfolio. Existing files are untouched.
2. **No runtime Postgres in Phase 1.** The schema is written and verified, but the app reads the
   in-memory sample repository. A Supabase repository needs real auth, which is Phase 2 scope.
   The repository interfaces are async and user-scoped so the swap is mechanical.
3. **shadcn/ui components are hand-written** in the same style (cva + tailwind-merge) rather than
   generated by the CLI, to keep dependencies minimal (no Radix needed yet).
4. **System font stack** instead of `next/font/google`, so builds need no network.
5. **Sample-mode edits are per-process memory** and reset on restart (not durable on serverless).
