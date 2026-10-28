#!/usr/bin/env bash
# Restore real snapshots into an isolated Unix-socket-only PostgreSQL 17 cluster.
# Logs contain private database details: retain outside Git with owner-only access.
set -euo pipefail
umask 077
backup_dir=${1:?Usage: rehearse-restore.sh BACKUP_DIRECTORY}
for binary in initdb pg_ctl pg_restore psql createdb; do command -v "$binary" >/dev/null; done
root=$(mktemp -d "${TMPDIR:-/tmp}/studio-merge-restore.XXXXXX")
printf '%s\n' "$root"
initdb -D "$root/db" --username=rehearsal --no-locale --encoding=UTF8 --auth=trust > "$root/init.log"
mkdir "$root/socket"
pg_ctl -D "$root/db" -l "$root/server.log" -o "-k $root/socket -h '' -p 55441" -w start >/dev/null
trap 'pg_ctl -D "$root/db" -m immediate -w stop >/dev/null' EXIT
unset PGSERVICE PGHOSTADDR PGOPTIONS
export PGHOST="$root/socket" PGPORT=55441 PGUSER=rehearsal PGDATABASE=postgres
psql -X -v ON_ERROR_STOP=1 > "$root/setup.log" <<'SQL'
create role anon; create role authenticated; create role service_role; create role authenticator;
create role supabase_auth_admin; create role supabase_storage_admin;
SQL
for database in crm studio_source; do
  createdb "$database"
  PGDATABASE="$database" psql -X -v ON_ERROR_STOP=1 >> "$root/setup.log" <<'SQL'
create schema extensions; create extension pgcrypto with schema extensions; create extension "uuid-ossp" with schema extensions;
create schema auth; create schema private;
SQL
  snapshot=crm-premerge.dump
  [[ "$database" == studio_source ]] && snapshot=studio-premerge.dump
  pg_restore --list "$backup_dir/$snapshot" > "$root/$database.toc"
  pg_restore --exit-on-error --no-owner --no-acl --schema=public --schema=private --schema=auth --dbname="$database" "$backup_dir/$snapshot" > "$root/$database.restore.log" 2>&1
  PGDATABASE="$database" psql -X -At -v ON_ERROR_STOP=1 -c "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'" > "$root/$database.table-count"
  printf '%s restore passed; public tables=%s\n' "$database" "$(cat "$root/$database.table-count")"
done
PGDATABASE=studio_source psql -X -At -v ON_ERROR_STOP=1 -c 'select count(*) from public.studio_records; select count(*) from public.studio_media_objects' > "$root/source-counts"
migration=$(cd "$(dirname "$0")/../.." && pwd)/prisma/migrations/20261028100000_studio_schema/migration.sql
PGDATABASE=crm psql -X -v ON_ERROR_STOP=1 --file="$migration" > "$root/migration.log" 2>&1
printf 'Final Studio migration applied to restored CRM.\n'
python3 "$(dirname "$0")/rehearse-copy.py" "$root"
printf 'Both snapshot restores passed. Private evidence: %s\n' "$root"
