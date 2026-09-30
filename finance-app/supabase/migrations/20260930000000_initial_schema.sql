-- Initial schema for the personal finance app (Phase 1).
--
-- Conventions
--   * Money: bigint minor units (cents), columns suffixed _minor. Never float/numeric-in-app.
--   * Sign: positive = increases the user's net worth; negative = decreases it.
--     Liability balances are therefore normally negative.
--   * Every user-owned row carries user_id and is protected by row-level security.
--   * Child rows reference parents with composite (id, user_id) foreign keys, so a row can
--     never point at another user's account/category even if application code is buggy.
--   * Idempotency keys for provider imports are enforced with unique constraints.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------------------
create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------------------
-- Users: Supabase auth.users is the identity; profiles holds app data.
-- ---------------------------------------------------------------------------------------
create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 100),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------------------
-- Financial connections (one per institution link per provider)
-- ---------------------------------------------------------------------------------------
create table public.financial_connections (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null references auth.users (id) on delete cascade,
  provider               text not null check (provider in ('sample', 'plaid', 'manual')),
  provider_connection_id text not null check (char_length(provider_connection_id) between 1 and 255),
  institution_name       text not null check (char_length(institution_name) between 1 and 200),
  status                 text not null default 'active'
                           check (status in ('active', 'needs_reauth', 'disconnected', 'error')),
  sync_cursor            text,
  last_synced_at         timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (user_id, provider, provider_connection_id),
  unique (id, user_id)
);

-- Provider secrets (e.g. Plaid access tokens) live apart from connection metadata.
-- RLS is enabled with NO policies: anon/authenticated clients can never read or write it;
-- only the service role (server-side sync jobs) can. Consider Supabase Vault for the value.
create table public.connection_credentials (
  connection_id    uuid primary key,
  user_id          uuid not null,
  access_token_enc text not null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  foreign key (connection_id, user_id)
    references public.financial_connections (id, user_id) on delete cascade
);

-- ---------------------------------------------------------------------------------------
-- Accounts
-- ---------------------------------------------------------------------------------------
create table public.accounts (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users (id) on delete cascade,
  connection_id         uuid,
  external_account_id   text check (external_account_id is null or char_length(external_account_id) between 1 and 255),
  name                  text not null check (char_length(name) between 1 and 200),
  institution_name      text not null default '' check (char_length(institution_name) <= 200),
  type                  text not null check (type in (
                          'checking', 'savings', 'credit', 'loan', 'investment',
                          'cash', 'other_asset', 'other_liability')),
  mask                  text check (mask is null or mask ~ '^[0-9A-Za-z]{2,4}$'),
  currency              char(3) not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  current_balance_minor bigint not null,
  balance_as_of         timestamptz not null default now(),
  is_hidden             boolean not null default false,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (id, user_id),
  -- Idempotent account upserts from a provider.
  unique (connection_id, external_account_id),
  foreign key (connection_id, user_id)
    references public.financial_connections (id, user_id) on delete cascade,
  -- Provider-linked accounts must carry the provider id; manual accounts carry neither.
  check ((connection_id is null) = (external_account_id is null))
);
create index accounts_user_idx on public.accounts (user_id);

-- ---------------------------------------------------------------------------------------
-- Categories
-- ---------------------------------------------------------------------------------------
create table public.category_groups (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 100),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (user_id, name),
  unique (id, user_id)
);

create table public.categories (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  group_id   uuid not null,
  slug       text not null check (slug ~ '^[a-z0-9_]{1,64}$'),
  name       text not null check (char_length(name) between 1 and 100),
  -- Drives reporting: income counts as income, expense as spending, transfer as neither.
  kind       text not null check (kind in ('income', 'expense', 'transfer')),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (user_id, slug),
  unique (id, user_id),
  foreign key (group_id, user_id) references public.category_groups (id, user_id) on delete restrict
);

create table public.category_rules (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  category_id uuid not null,
  match_field text not null check (match_field in ('original_description', 'merchant_name')),
  match_type  text not null check (match_type in ('contains', 'equals', 'starts_with')),
  pattern     text not null check (char_length(btrim(pattern)) between 1 and 200),
  priority    integer not null default 100,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  foreign key (category_id, user_id) references public.categories (id, user_id) on delete cascade
);
create index category_rules_user_idx on public.category_rules (user_id, priority);

-- ---------------------------------------------------------------------------------------
-- Transactions
-- ---------------------------------------------------------------------------------------
create table public.transactions (
  id                      uuid primary key default gen_random_uuid(),
  user_id                 uuid not null references auth.users (id) on delete cascade,
  account_id              uuid not null,
  external_transaction_id text check (external_transaction_id is null or char_length(external_transaction_id) between 1 and 255),
  date                    date not null,
  merchant_name           text not null check (char_length(merchant_name) <= 200),
  original_description    text not null check (char_length(original_description) <= 500),
  amount_minor            bigint not null,
  currency                char(3) not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  pending                 boolean not null default false,
  category_id             uuid,
  category_source         text not null default 'none' check (category_source in ('none', 'rule', 'user')),
  notes                   text check (notes is null or char_length(notes) <= 1000),
  excluded_from_reports   boolean not null default false,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  foreign key (account_id, user_id) references public.accounts (id, user_id) on delete cascade,
  foreign key (category_id, user_id) references public.categories (id, user_id) on delete set null (category_id),
  -- Idempotent imports: a provider transaction is stored at most once per account.
  unique (account_id, external_transaction_id)
);
create index transactions_user_date_idx on public.transactions (user_id, date desc);
create index transactions_account_date_idx on public.transactions (account_id, date desc);
create index transactions_category_idx on public.transactions (user_id, category_id);

-- Provider identity and ownership are immutable once written.
create or replace function public.transactions_guard_immutable() returns trigger
language plpgsql as $$
begin
  if new.user_id is distinct from old.user_id
     or new.account_id is distinct from old.account_id
     or new.external_transaction_id is distinct from old.external_transaction_id then
    raise exception 'user_id, account_id and external_transaction_id are immutable'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger transactions_guard_immutable
  before update on public.transactions
  for each row execute function public.transactions_guard_immutable();

-- ---------------------------------------------------------------------------------------
-- Balance snapshots (one per account per day; source of net-worth history)
-- ---------------------------------------------------------------------------------------
create table public.balance_snapshots (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  account_id    uuid not null,
  date          date not null,
  balance_minor bigint not null,
  source        text not null check (source in ('provider', 'sample', 'manual')),
  created_at    timestamptz not null default now(),
  foreign key (account_id, user_id) references public.accounts (id, user_id) on delete cascade,
  unique (account_id, date)
);
create index balance_snapshots_user_date_idx on public.balance_snapshots (user_id, date);

-- ---------------------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------------------
create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();
create trigger financial_connections_updated_at before update on public.financial_connections
  for each row execute function public.set_updated_at();
create trigger connection_credentials_updated_at before update on public.connection_credentials
  for each row execute function public.set_updated_at();
create trigger accounts_updated_at before update on public.accounts
  for each row execute function public.set_updated_at();
create trigger category_rules_updated_at before update on public.category_rules
  for each row execute function public.set_updated_at();
create trigger transactions_updated_at before update on public.transactions
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------------------
alter table public.profiles               enable row level security;
alter table public.financial_connections  enable row level security;
alter table public.connection_credentials enable row level security;
alter table public.accounts               enable row level security;
alter table public.category_groups        enable row level security;
alter table public.categories             enable row level security;
alter table public.category_rules         enable row level security;
alter table public.transactions           enable row level security;
alter table public.balance_snapshots      enable row level security;

-- profiles: a user sees and edits only their own profile.
create policy profiles_select on public.profiles for select to authenticated using (id = (select auth.uid()));
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- Provider-synced data is written by server-side jobs using the service role (which bypasses
-- RLS). Clients may only read it.
create policy connections_select on public.financial_connections for select to authenticated using (user_id = (select auth.uid()));
create policy accounts_select on public.accounts for select to authenticated using (user_id = (select auth.uid()));
create policy snapshots_select on public.balance_snapshots for select to authenticated using (user_id = (select auth.uid()));

-- Category taxonomy and rules are user-managed.
create policy category_groups_all on public.category_groups for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy categories_all on public.categories for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy category_rules_all on public.category_rules for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Transactions: users read their own and may update ONLY the user-editable columns.
create policy transactions_select on public.transactions for select to authenticated using (user_id = (select auth.uid()));
create policy transactions_update on public.transactions for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- connection_credentials: intentionally no policies (service role only).

-- ---------------------------------------------------------------------------------------
-- Column-level privileges: defence in depth on top of RLS.
-- ---------------------------------------------------------------------------------------
revoke all on public.connection_credentials from anon, authenticated;
revoke insert, update, delete on public.financial_connections, public.accounts, public.balance_snapshots from anon, authenticated;
revoke insert, update, delete on public.transactions from anon, authenticated;
grant update (category_id, category_source, notes, excluded_from_reports) on public.transactions to authenticated;
revoke all on all tables in schema public from anon;
