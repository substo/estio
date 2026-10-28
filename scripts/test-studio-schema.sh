#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# Studio lives in the CRM database (schema `studio`, one Prisma migration). This builds a
# disposable PostgreSQL with a stand-in for the CRM tables Studio reads, applies the real
# migration file, and runs every SQL and concurrency suite against that final schema.
for binary in initdb pg_ctl psql rg; do command -v "$binary" >/dev/null || { echo "Missing PostgreSQL binary: $binary" >&2; exit 1; }; done
studio_migration=$(ls prisma/migrations/*_studio_schema/migration.sql)
studio_test_dir=$(mktemp -d "${TMPDIR:-/tmp}/estio-studio-test.XXXXXX")
cleanup() {
  pg_ctl -D "$studio_test_dir/db" -m immediate -w stop >/dev/null 2>&1 || true
  rm -rf "$studio_test_dir"
}
trap cleanup EXIT
initdb -D "$studio_test_dir/db" --username=studio_test --no-locale --encoding=UTF8 --auth=trust >"$studio_test_dir/init.log"
mkdir "$studio_test_dir/socket"
# No TCP listener, existing database, credentials, or production environment used.
pg_ctl -D "$studio_test_dir/db" -l "$studio_test_dir/server.log" -o "-k $studio_test_dir/socket -h '' -p 55439" -w start >/dev/null
studio_psql=(env -u PGSERVICE -u PGHOSTADDR -u PGOPTIONS psql --no-psqlrc --host="$studio_test_dir/socket" --port=55439 --username=studio_test --dbname=postgres --set=ON_ERROR_STOP=1)
"${studio_psql[@]}" --file=studio/tests/crm-fixture.sql --file="$studio_migration" --file=studio/tests/crm-fixture-writes.sql >"$studio_test_dir/setup.log"
for suite in assertions import knowledge knowledge-import knowledge-review schedule schedule-import record-link \
  media-reconciliation knowledge-media ai-credentials jobs uploads youtube-discovery paid-attempt-reliability \
  transcription-reconciliation idea-review script-brief knowledge-extraction schedule-execution recurring-schedule \
  youtube-schedule knowledge-edit-topics profile-deletion upload-recovery readiness youtube-run-now devices location-key; do
  file="studio/tests/${suite}-assertions.sql"; [[ "$suite" == assertions ]] && file=studio/tests/assertions.sql
  "${studio_psql[@]}" --quiet --file="$file"
done
for suite in devices transcription-reconciliation script-brief knowledge-extraction schedule-execution recurring-schedule \
  youtube-schedule knowledge-edit-topics profile-deletion upload-recovery; do
  bash "studio/tests/${suite}-concurrency.sh" "$studio_test_dir/socket" "$studio_test_dir"
done
# The TypeScript database layer against the same schema (a fresh Location; no other test data needed).
STUDIO_TEST_DATABASE_URL="postgresql://studio_test@localhost:55439/postgres?host=$studio_test_dir/socket" \
  npx tsx --test lib/studio/db.db.test.ts
echo "All Studio schema suites passed."
