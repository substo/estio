#!/usr/bin/env bash
# This harness uses only a disposable local socket and synthetic grant data.
set -euo pipefail
studio_socket=$1
studio_logs=$2
studio_psql=(env -u PGSERVICE -u PGHOSTADDR -u PGOPTIONS psql --no-psqlrc --host="$studio_socket" --port=55439 --username=studio_test --dbname=postgres --set=ON_ERROR_STOP=1 --set=VERBOSITY=verbose)
"${studio_psql[@]}" <<'SQL' >"$studio_logs/youtube-race-setup.log"
select public.studio_create_substo_location('c3100000-0000-4000-8000-000000000001','YouTube revoke race','yt-race-owner');
select public.studio_save_schedule('c3100000-0000-4000-8000-000000000001','c3300000-0000-4000-8000-000000000001',0,'substo','yt-race-owner','youtube-discovery','Public query',24,'09:00');
insert into public.platform_google_youtube_connections(app,clerk_user_id,client_id,refresh_cipher,granted_scopes,version) values('substo','yt-race-owner','client','{"ciphertext":"sealed","iv":"iv","authTag":"tag","keyId":"v1"}',array['https://www.googleapis.com/auth/youtube.readonly'],'c3500000-0000-4000-8000-000000000001');
select public.studio_enable_youtube_schedule('c3100000-0000-4000-8000-000000000001','substo','yt-race-owner','c3300000-0000-4000-8000-000000000001',1,0,'c3500000-0000-4000-8000-000000000002','c3500000-0000-4000-8000-000000000001','search','','Race research',true);
update public.studio_schedule_recurring set next_run_at=clock_timestamp()-interval '1 minute' where location_id='c3100000-0000-4000-8000-000000000001';
select public.studio_dispatch_schedule(location_id,schedule_id,activation_token,next_run_at,true) from public.studio_schedule_recurring where location_id='c3100000-0000-4000-8000-000000000001';
select public.studio_claim_jobs('youtube-race-worker',50,60);
select public.studio_begin_youtube_discovery(r.location_id,r.id,r.job_id,j.lease_owner,j.lease_token) from public.studio_youtube_schedule_runs r join public.studio_jobs j on j.id=r.job_id where r.location_id='c3100000-0000-4000-8000-000000000001';
SQL
"${studio_psql[@]}" <<'SQL' >"$studio_logs/youtube-race-a.log" 2>&1 &
begin;
select public.platform_clear_youtube_connection('substo','yt-race-owner');
\echo REMOVED
do $$ declare n integer; begin
 for n in 1..250 loop
  perform pg_stat_clear_snapshot();
  if exists(select 1 from pg_stat_activity where application_name='studio-youtube-late-finish' and wait_event='advisory') then return; end if;
  perform pg_sleep(0.02);
 end loop;
 raise exception 'Late discovery result did not reach the profile fence';
end $$;
commit;
SQL
studio_a=$!
studio_ready=false
for studio_poll in {1..100}; do
 if rg -q '^REMOVED$' "$studio_logs/youtube-race-a.log"; then studio_ready=true; break; fi
 sleep 0.02
done
if [[ "$studio_ready" != true ]]; then wait "$studio_a" || true; cat "$studio_logs/youtube-race-a.log"; exit 1; fi
PGAPPNAME=studio-youtube-late-finish "${studio_psql[@]}" <<'SQL' >"$studio_logs/youtube-race-b.log" 2>&1 &
select public.studio_finish_youtube_discovery(r.location_id,r.id,r.job_id,j.lease_owner,j.lease_token,'["aaaaaaaaaaa"]') from public.studio_youtube_schedule_runs r join public.studio_jobs j on j.id=r.job_id where r.location_id='c3100000-0000-4000-8000-000000000001';
SQL
studio_b=$!
wait "$studio_a" || { cat "$studio_logs/youtube-race-a.log"; exit 1; }
if wait "$studio_b"; then echo 'Late discovery result bypassed profile removal' >&2; exit 1; fi
rg -q '42501' "$studio_logs/youtube-race-b.log"
"${studio_psql[@]}" <<'SQL'
do $$ begin
 if exists(select 1 from public.studio_records where location_id='c3100000-0000-4000-8000-000000000001')
 or exists(select 1 from public.platform_youtube_schedule_authorizations where location_id='c3100000-0000-4000-8000-000000000001')
 or exists(select 1 from public.studio_youtube_schedule_runs where location_id='c3100000-0000-4000-8000-000000000001' and result is not null)
 or (select enabled from public.studio_schedule_recurring where location_id='c3100000-0000-4000-8000-000000000001') then raise exception 'Revocation race saved private-source results or retained consent'; end if;
end $$;
select 'Studio YouTube profile revocation concurrency assertions passed' as result;
SQL
