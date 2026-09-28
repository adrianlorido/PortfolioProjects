#!/usr/bin/env bash
# Applies the migration + seed to a throwaway database on a plain PostgreSQL 15+
# server (with a minimal Supabase auth stub) and runs the RLS/RPC tests.
# Uses standard libpq env vars: PGHOST, PGPORT, PGUSER, PGPASSWORD.
set -euo pipefail
cd "$(dirname "$0")/.."
DB="bastion_test_$$"
PSQL=(psql -v ON_ERROR_STOP=1 -q -X)
cleanup() { "${PSQL[@]}" -d postgres -c "drop database if exists ${DB}" >/dev/null 2>&1 || true; }
trap cleanup EXIT
"${PSQL[@]}" -d postgres -c "create database ${DB}"
"${PSQL[@]}" -d "${DB}" -f supabase/local-tests/00_supabase_stub.sql
for f in supabase/migrations/*.sql; do "${PSQL[@]}" -d "${DB}" -f "$f"; done
"${PSQL[@]}" -d "${DB}" -f supabase/seed.sql
"${PSQL[@]}" -d "${DB}" -f supabase/local-tests/10_rls_and_rpc_test.sql
# Repository <-> SQL contract test (server-only resolves to its empty build under react-server).
CONTRACT_DB="${DB}" NODE_OPTIONS="--conditions=react-server" npx tsx scripts/supabase-contract-test.ts
