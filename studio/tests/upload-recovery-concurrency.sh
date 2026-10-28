#!/usr/bin/env bash
# Disposable local PostgreSQL socket only. Two tabs finalizing the same landed object.
set -euo pipefail
studio_socket=$1
studio_logs=$2
studio_psql=(env -u PGSERVICE -u PGHOSTADDR -u PGOPTIONS psql --no-psqlrc --host="$studio_socket" --port=55439 --username=studio_test --dbname=postgres --set=ON_ERROR_STOP=1)
"${studio_psql[@]}" <<'SQL' >"$studio_logs/upload-race-setup.log"
select studio.studio_create_substo_location('f8100000-0000-4000-8000-000000000001','Upload race','upload-race-owner');
insert into studio.studio_records(location_id,id,kind,title,payload) values('f8100000-0000-4000-8000-000000000001','f8200000-0000-4000-8000-000000000001','content','Upload race','{}');
select studio.studio_create_upload('f8100000-0000-4000-8000-000000000001','substo','upload-race-owner','f8300000-0000-4000-8000-000000000001','f8200000-0000-4000-8000-000000000001','a.mp4','video/mp4',100,'studio-media');
SQL
"${studio_psql[@]}" <<'SQL' >"$studio_logs/upload-race-a.log" 2>&1 &
begin;
select studio.studio_complete_upload('f8100000-0000-4000-8000-000000000001','substo','upload-race-owner','f8300000-0000-4000-8000-000000000001',100);
\echo LOCKED
do $$ declare n integer; begin
 for n in 1..250 loop
  perform pg_stat_clear_snapshot();
  if exists(select 1 from pg_stat_activity where application_name='studio-upload-recovery-b' and wait_event='transactionid') then return; end if;
  perform pg_sleep(0.02);
 end loop;
 raise exception 'Second finalization did not wait for the upload transaction';
end $$;
commit;
SQL
studio_a=$!
studio_ready=false
for studio_poll in {1..100}; do
 if rg -q '^LOCKED$' "$studio_logs/upload-race-a.log"; then studio_ready=true; break; fi
 sleep 0.02
done
if [[ "$studio_ready" != true ]]; then wait "$studio_a" || true; cat "$studio_logs/upload-race-a.log"; exit 1; fi
PGAPPNAME=studio-upload-recovery-b "${studio_psql[@]}" <<'SQL' >"$studio_logs/upload-race-b.log" 2>&1 &
select studio.studio_complete_upload('f8100000-0000-4000-8000-000000000001','substo','upload-race-owner','f8300000-0000-4000-8000-000000000001',100);
SQL
studio_b=$!
wait "$studio_a" || { cat "$studio_logs/upload-race-a.log"; exit 1; }
wait "$studio_b" || { cat "$studio_logs/upload-race-b.log"; exit 1; }
"${studio_psql[@]}" <<'SQL'
do $$ begin
 if (select count(*) from studio.studio_media_objects where location_id='f8100000-0000-4000-8000-000000000001')<>1
 or (select count(*) from studio.studio_jobs where location_id='f8100000-0000-4000-8000-000000000001')<>1
 or (select status from studio.studio_uploads where id='f8300000-0000-4000-8000-000000000001')<>'uploaded'
 then raise exception 'Concurrent recovery duplicated work'; end if;
end $$;
select 'Studio upload recovery concurrency assertions passed' as result;
SQL
