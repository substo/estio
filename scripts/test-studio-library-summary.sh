#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# Base dump uses PostgreSQL 17 MAINTAIN privileges.
if [[ -d /opt/homebrew/opt/postgresql@17/bin ]]; then export PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH"; fi
logs=$(mktemp -d /tmp/studio-summary-logs.XXXXXX)
echo "SQL verification logs: $logs"
d=$(mktemp -d /tmp/studio-summary.XXXXXX)
trap 'pg_ctl -D "$d/db" -m immediate -w stop >/dev/null 2>&1 || true; rm -rf "$d"' EXIT
initdb -D "$d/db" --username=studio_test --no-locale --encoding=UTF8 --auth=trust >"$d/init.log"
mkdir "$d/socket"
pg_ctl -D "$d/db" -l "$d/server.log" -o "-k $d/socket -h '' -p 55449" -w start >/dev/null
psql_cmd=(env -u PGSERVICE -u PGHOSTADDR -u PGOPTIONS psql -X -h "$d/socket" -p 55449 -U studio_test -d postgres -v ON_ERROR_STOP=1)
"${psql_cmd[@]}" -f studio/tests/crm-fixture.sql -f prisma/migrations/20261028100000_studio_schema/migration.sql -f studio/tests/crm-fixture-writes.sql -f prisma/migrations/20261105140000_studio_library_summary/migration.sql >"$logs/setup.log" 2>&1
"${psql_cmd[@]}" -f studio/tests/library-summary-assertions.sql 2>&1 | tee "$logs/assertions.log"
