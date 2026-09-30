#!/usr/bin/env bash
# Applies the migration to a throwaway database on a local PostgreSQL and runs the schema
# assertions. Requires psql and a local server you can connect to as a superuser.
# Usage: npm run db:verify   (uses the standard PG* env vars, e.g. PGUSER=postgres PGDATABASE=postgres)
set -euo pipefail
cd "$(dirname "$0")/.."
DB="finance_schema_verify_$$"
PSQL=(psql -v ON_ERROR_STOP=1 -q)
createdb "$DB"
trap 'dropdb --if-exists "$DB"' EXIT
"${PSQL[@]}" -d "$DB" -f supabase/tests/00_local_auth_shim.sql
for migration in supabase/migrations/*.sql; do
  echo "Applying $migration"
  "${PSQL[@]}" -d "$DB" -f "$migration"
done
"${PSQL[@]}" -d "$DB" -f supabase/tests/10_schema_assertions.sql
