#!/usr/bin/env bash
# Only the disposable harness's own cluster. No URL, .env file, production tool or live storage client.
set -euo pipefail
umask 077
studio_socket=$1
studio_lab=$2
if [[ "$studio_socket" != "$studio_lab/socket" || ! -f "$studio_lab/db/PG_VERSION" || "$studio_lab" != *estio-studio-test.* ]]; then
 echo 'Refusing non-disposable recovery target.' >&2; exit 1
fi
for studio_binary in pg_dump pg_restore createdb dropdb; do command -v "$studio_binary" >/dev/null; done
studio_pg=(env -u PGSERVICE -u PGHOSTADDR -u PGOPTIONS -u PGDATABASE -u PGUSER -u PGPASSWORD -u PGPASSFILE)
studio_args=(--host="$studio_socket" --port=55439 --username=studio_test)
"${studio_pg[@]}" createdb "${studio_args[@]}" --template=template0 studio_recovery_source
"${studio_pg[@]}" psql --no-psqlrc "${studio_args[@]}" --dbname=studio_recovery_source --set=ON_ERROR_STOP=1 <<'SQL' >"$studio_lab/recovery-bootstrap.log"
create schema storage;
create table storage.buckets(id text primary key,name text,public boolean);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id));
alter table storage.objects enable row level security;
grant usage on schema storage to anon,authenticated,service_role;
grant all on storage.buckets,storage.objects to anon,authenticated,service_role;
create policy broad_legacy_policy on storage.objects to anon,authenticated using(true) with check(true);
SQL
for studio_migration in studio/supabase/migrations/*.sql; do
 "${studio_pg[@]}" psql --no-psqlrc "${studio_args[@]}" --dbname=studio_recovery_source --set=ON_ERROR_STOP=1 --file="$studio_migration" >>"$studio_lab/recovery-bootstrap.log"
done
./node_modules/.bin/tsx studio/tests/recovery-fixture.ts prepare "$studio_lab"
"${studio_pg[@]}" psql --no-psqlrc "${studio_args[@]}" --dbname=studio_recovery_source --set=ON_ERROR_STOP=1 --file="$studio_lab/recovery-seed.sql" >"$studio_lab/recovery-seed.log"
"${studio_pg[@]}" psql --no-psqlrc -qAt "${studio_args[@]}" --dbname=studio_recovery_source --set=ON_ERROR_STOP=1 --file=studio/tests/recovery-state.sql >"$studio_lab/recovery-bundle/state.json"
"${studio_pg[@]}" pg_dump "${studio_args[@]}" --dbname=studio_recovery_source --format=custom --no-owner --schema=public --schema=storage --file="$studio_lab/recovery-bundle/database.dump"
./node_modules/.bin/tsx studio/tests/recovery-fixture.ts seal "$studio_lab"
"${studio_pg[@]}" pg_restore --list "$studio_lab/recovery-bundle/database.dump" >"$studio_lab/recovery-archive-list.log"
# Simulated loss of original DB and media. Only fixed synthetic names in this newly created socket-only cluster.
"${studio_pg[@]}" dropdb "${studio_args[@]}" studio_recovery_source
rm -r "$studio_lab/fixture-r2-source"
"${studio_pg[@]}" createdb "${studio_args[@]}" --template=template0 studio_recovery_restored
# pg_dump includes public schema creation. The target is the fixed fresh local DB, never a supplied DSN.
"${studio_pg[@]}" psql --no-psqlrc "${studio_args[@]}" --dbname=studio_recovery_restored --set=ON_ERROR_STOP=1 --command='drop schema public' >"$studio_lab/recovery-restore.log"
"${studio_pg[@]}" pg_restore "${studio_args[@]}" --dbname=studio_recovery_restored --no-owner --exit-on-error --single-transaction "$studio_lab/recovery-bundle/database.dump" >>"$studio_lab/recovery-restore.log" 2>&1
mkdir -m 700 "$studio_lab/restored-bundle"
cp -Rp "$studio_lab/recovery-bundle/." "$studio_lab/restored-bundle/"
"${studio_pg[@]}" psql --no-psqlrc -qAt "${studio_args[@]}" --dbname=studio_recovery_restored --set=ON_ERROR_STOP=1 --file=studio/tests/recovery-state.sql >"$studio_lab/restored-bundle/state.json"
if ! cmp "$studio_lab/recovery-bundle/state.json" "$studio_lab/restored-bundle/state.json"; then
 ./node_modules/.bin/tsx studio/tests/recovery-fixture.ts compare "$studio_lab"
 exit 1
fi
./node_modules/.bin/tsx studio/tests/recovery-fixture.ts verify-restored "$studio_lab"
"${studio_pg[@]}" psql --no-psqlrc "${studio_args[@]}" --dbname=studio_recovery_restored --set=ON_ERROR_STOP=1 --file=studio/tests/recovery-assertions.sql
