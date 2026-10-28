#!/usr/bin/env bash
# Isolated archive restore only. Never accepts a target connection string.
set -euo pipefail
umask 077
archive_dir=${1:?Usage: drill-unified-restore.sh PRIVATE_ARCHIVE_DIRECTORY}
archive_dir=$(cd "$archive_dir" && pwd)
(cd "$archive_dir" && shasum -a 256 --check SHA256SUMS)
root=$(mktemp -d /tmp/estio-unified-restore.XXXXXX)
for binary in initdb pg_ctl pg_restore psql createdb; do command -v "$binary" >/dev/null; done
initdb -D "$root/db" --username=drill --no-locale --encoding=UTF8 --auth=trust > "$root/init.log"
mkdir "$root/socket"
pg_ctl -D "$root/db" -l "$root/server.log" -o "-k $root/socket -h '' -p 55443" -w start >/dev/null
trap 'pg_ctl -D "$root/db" -m immediate -w stop >/dev/null' EXIT
unset PGSERVICE PGSERVICEFILE PGHOSTADDR PGOPTIONS
export PGHOST="$root/socket" PGPORT=55443 PGUSER=drill PGDATABASE=postgres
psql -X -v ON_ERROR_STOP=1 > "$root/setup.log" <<'SQL'
create role anon; create role authenticated; create role service_role; create role authenticator;
create role supabase_auth_admin; create role supabase_storage_admin;
SQL
createdb restored
export PGDATABASE=restored
psql -X -v ON_ERROR_STOP=1 >> "$root/setup.log" <<'SQL'
create schema studio;
create schema extensions; create extension pgcrypto with schema extensions;
create extension "uuid-ossp" with schema extensions;
SQL
# Supabase infrastructure schemas/extensions require Supabase itself. Restore all
# application schemas, functions, sequences and constraints, with local ownership.
pg_restore --exit-on-error --no-owner --no-acl --schema=public --schema=studio --dbname=restored "$archive_dir/database.dump" > "$root/restore.log" 2>&1
psql -X -At -v ON_ERROR_STOP=1 > "$root/inventory.tsv" <<'SQL'
select format('select %L, count(*), md5(coalesce(string_agg(to_jsonb(t)::text,E''\n'' order by to_jsonb(t)::text),'''')) from %I.%I t;',schemaname||'.'||tablename,schemaname,tablename)
from pg_tables where schemaname in ('public','studio') order by schemaname,tablename \gexec
SQL
psql -X -At -v ON_ERROR_STOP=1 > "$root/invariants.json" <<'SQL'
do $$ begin
 if exists(select 1 from pg_constraint where contype='f' and not convalidated and connamespace in ('public'::regnamespace,'studio'::regnamespace)) then raise exception 'Unvalidated application foreign key'; end if;
 if (studio.studio_readiness_snapshot()->>'schema')::integer <> 29 then raise exception 'Unexpected readiness schema'; end if;
 if exists(select 1 from studio.studio_location_members m join public."Location" l on l.id=m.location_id where m.location_app<>l."authRealm"::text) then raise exception 'Cross realm authority'; end if;
 if not exists(select 1 from public."_prisma_migrations" where migration_name='20261028100000_studio_schema' and finished_at is not null) then raise exception 'Missing merge ledger'; end if;
end $$;
select studio.studio_readiness_snapshot();
select jsonb_build_object('legacyMedia',count(*) filter(where legacy_key_prefix is not null),'mediaObjects',count(*)) from studio.studio_media_objects;
select jsonb_build_object('authorityRows',count(*)) from studio.studio_location_members;
select jsonb_build_object('unvalidatedForeignKeys',count(*)) from pg_constraint where contype='f' and not convalidated and connamespace in ('public'::regnamespace,'studio'::regnamespace);
select jsonb_build_object('migrations',count(*)) from public."_prisma_migrations" where finished_at is not null;
SQL
printf 'Application restore passed. Private evidence and stopped disposable cluster: %s\n' "$root"
