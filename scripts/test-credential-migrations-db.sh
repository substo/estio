#!/usr/bin/env bash
# Exercises the guards of the two credential drop migrations against a throwaway local PostgreSQL
# (documentation/credentials.md). Never touches a real database.
#   bash scripts/test-credential-migrations-db.sh
set -euo pipefail

for bin in initdb pg_ctl psql; do
    command -v "$bin" >/dev/null 2>&1 || { echo "Missing required test dependency: $bin" >&2; exit 1; }
done

repo="$(git rev-parse --show-toplevel)"
first="$repo/prisma/migrations/20261106100000_drop_legacy_user_credentials/migration.sql"
second="$repo/prisma/migrations/20261106110000_drop_moved_credentials/migration.sql"
root="$(mktemp -d "${TMPDIR:-/tmp}/estio-credential-migrations.XXXXXX")"
port="${CREDENTIAL_MIGRATION_TEST_PORT:-55441}"
cleanup() { pg_ctl -D "$root/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$root"; }
trap cleanup EXIT

initdb -D "$root/data" -A trust -U postgres >/dev/null
pg_ctl -D "$root/data" -o "-p $port -k $root -c listen_addresses=''" -l "$root/log" -w start >/dev/null
sql() { PGOPTIONS="-c client_min_messages=warning" psql -h "$root" -p "$port" -U postgres -d postgres -v ON_ERROR_STOP=1 -q "$@"; }

reset_schema() {
    sql <<'SQL'
DROP SCHEMA public CASCADE; CREATE SCHEMA public;
CREATE TYPE "SettingsScopeType" AS ENUM ('LOCATION', 'USER');
CREATE TABLE "User" (id text PRIMARY KEY, "crmUsername" text, "crmPassword" text, "googleAccessToken" text,
  "googleRefreshToken" text, "googleSyncToken" text, "outlookAccessToken" text, "outlookRefreshToken" text,
  "outlookPasswordEncrypted" text, "outlookSessionCookies" text);
CREATE TABLE "Location" (id text PRIMARY KEY, "whatsappWebhookSecret" text);
CREATE TABLE settings_documents (scope_type "SettingsScopeType", scope_id text, domain text, payload jsonb);
INSERT INTO "User"(id) VALUES ('u1');
INSERT INTO "Location"(id) VALUES ('l1');
SQL
}

pass=0; fail=0
expect() { # expect <ok|refuse> <description> <migration> <setup-sql>
    reset_schema
    sql -c "$4" >/dev/null
    if sql -f "$3" >"$root/out" 2>&1; then outcome=ok; else outcome=refuse; fi
    if [ "$outcome" = "$1" ]; then pass=$((pass + 1)); echo "ok   - $2";
    else fail=$((fail + 1)); echo "FAIL - $2 (got $outcome)"; cat "$root/out"; fi
}
column_gone() { # column_gone <table> <column>
    [ "$(sql -tA -c "SELECT count(*) FROM information_schema.columns WHERE table_name='$1' AND column_name='$2'")" = "0" ]
}

expect ok     "first drop runs on clean rows" "$first" "SELECT 1"
if column_gone User crmPassword && column_gone User googleAccessToken && column_gone User crmUsername; then pass=$((pass + 1)); echo "ok   - first drop removed the columns"; else fail=$((fail + 1)); echo "FAIL - columns still present"; fi
expect refuse "first drop refuses a plain CRM password" "$first" "UPDATE \"User\" SET \"crmPassword\"='x'"
expect refuse "first drop refuses a plain OAuth token" "$first" "UPDATE \"User\" SET \"outlookRefreshToken\"='x'"
expect refuse "first drop refuses a username without a user.crm document" "$first" "UPDATE \"User\" SET \"crmUsername\"='agent'"
expect ok     "first drop accepts a username whose user.crm document exists" "$first" "UPDATE \"User\" SET \"crmUsername\"='agent'; INSERT INTO settings_documents VALUES ('USER','u1','user.crm','{\"crmUsername\":\"agent\"}')"
expect ok     "first drop ignores blank values" "$first" "UPDATE \"User\" SET \"crmPassword\"='  ', \"googleSyncToken\"=''"
if column_gone User crmPassword; then pass=$((pass + 1)); echo "ok   - blank values do not block the drop"; else fail=$((fail + 1)); echo "FAIL - column present after accepted run"; fi

expect ok     "second drop runs after the copy" "$second" "INSERT INTO settings_documents VALUES ('LOCATION','l1','location.integrations','{\"whatsappWebhookSecret\":null}')"
if column_gone User outlookSessionCookies && column_gone Location whatsappWebhookSecret; then pass=$((pass + 1)); echo "ok   - second drop removed the columns"; else fail=$((fail + 1)); echo "FAIL - columns still present"; fi
expect refuse "second drop refuses unmoved Outlook cookies" "$second" "UPDATE \"User\" SET \"outlookSessionCookies\"='iv:tag:ct'"
expect refuse "second drop refuses an unmoved column verify token" "$second" "UPDATE \"Location\" SET \"whatsappWebhookSecret\"='tok'"
expect refuse "second drop refuses a verify token left in the document" "$second" "INSERT INTO settings_documents VALUES ('LOCATION','l1','location.integrations','{\"whatsappWebhookSecret\":\"tok\"}')"
reset_schema
sql -c "UPDATE \"User\" SET \"outlookPasswordEncrypted\"='x'" >/dev/null
sql -f "$second" >/dev/null 2>&1 || true
if ! column_gone User outlookPasswordEncrypted; then pass=$((pass + 1)); echo "ok   - a refused second drop leaves every column in place"; else fail=$((fail + 1)); echo "FAIL - refused run dropped columns"; fi

echo "pass $pass, fail $fail"
[ "$fail" -eq 0 ]
