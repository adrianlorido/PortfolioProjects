-- Review assertions (area K + review migration). Self-contained; rolled back at the end.
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

create or replace function pg_temp.expect_ok(sql text, label text) returns void language plpgsql as $$
begin
  execute sql;
  raise notice 'ok (allowed as expected): %', label;
end $$;

-- Fixtures: user A and user B, each with a connection, account, category and transaction.
insert into auth.users (id) values ('00000000-0000-0000-0000-00000000000a'), ('00000000-0000-0000-0000-00000000000b');
insert into public.financial_connections (id, user_id, provider, provider_connection_id, institution_name) values
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000a', 'sample', 'inst', 'Bank'),
  ('10000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000b', 'sample', 'inst', 'Bank');
insert into public.connection_credentials (connection_id, user_id, access_token_enc) values
  ('10000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000b', 'ciphertext-for-B');
insert into public.accounts (id, user_id, connection_id, external_account_id, name, type, current_balance_minor) values
  ('20000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', 'acc', 'Checking A', 'checking', 500000),
  ('20000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-00000000000b', 'acc', 'Checking B', 'checking', 700000);
insert into public.category_groups (id, user_id, name) values
  ('30000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000a', 'Debt'),
  ('30000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000b', 'Debt');
insert into public.categories (id, user_id, group_id, slug, name, kind) values
  ('40000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-00000000000a', 'loan_payment', 'Loan Payment', 'transfer'),
  ('41000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-00000000000a', 'interest_fees', 'Interest & Fees', 'expense'),
  ('40000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000b', '30000000-0000-0000-0000-00000000000b', 'loan_payment', 'Loan Payment', 'transfer');
insert into public.transactions (id, user_id, account_id, external_transaction_id, date, merchant_name, original_description, amount_minor, category_id, category_source) values
  ('50000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a', 'loan-pmt', '2026-09-10', 'Northwind', 'NORTHWIND AUTO FIN PMT', -50000, '40000000-0000-0000-0000-00000000000a', 'provider'),
  ('50000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-00000000000b', 'loan-pmt', '2026-09-10', 'Northwind', 'NORTHWIND AUTO FIN PMT', -50000, null, 'none');

-- ---- Money safe range ---------------------------------------------------------------------
select pg_temp.expect_ok($$update public.accounts set current_balance_minor = 9007199254740991 where id = '20000000-0000-0000-0000-00000000000a'$$, 'max safe balance');
select pg_temp.expect_error($$update public.accounts set current_balance_minor = 9007199254740992 where id = '20000000-0000-0000-0000-00000000000a'$$, 'balance above 2^53-1');
select pg_temp.expect_error($$update public.transactions set amount_minor = -9007199254740992 where id = '50000000-0000-0000-0000-00000000000a'$$, 'amount below -(2^53-1)');
select pg_temp.expect_error($$insert into public.balance_snapshots (user_id, account_id, date, balance_minor, source) values ('00000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a', '2026-09-01', 9223372036854775807, 'sample')$$, 'snapshot at bigint max');
select pg_temp.expect_error($$update public.transactions set category_source = 'magic' where id = '50000000-0000-0000-0000-00000000000a'$$, 'unknown category_source');

-- ---- Splits: balanced invariant (deferred; forced immediate for testing) ----------------------
savepoint s1;
insert into public.transaction_splits (user_id, transaction_id, line_no, amount_minor, category_id) values
  ('00000000-0000-0000-0000-00000000000a', '50000000-0000-0000-0000-00000000000a', 1, -42000, '40000000-0000-0000-0000-00000000000a'),
  ('00000000-0000-0000-0000-00000000000a', '50000000-0000-0000-0000-00000000000a', 2, -8000, '41000000-0000-0000-0000-00000000000a');
set constraints all immediate;
set constraints all deferred;
\echo 'ok (allowed as expected): balanced $420 principal + $80 interest split'
-- Provider changes the amount but leaves the old splits: rejected at commit.
select pg_temp.expect_error($$update public.transactions set amount_minor = -50100 where id = '50000000-0000-0000-0000-00000000000a'; set constraints all immediate$$, 'amount change that unbalances existing splits');
rollback to savepoint s1;

savepoint s2;
select pg_temp.expect_error($$insert into public.transaction_splits (user_id, transaction_id, line_no, amount_minor) values ('00000000-0000-0000-0000-00000000000a', '50000000-0000-0000-0000-00000000000a', 1, -42000), ('00000000-0000-0000-0000-00000000000a', '50000000-0000-0000-0000-00000000000a', 2, -7999); set constraints all immediate$$, 'splits that do not sum to the amount');
rollback to savepoint s2;
savepoint s3;
select pg_temp.expect_error($$insert into public.transaction_splits (user_id, transaction_id, line_no, amount_minor) values ('00000000-0000-0000-0000-00000000000a', '50000000-0000-0000-0000-00000000000a', 1, -50000); set constraints all immediate$$, 'single split line');
rollback to savepoint s3;
select pg_temp.expect_error($$insert into public.transaction_splits (user_id, transaction_id, line_no, amount_minor) values ('00000000-0000-0000-0000-00000000000a', '50000000-0000-0000-0000-00000000000a', 1, 0)$$, 'zero split line');

-- ---- Area K: user A against user B's data (as the authenticated role) -----------------------
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);

do $$ begin
  if exists (select 1 from public.accounts where id = '20000000-0000-0000-0000-00000000000b') then raise exception 'A can read B''s account'; end if;
  if exists (select 1 from public.transactions where id = '50000000-0000-0000-0000-00000000000b') then raise exception 'A can read B''s transaction'; end if;
  if exists (select 1 from public.financial_connections where user_id <> auth.uid()) then raise exception 'A can read B''s connection'; end if;
  if exists (select 1 from public.categories where user_id <> auth.uid()) then raise exception 'A can read B''s categories'; end if;
  if (select count(*) from public.accounts) <> 1 then raise exception 'A should see exactly one account'; end if;
end $$;
\echo 'ok: A cannot read B''s accounts, transactions, connections or categories'

select pg_temp.expect_error($$insert into public.transactions (user_id, account_id, date, merchant_name, original_description, amount_minor) values ('00000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-00000000000b', '2026-09-11', 'X', 'X', -1)$$, 'A creates a transaction for B');
select pg_temp.expect_error($$insert into public.transactions (user_id, account_id, date, merchant_name, original_description, amount_minor) values ('00000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000b', '2026-09-11', 'X', 'X', -1)$$, 'A creates a transaction on B''s account');
select pg_temp.expect_error($$update public.transactions set account_id = '20000000-0000-0000-0000-00000000000b' where id = '50000000-0000-0000-0000-00000000000a'$$, 'A moves own transaction to B''s account');
select pg_temp.expect_error($$update public.transactions set category_id = '40000000-0000-0000-0000-00000000000b', category_source = 'user' where id = '50000000-0000-0000-0000-00000000000a'$$, 'A attaches own transaction to B''s category');
select pg_temp.expect_error($$update public.transactions set external_transaction_id = 'forged' where id = '50000000-0000-0000-0000-00000000000a'$$, 'A mutates external_transaction_id');
select pg_temp.expect_error($$update public.transactions set user_id = '00000000-0000-0000-0000-00000000000b' where id = '50000000-0000-0000-0000-00000000000a'$$, 'A reassigns own transaction to B');
select pg_temp.expect_error($$update public.transactions set amount_minor = 1 where id = '50000000-0000-0000-0000-00000000000a'$$, 'A mutates provider-owned amount');
select pg_temp.expect_error($$update public.accounts set external_account_id = 'forged' where id = '20000000-0000-0000-0000-00000000000a'$$, 'A mutates external_account_id');
select pg_temp.expect_error($$update public.financial_connections set provider_connection_id = 'forged' where id = '10000000-0000-0000-0000-00000000000a'$$, 'A mutates provider_connection_id');
select pg_temp.expect_error($$select access_token_enc from public.connection_credentials$$, 'A reads provider credentials (any user''s)');
select pg_temp.expect_error($$insert into public.connection_credentials (connection_id, user_id, access_token_enc) values ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000a', 'x')$$, 'A writes provider credentials');

-- Splits: A may split own transaction, never B's, never with B's category.
select pg_temp.expect_error($$insert into public.transaction_splits (user_id, transaction_id, line_no, amount_minor) values ('00000000-0000-0000-0000-00000000000b', '50000000-0000-0000-0000-00000000000b', 1, -42000)$$, 'A inserts a split row owned by B');
select pg_temp.expect_error($$insert into public.transaction_splits (user_id, transaction_id, line_no, amount_minor) values ('00000000-0000-0000-0000-00000000000a', '50000000-0000-0000-0000-00000000000b', 1, -42000)$$, 'A splits B''s transaction');
select pg_temp.expect_error($$insert into public.transaction_splits (user_id, transaction_id, line_no, amount_minor, category_id) values ('00000000-0000-0000-0000-00000000000a', '50000000-0000-0000-0000-00000000000a', 1, -42000, '40000000-0000-0000-0000-00000000000b')$$, 'A split line uses B''s category');
savepoint s4;
select pg_temp.expect_ok($$insert into public.transaction_splits (user_id, transaction_id, line_no, amount_minor, category_id) values ('00000000-0000-0000-0000-00000000000a', '50000000-0000-0000-0000-00000000000a', 1, -42000, '40000000-0000-0000-0000-00000000000a'), ('00000000-0000-0000-0000-00000000000a', '50000000-0000-0000-0000-00000000000a', 2, -8000, '41000000-0000-0000-0000-00000000000a'); set constraints all immediate$$, 'A splits own transaction with own categories');
rollback to savepoint s4;

-- ---- service_role (server-side sync jobs) can read credentials; RLS does not apply ----------
reset role;
set local role service_role;
do $$ begin
  if (select access_token_enc from public.connection_credentials where connection_id = '10000000-0000-0000-0000-00000000000b') <> 'ciphertext-for-B' then
    raise exception 'service role should read credentials';
  end if;
end $$;
\echo 'ok (allowed as expected): service_role reads connection_credentials'

reset role;
rollback;
\echo 'ALL REVIEW ASSERTIONS PASSED'
