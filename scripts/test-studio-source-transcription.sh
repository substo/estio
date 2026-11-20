#!/usr/bin/env bash
# Disposable PostgreSQL check of Mac video transcription (grant, request, claim, completion, failure, release).
set -euo pipefail
cd "$(dirname "$0")/.."
export LC_ALL=en_US.UTF-8
if [[ -d /opt/homebrew/opt/postgresql@17/bin ]]; then export PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH"; fi
d=$(mktemp -d /tmp/studio-source-transcribe.XXXXXX)
trap 'pg_ctl -D "$d/db" -m immediate -w stop >/dev/null 2>&1 || true; rm -rf "$d"' EXIT
initdb -D "$d/db" --username=studio_test --no-locale --encoding=UTF8 --auth=trust >"$d/init.log"
mkdir "$d/socket"
pg_ctl -D "$d/db" -l "$d/server.log" -o "-k $d/socket -h '' -p 55461" -w start >/dev/null
psql_cmd=(env -u PGSERVICE -u PGHOSTADDR -u PGOPTIONS psql -X -h "$d/socket" -p 55461 -U studio_test -d postgres -v ON_ERROR_STOP=1)
"${psql_cmd[@]}" -f studio/tests/crm-fixture.sql -f prisma/migrations/20261028100000_studio_schema/migration.sql -f studio/tests/crm-fixture-writes.sql >"$d/setup.log" 2>&1
for m in 20261028190000_brand_profile 20261105100000_studio_ai_key_from_settings 20261105140000_studio_library_summary 20261106120000_studio_device_onboarding_research 20261118120000_studio_text_subscription 20261118140000_studio_source_transcription; do
 "${psql_cmd[@]}" -f "prisma/migrations/$m/migration.sql" >>"$d/setup.log" 2>&1 || { tail -20 "$d/setup.log"; exit 1; }
done
"${psql_cmd[@]}" -f studio/tests/source-transcription-assertions.sql
echo 'Studio source transcription disposable database tests passed.'
