-- Schema assertions: constraints, idempotency keys, immutability, RLS isolation and
-- column privileges. Runs inside a transaction that is rolled back.
\set ON_ERROR_STOP on
begin;

create or replace function pg_temp.expect_error(sql text, label text) returns void language plpgsql as $$
begin
  execute sql;
  raise exception 'EXPECTED FAILURE DID NOT HAPPEN: %', label;
exception
  when others then
    if sqlerrm like 'EXPECTED FAILURE DID NOT HAPPEN%' then raise; end if;
    raise notice 'ok (rejected as expected): % -> %', label, sqlerrm;
end $$;

insert into auth.users (id) values
  ('00000000-0000-0000-0000-00000000000a'),
  ('00000000-0000-0000-0000-00000000000b');

insert into public.financial_connections (id, user_id, provider, provider_connection_id, institution_name) values
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000a', 'sample', 'inst-1', 'Evergreen Bank'),
  ('10000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000b', 'sample', 'inst-1', 'Evergreen Bank');

insert into public.accounts (id, user_id, connection_id, external_account_id, name, type, current_balance_minor) values
  ('20000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', 'acc-1', 'Checking A', 'checking', 500000),
  ('20000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-00000000000b', 'acc-1', 'Checking B', 'checking', 100);

insert into public.category_groups (id, user_id, name) values
  ('30000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000a', 'Food & Dining'),
  ('30000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000b', 'Food & Dining');
insert into public.categories (id, user_id, group_id, slug, name, kind) values
  ('40000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-00000000000a', 'groceries', 'Groceries', 'expense'),
  ('40000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000b', '30000000-0000-0000-0000-00000000000b', 'groceries', 'Groceries', 'expense');

insert into public.transactions (id, user_id, account_id, external_transaction_id, date, merchant_name, original_description, amount_minor, category_id, category_source) values
  ('50000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a', 'txn-1', '2026-09-01', 'Whole Foods', 'WHOLEFDS', -4512, '40000000-0000-0000-0000-00000000000a', 'rule'),
  ('50000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-00000000000b', 'txn-1', '2026-09-01', 'Whole Foods', 'WHOLEFDS', -100, null, 'none');

-- ---- Constraints ------------------------------------------------------------------------
select pg_temp.expect_error($$insert into public.accounts (user_id, name, type, current_balance_minor) values ('00000000-0000-0000-0000-00000000000a', 'X', 'crypto', 0)$$, 'unknown account type');
select pg_temp.expect_error($$insert into public.accounts (user_id, name, type, current_balance_minor, currency) values ('00000000-0000-0000-0000-00000000000a', 'X', 'cash', 0, 'usd')$$, 'lower-case currency');
select pg_temp.expect_error($$insert into public.accounts (user_id, connection_id, name, type, current_balance_minor) values ('00000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', 'X', 'cash', 0)$$, 'linked account without external id');
select pg_temp.expect_error($$insert into public.transactions (user_id, account_id, external_transaction_id, date, merchant_name, original_description, amount_minor) values ('00000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a', 'txn-1', '2026-09-02', 'Dup', 'DUP', -1)$$, 'duplicate external transaction id (idempotency key)');
select pg_temp.expect_error($$insert into public.transactions (user_id, account_id, date, merchant_name, original_description, amount_minor) values ('00000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000b', '2026-09-02', 'X', 'X', -1)$$, 'transaction on another user''s account');
select pg_temp.expect_error($$update public.transactions set category_id = '40000000-0000-0000-0000-00000000000b' where id = '50000000-0000-0000-0000-00000000000a'$$, 'category owned by another user');
-- Text input (how PostgREST/JSON values arrive) with fractional cents is rejected.
-- NOTE: a *numeric* literal (1.5) would be rounded by Postgres' assignment cast to bigint;
-- the application guards against that with assertMoney() before any write.
select pg_temp.expect_error($$insert into public.transactions (user_id, account_id, date, merchant_name, original_description, amount_minor) values ('00000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a', '2026-09-02', 'X', 'X', '1.5')$$, 'fractional minor units (text input)');
select pg_temp.expect_error($$update public.transactions set external_transaction_id = 'changed' where id = '50000000-0000-0000-0000-00000000000a'$$, 'external id is immutable');
select pg_temp.expect_error($$update public.transactions set account_id = '20000000-0000-0000-0000-00000000000b', user_id = '00000000-0000-0000-0000-00000000000b' where id = '50000000-0000-0000-0000-00000000000a'$$, 'account/user are immutable');
select pg_temp.expect_error($$insert into public.balance_snapshots (user_id, account_id, date, balance_minor, source) values ('00000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a', '2026-09-01', 1, 'sample'), ('00000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a', '2026-09-01', 2, 'sample')$$, 'duplicate snapshot per account/day');
select pg_temp.expect_error($$insert into public.categories (user_id, group_id, slug, name, kind) values ('00000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-00000000000a', 'x', 'X', 'savings')$$, 'unknown category kind');

-- Deleting a category un-categorizes its transactions instead of failing.
savepoint del_cat;
delete from public.categories where id = '40000000-0000-0000-0000-00000000000a';
do $$ begin
  if (select category_id from public.transactions where id = '50000000-0000-0000-0000-00000000000a') is not null then
    raise exception 'category delete should null out category_id';
  end if;
end $$;
rollback to savepoint del_cat;

-- ---- RLS as user A ------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);

do $$ begin
  if (select count(*) from public.accounts) <> 1 then raise exception 'user A should see exactly 1 account'; end if;
  if (select count(*) from public.transactions) <> 1 then raise exception 'user A should see exactly 1 transaction'; end if;
  if exists (select 1 from public.transactions where user_id <> auth.uid()) then raise exception 'cross-user leak'; end if;
  if (select count(*) from public.categories) <> 1 then raise exception 'user A should see only own categories'; end if;
end $$;

-- Allowed: user-editable columns on own transaction.
update public.transactions set notes = 'weekly shop', excluded_from_reports = true where id = '50000000-0000-0000-0000-00000000000a';
do $$ begin
  if (select notes from public.transactions where id = '50000000-0000-0000-0000-00000000000a') <> 'weekly shop' then raise exception 'note update failed'; end if;
end $$;

-- Other user's rows are invisible, so updates silently affect 0 rows.
with updated as (update public.transactions set notes = 'pwned' where id = '50000000-0000-0000-0000-00000000000b' returning 1)
select case when count(*) = 0 then 'ok: cross-user update affected 0 rows' else 'FAIL' end as result from updated;

select pg_temp.expect_error($$update public.transactions set amount_minor = 0 where id = '50000000-0000-0000-0000-00000000000a'$$, 'client cannot change amount');
select pg_temp.expect_error($$update public.transactions set date = '2020-01-01' where id = '50000000-0000-0000-0000-00000000000a'$$, 'client cannot change date');
select pg_temp.expect_error($$update public.accounts set current_balance_minor = 999999999 where id = '20000000-0000-0000-0000-00000000000a'$$, 'client cannot change balances');
select pg_temp.expect_error($$insert into public.transactions (user_id, account_id, date, merchant_name, original_description, amount_minor) values ('00000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a', '2026-09-02', 'X', 'X', 100)$$, 'client cannot insert transactions');
select pg_temp.expect_error($$select * from public.connection_credentials$$, 'client cannot read provider credentials');
select pg_temp.expect_error($$insert into public.categories (user_id, group_id, slug, name, kind) values ('00000000-0000-0000-0000-00000000000b', '30000000-0000-0000-0000-00000000000b', 'x', 'X', 'expense')$$, 'client cannot create rows for another user');

-- ---- anon sees nothing ----------------------------------------------------------------------
reset role;
set local role anon;
select pg_temp.expect_error($$select * from public.transactions$$, 'anon cannot read transactions');

reset role;
rollback;
\echo 'ALL SCHEMA ASSERTIONS PASSED'
