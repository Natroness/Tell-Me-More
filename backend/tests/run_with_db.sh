#!/usr/bin/env bash
# Runs pytest against a throwaway Postgres with the real migration applied.
set -euo pipefail
cd "$(dirname "$0")/.."
NAME=lorebook-test-pg
PORT=54329
docker rm -f "$NAME" >/dev/null 2>&1 || true
docker run -d --rm --name "$NAME" -e POSTGRES_PASSWORD=pw -p "$PORT:5432" postgres:16-alpine >/dev/null
trap 'docker stop "$NAME" >/dev/null' EXIT
until docker exec "$NAME" psql -U postgres -c 'select 1' >/dev/null 2>&1; do sleep 0.5; done
psql_in() { docker exec -i -e PGOPTIONS='-c client_min_messages=error' "$NAME" psql -U postgres -q -v ON_ERROR_STOP=1 "$@"; }
psql_in < tests/supabase_stubs.sql
for f in ../supabase/migrations/*.sql; do psql_in < "$f"; done
TEST_DATABASE_URL="postgresql://postgres:pw@localhost:$PORT/postgres" uv run pytest "$@"
