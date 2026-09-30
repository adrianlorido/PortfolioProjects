-- Phase 1 review fixes.
--
-- 1. Money columns are limited to the JavaScript safe-integer range (±(2^53-1) minor units =
--    ±$90,071,992,547,409.91). The application represents money as a JS number; without this a
--    bigint above 2^53 could be stored and would be silently rounded by JSON.parse when read
--    through PostgREST/supabase-js. See src/db/money-codec.ts.
-- 2. category_source gains 'provider' (category suggested by the provider's category hint).
-- 3. transaction_splits: lets one transaction be reported under several categories
--    (e.g. loan payment = principal [transfer] + interest [expense]). Lines must sum exactly to
--    the transaction amount; enforced by a deferred constraint trigger.

-- ---------------------------------------------------------------------------------------
-- 1. Safe-integer money range
-- ---------------------------------------------------------------------------------------
alter table public.accounts
  add constraint accounts_current_balance_safe_range
  check (current_balance_minor between -9007199254740991 and 9007199254740991);

alter table public.transactions
  add constraint transactions_amount_safe_range
  check (amount_minor between -9007199254740991 and 9007199254740991);

alter table public.balance_snapshots
  add constraint balance_snapshots_balance_safe_range
  check (balance_minor between -9007199254740991 and 9007199254740991);

-- ---------------------------------------------------------------------------------------
-- 2. category_source 'provider'
-- ---------------------------------------------------------------------------------------
alter table public.transactions drop constraint transactions_category_source_check;
alter table public.transactions
  add constraint transactions_category_source_check
  check (category_source in ('none', 'provider', 'rule', 'user'));

-- ---------------------------------------------------------------------------------------
-- 3. Transaction splits
-- ---------------------------------------------------------------------------------------
alter table public.transactions add constraint transactions_id_user_id_key unique (id, user_id);

create table public.transaction_splits (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,
  transaction_id uuid not null,
  line_no        smallint not null check (line_no between 1 and 20),
  amount_minor   bigint not null
                   check (amount_minor <> 0)
                   check (amount_minor between -9007199254740991 and 9007199254740991),
  category_id    uuid,
  created_at     timestamptz not null default now(),
  unique (transaction_id, line_no),
  -- Composite keys: a split can only belong to the same user's transaction and category.
  foreign key (transaction_id, user_id) references public.transactions (id, user_id) on delete cascade,
  foreign key (category_id, user_id) references public.categories (id, user_id) on delete set null (category_id)
);
create index transaction_splits_user_idx on public.transaction_splits (user_id);

-- A transaction has either no splits, or >= 2 lines summing exactly to its amount.
create or replace function public.assert_transaction_splits_balanced(p_transaction_id uuid) returns void
language plpgsql as $$
declare
  v_amount bigint;
  v_count  integer;
  v_sum    numeric;
begin
  select amount_minor into v_amount from public.transactions where id = p_transaction_id;
  if not found then
    return; -- transaction deleted (splits cascade)
  end if;
  select count(*), coalesce(sum(amount_minor), 0) into v_count, v_sum
    from public.transaction_splits where transaction_id = p_transaction_id;
  if v_count = 1 then
    raise exception 'transaction % has a single split line; use a category instead', p_transaction_id
      using errcode = 'check_violation';
  end if;
  if v_count > 1 and v_sum <> v_amount then
    raise exception 'splits of transaction % sum to % but the amount is %', p_transaction_id, v_sum, v_amount
      using errcode = 'check_violation';
  end if;
end;
$$;

create or replace function public.transaction_splits_check_trigger() returns trigger
language plpgsql as $$
begin
  if tg_table_name = 'transaction_splits' then
    if tg_op in ('UPDATE', 'DELETE') then
      perform public.assert_transaction_splits_balanced(old.transaction_id);
    end if;
    if tg_op in ('INSERT', 'UPDATE') then
      perform public.assert_transaction_splits_balanced(new.transaction_id);
    end if;
  else -- transactions: amount changed
    perform public.assert_transaction_splits_balanced(new.id);
  end if;
  return null;
end;
$$;

-- Deferred to commit time so a multi-line split (or a sync that changes an amount and
-- clears/rewrites splits) can be written in several statements inside one transaction.
create constraint trigger transaction_splits_balanced
  after insert or update or delete on public.transaction_splits
  deferrable initially deferred
  for each row execute function public.transaction_splits_check_trigger();

create constraint trigger transactions_amount_splits_balanced
  after update of amount_minor on public.transactions
  deferrable initially deferred
  for each row execute function public.transaction_splits_check_trigger();

-- Splits are user-owned classification: users manage their own rows.
alter table public.transaction_splits enable row level security;
create policy transaction_splits_all on public.transaction_splits for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke all on public.transaction_splits from anon;
