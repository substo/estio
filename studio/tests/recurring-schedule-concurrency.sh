#!/usr/bin/env bash
set -euo pipefail
studio_socket=$1
studio_logs=$2
studio_psql=(env -u PGSERVICE -u PGHOSTADDR -u PGOPTIONS psql --no-psqlrc --host="$studio_socket" --port=55439 --username=studio_test --dbname=postgres --set=ON_ERROR_STOP=1 --set=VERBOSITY=verbose)
"${studio_psql[@]}" <<'SQL' >"$studio_logs/recurring-race-setup.log"
select public.studio_create_substo_location('b2100000-0000-4000-8000-000000000001','Recurring race','recurring-race-owner');
select public.studio_save_schedule('b2100000-0000-4000-8000-000000000001','b2300000-0000-4000-8000-000000000001',0,'substo','recurring-race-owner','idea-review','Race',24,'09:00');
insert into public.studio_records(location_id,id,kind,title,payload) values('b2100000-0000-4000-8000-000000000001','b2200000-0000-4000-8000-000000000001','content','Race idea','{"stage":"idea"}');
select public.studio_set_schedule_recurring('b2100000-0000-4000-8000-000000000001','substo','recurring-race-owner','b2300000-0000-4000-8000-000000000001',1,0,'b2500000-0000-4000-8000-000000000001','enable','[{"id":"b2200000-0000-4000-8000-000000000001","version":1}]',true);
update public.studio_schedule_recurring set next_run_at=clock_timestamp()-interval '1 minute' where location_id='b2100000-0000-4000-8000-000000000001';
SQL
"${studio_psql[@]}" <<'SQL' >"$studio_logs/recurring-race-a.log" 2>&1 &
begin;
select public.studio_dispatch_schedule(location_id,schedule_id,activation_token,next_run_at,true) from public.studio_schedule_recurring where location_id='b2100000-0000-4000-8000-000000000001';
\echo LOCKED
do $$ declare n integer; begin
 for n in 1..250 loop
  perform pg_stat_clear_snapshot();
  if (select count(*) from pg_stat_activity where application_name in ('studio-recurring-b','studio-recurring-c') and wait_event_type='Lock')=2 then return; end if;
  perform pg_sleep(0.02);
 end loop;
 raise exception 'Competing dispatcher/pause did not reach their locks';
end $$;
commit;
SQL
studio_a=$!
studio_ready=false
for studio_poll in {1..100}; do
 if rg -q '^LOCKED$' "$studio_logs/recurring-race-a.log"; then studio_ready=true; break; fi
 sleep 0.02
done
if [[ "$studio_ready" != true ]]; then wait "$studio_a" || true; cat "$studio_logs/recurring-race-a.log"; exit 1; fi
PGAPPNAME=studio-recurring-b "${studio_psql[@]}" <<'SQL' >"$studio_logs/recurring-race-b.log" 2>&1 &
select public.studio_dispatch_schedule(location_id,schedule_id,activation_token,next_run_at,true) from public.studio_schedule_recurring where location_id='b2100000-0000-4000-8000-000000000001';
SQL
studio_b=$!
PGAPPNAME=studio-recurring-c "${studio_psql[@]}" <<'SQL' >"$studio_logs/recurring-race-c.log" 2>&1 &
select public.studio_set_schedule_recurring('b2100000-0000-4000-8000-000000000001','substo','recurring-race-owner','b2300000-0000-4000-8000-000000000001',1,1,'b2500000-0000-4000-8000-000000000002','pause','[]',false);
SQL
studio_c=$!
wait "$studio_a" || { cat "$studio_logs/recurring-race-a.log"; exit 1; }
wait "$studio_b" || { cat "$studio_logs/recurring-race-b.log"; exit 1; }
wait "$studio_c" || { cat "$studio_logs/recurring-race-c.log"; exit 1; }
rg -q 'not_due' "$studio_logs/recurring-race-b.log"
"${studio_psql[@]}" <<'SQL'
select public.studio_claim_jobs('recurring-race-worker',50,60);
do $$ declare e public.studio_schedule_executions%rowtype; j public.studio_jobs%rowtype; begin
 if (select count(*) from public.studio_schedule_executions where location_id='b2100000-0000-4000-8000-000000000001')<>1
 or (select count(*) from public.studio_schedule_ticks where location_id='b2100000-0000-4000-8000-000000000001')<>1
 or (select count(*) from public.studio_jobs where location_id='b2100000-0000-4000-8000-000000000001')<>1
 or (select enabled from public.studio_schedule_recurring where location_id='b2100000-0000-4000-8000-000000000001') then raise exception 'Recurring race duplicated work or lost pause'; end if;
 select * into e from public.studio_schedule_executions where location_id='b2100000-0000-4000-8000-000000000001';
 select * into j from public.studio_jobs where id=e.job_id;
 if public.studio_begin_text_run_attempt(e.location_id,e.review_id,j.id,'recurring-race-worker',j.lease_token)->>'outcome'<>'schedule_inactive'
 or public.studio_begin_idea_review_attempt(e.location_id,e.review_id,j.id,'recurring-race-worker',j.lease_token)->>'outcome'<>'schedule_inactive'
 or exists(select 1 from public.studio_ai_usage where location_id=e.location_id) then raise exception 'Concurrent pause failed the pre-charge fence'; end if;
end $$;
select 'Studio recurring dispatch/pause concurrency assertions passed' as result;
SQL
