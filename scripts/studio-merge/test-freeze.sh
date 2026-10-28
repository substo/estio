#!/usr/bin/env bash
set -euo pipefail
root=$(mktemp -d /tmp/studio-freeze-test.XXXXXX)
initdb -D "$root/db" --username=freeze_test --auth=trust --no-locale > "$root/init.log"
mkdir "$root/socket"
pg_ctl -D "$root/db" -l "$root/server.log" -o "-k $root/socket -h '' -p 55449" -w start >/dev/null
trap 'pg_ctl -D "$root/db" -m immediate -w stop >/dev/null' EXIT
export PGHOST="$root/socket" PGPORT=55449 PGUSER=freeze_test PGDATABASE=postgres
unset PGOPTIONS PGSERVICE PGHOSTADDR
psql -X -v ON_ERROR_STOP=1 -c 'create table studio_fixture(id int); create table platform_fixture(id int); insert into studio_fixture values(1);' >/dev/null
psql -X -v ON_ERROR_STOP=1 -f scripts/studio-merge/freeze-source.sql >/dev/null
for producer in web worker cron Mac; do
 for statement in 'insert into studio_fixture values(2)' 'update studio_fixture set id=2' 'delete from studio_fixture' 'truncate studio_fixture' 'insert into platform_fixture values(1)'; do
  if psql -X -v ON_ERROR_STOP=1 -c "$statement" > "$root/$producer.log" 2>&1; then echo "Freeze failed: $producer" >&2; exit 1; fi
  rg -q 'Studio merge maintenance: writes frozen' "$root/$producer.log"
 done
done
[[ $(psql -X -Atc 'select count(*) from studio_fixture') == 1 ]]
psql -X -v ON_ERROR_STOP=1 -f scripts/studio-merge/unfreeze-source.sql >/dev/null
psql -X -v ON_ERROR_STOP=1 -c 'insert into studio_fixture values(2)' >/dev/null
[[ $(psql -X -Atc 'select count(*) from studio_fixture') == 2 ]]
echo "Source freeze covers all producers, DML and truncate; reads and reversible unfreeze preserve data. Evidence: $root"
