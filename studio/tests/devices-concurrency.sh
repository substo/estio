#!/usr/bin/env bash
set -euo pipefail
studio_socket=$1
studio_logs=$2
studio_psql=(env -u PGSERVICE -u PGHOSTADDR -u PGOPTIONS psql --no-psqlrc --host="$studio_socket" --port=55439 --username=studio_test --dbname=postgres --set=ON_ERROR_STOP=1 --set=VERBOSITY=verbose)
"${studio_psql[@]}" <<'SQL' >"$studio_logs/devices-setup.log"
select public.studio_create_substo_workspace('db000000-0000-4000-8000-000000000001','Device races','device-race-owner');
select public.studio_manage_device('db000000-0000-4000-8000-000000000001','substo','device-race-owner','create',gen_random_uuid(),'Race Mac',null,repeat('d',64));
select public.studio_manage_device('db000000-0000-4000-8000-000000000001','substo','device-race-owner','diagnostic',gen_random_uuid(),null,id) from public.studio_devices where workspace_id='db000000-0000-4000-8000-000000000001';
select public.studio_manage_device('db000000-0000-4000-8000-000000000001','substo','device-race-owner','diagnostic',gen_random_uuid(),null,id) from public.studio_devices where workspace_id='db000000-0000-4000-8000-000000000001';
SQL
for studio_worker in a b; do
 "${studio_psql[@]}" -c "select public.studio_device_command(repeat('d',64),'substo','claim','{\"workerId\":\"race-$studio_worker\",\"limit\":1,\"leaseSeconds\":60}');" >"$studio_logs/devices-claim-$studio_worker.log" 2>&1 &
 if [[ "$studio_worker" == a ]]; then studio_a=$!; else studio_b=$!; fi
done
wait "$studio_a" || { cat "$studio_logs/devices-claim-a.log"; exit 1; }
wait "$studio_b" || { cat "$studio_logs/devices-claim-b.log"; exit 1; }
"${studio_psql[@]}" <<'SQL'
do $$ begin
 if (select count(*) from public.studio_jobs where workspace_id='db000000-0000-4000-8000-000000000001' and status='running' and attempts=1)<>2
 or (select count(distinct lease_owner) from public.studio_jobs where workspace_id='db000000-0000-4000-8000-000000000001')<>2
 or (select count(*) from public.studio_job_events where workspace_id='db000000-0000-4000-8000-000000000001' and event='started')<>2 then raise exception 'Concurrent claims duplicated or lost work'; end if;
end $$;
SQL
"${studio_psql[@]}" <<'SQL' >"$studio_logs/devices-revoke.log" 2>&1 &
begin;
select public.studio_manage_device('db000000-0000-4000-8000-000000000001','substo','device-race-owner','revoke',gen_random_uuid(),null,id) from public.studio_devices where workspace_id='db000000-0000-4000-8000-000000000001';
\echo LOCKED
do $$ declare n int; begin
 for n in 1..250 loop
  perform pg_stat_clear_snapshot();
  if exists(select 1 from pg_stat_activity where application_name='studio-device-complete-race' and wait_event_type='Lock') then return; end if;
  perform pg_sleep(0.02);
 end loop;
 raise exception 'Completion did not reach revocation fence';
end $$;
commit;
SQL
studio_a=$!
studio_ready=false
for studio_poll in {1..100}; do
 if rg -q '^LOCKED$' "$studio_logs/devices-revoke.log"; then studio_ready=true; break; fi
 sleep 0.02
done
if [[ "$studio_ready" != true ]]; then wait "$studio_a" || true; cat "$studio_logs/devices-revoke.log"; exit 1; fi
PGAPPNAME=studio-device-complete-race "${studio_psql[@]}" <<'SQL' >"$studio_logs/devices-stale-complete.log" 2>&1 &
do $$ declare j public.studio_jobs%rowtype; begin
 select * into j from public.studio_jobs where workspace_id='db000000-0000-4000-8000-000000000001' limit 1;
 begin
  perform public.studio_device_command(repeat('d',64),'substo','complete',jsonb_build_object('jobId',j.id,'workerId',j.lease_owner,'leaseToken',j.lease_token,'result','{}'::jsonb));
  raise exception 'Completion crossed revocation fence';
 exception when sqlstate '42501' then null; end;
end $$;
SQL
studio_b=$!
wait "$studio_a" || { cat "$studio_logs/devices-revoke.log"; exit 1; }
wait "$studio_b" || { cat "$studio_logs/devices-stale-complete.log"; exit 1; }
"${studio_psql[@]}" <<'SQL'
do $$ begin
 if exists(select 1 from public.studio_job_events where workspace_id='db000000-0000-4000-8000-000000000001' and event='succeeded') then raise exception 'Revoked completion wrote result'; end if;
end $$;
delete from public.studio_workspaces where id='db000000-0000-4000-8000-000000000001';
select 'Studio device claim/revocation concurrency assertions passed' as result;
SQL
