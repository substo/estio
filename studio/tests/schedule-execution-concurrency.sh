#!/usr/bin/env bash
# Only the disposable harness's private Unix socket; never a configured target.
set -euo pipefail
studio_socket=$1
studio_logs=$2
studio_psql=(env -u PGSERVICE -u PGHOSTADDR -u PGOPTIONS psql --no-psqlrc --host="$studio_socket" --port=55439 --username=studio_test --dbname=postgres --set=ON_ERROR_STOP=1 --set=VERBOSITY=verbose)
"${studio_psql[@]}" <<'SQL' >"$studio_logs/schedule-race-setup.log"
select studio.studio_create_substo_location('af100000-0000-4000-8000-000000000001','Schedule race','schedule-race-owner');
select studio.studio_save_schedule('af100000-0000-4000-8000-000000000001','af300000-0000-4000-8000-000000000001',0,'substo','schedule-race-owner','idea-review','Race',24,'09:00');
insert into studio.studio_records(location_id,id,kind,title,payload) values('af100000-0000-4000-8000-000000000001','af200000-0000-4000-8000-000000000001','content','Race idea','{"stage":"idea"}');
SQL
"${studio_psql[@]}" <<'SQL' >"$studio_logs/schedule-race-a.log" 2>&1 &
begin;
select studio.studio_run_schedule_now('af100000-0000-4000-8000-000000000001','substo','schedule-race-owner','af300000-0000-4000-8000-000000000001',1,'af500000-0000-4000-8000-000000000001','[{"id":"af200000-0000-4000-8000-000000000001","version":1}]',true);
\echo LOCKED
do $$ declare n integer; begin
  for n in 1..250 loop
    perform pg_stat_clear_snapshot();
    if (select count(*) from pg_stat_activity where application_name in ('studio-schedule-b','studio-schedule-c') and wait_event_type='Lock')=2 then return; end if;
    perform pg_sleep(0.02);
  end loop;
  raise exception 'Competing schedule commands did not reach their locks';
end $$;
commit;
SQL
studio_a=$!
studio_ready=false
for studio_poll in {1..100}; do
  if rg -q '^LOCKED$' "$studio_logs/schedule-race-a.log"; then studio_ready=true; break; fi
  sleep 0.02
done
if [[ "$studio_ready" != true ]]; then wait "$studio_a" || true; cat "$studio_logs/schedule-race-a.log"; exit 1; fi
PGAPPNAME=studio-schedule-b "${studio_psql[@]}" <<'SQL' >"$studio_logs/schedule-race-b.log" 2>&1 &
select studio.studio_run_schedule_now('af100000-0000-4000-8000-000000000001','substo','schedule-race-owner','af300000-0000-4000-8000-000000000001',1,'af500000-0000-4000-8000-000000000001','[{"id":"af200000-0000-4000-8000-000000000001","version":1}]',true);
SQL
studio_b=$!
PGAPPNAME=studio-schedule-c "${studio_psql[@]}" <<'SQL' >"$studio_logs/schedule-race-c.log" 2>&1 &
select studio.studio_run_schedule_now('af100000-0000-4000-8000-000000000001','substo','schedule-race-owner','af300000-0000-4000-8000-000000000001',1,'af500000-0000-4000-8000-000000000002','[{"id":"af200000-0000-4000-8000-000000000001","version":1}]',true);
SQL
studio_c=$!
wait "$studio_a" || { cat "$studio_logs/schedule-race-a.log"; exit 1; }
wait "$studio_b" || { cat "$studio_logs/schedule-race-b.log"; exit 1; }
if wait "$studio_c"; then echo 'Competing distinct schedule command succeeded' >&2; exit 1; fi
rg -q '40001' "$studio_logs/schedule-race-c.log"
# Same request must return exactly the committed execution/job/review identities.
diff <(rg '^ \{"' "$studio_logs/schedule-race-a.log") <(rg '^ \{"' "$studio_logs/schedule-race-b.log")
"${studio_psql[@]}" <<'SQL'
do $$ begin
 if (select count(*) from studio.studio_schedule_executions where location_id='af100000-0000-4000-8000-000000000001')<>1
 or (select count(*) from studio.studio_jobs where location_id='af100000-0000-4000-8000-000000000001')<>1
 or (select count(*) from studio.studio_idea_reviews where location_id='af100000-0000-4000-8000-000000000001')<>1 then
 raise exception 'Concurrent schedule commands duplicated work'; end if;
end $$;
select 'Studio schedule execution concurrency assertions passed' as result;
SQL
