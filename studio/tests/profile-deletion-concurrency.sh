#!/usr/bin/env bash
# Synthetic OAuth callback state on the disposable PostgreSQL socket only.
set -euo pipefail
studio_socket=$1
studio_logs=$2
studio_psql=(env -u PGSERVICE -u PGHOSTADDR -u PGOPTIONS psql --no-psqlrc --host="$studio_socket" --port=55439 --username=studio_test --dbname=postgres --set=ON_ERROR_STOP=1 --set=VERBOSITY=verbose)
"${studio_psql[@]}" <<'SQL' >"$studio_logs/profile-delete-race-setup.log"
select public.platform_youtube_oauth('begin','substo','user_delete_race',repeat('a',64),repeat('b',64));
select public.platform_youtube_oauth('consume','substo','user_delete_race',repeat('a',64),repeat('b',64));
SQL
"${studio_psql[@]}" <<'SQL' >"$studio_logs/profile-delete-race-a.log" 2>&1 &
begin;
select public.platform_delete_profile('substo','user_delete_race','msg_delete_race','2026-10-24T00:00:00Z',repeat('c',64));
\echo DELETED
do $$ declare n integer; begin
 for n in 1..250 loop
  perform pg_stat_clear_snapshot();
  if (select count(*) from pg_stat_activity where application_name in ('studio-deleted-callback','studio-deleted-start') and wait_event='advisory')=2 then return; end if;
  perform pg_sleep(0.02);
 end loop;
 raise exception 'Concurrent callback/start did not reach profile deletion fence';
end $$;
commit;
SQL
studio_a=$!
studio_ready=false
for studio_poll in {1..100}; do
 if rg -q '^DELETED$' "$studio_logs/profile-delete-race-a.log"; then studio_ready=true; break; fi
 sleep 0.02
done
if [[ "$studio_ready" != true ]]; then wait "$studio_a" || true; cat "$studio_logs/profile-delete-race-a.log"; exit 1; fi
PGAPPNAME=studio-deleted-callback "${studio_psql[@]}" <<'SQL' >"$studio_logs/profile-delete-race-b.log" 2>&1 &
select public.platform_youtube_oauth('commit','substo','user_delete_race',repeat('a',64),repeat('b',64),'{"ciphertext":"late","iv":"iv","authTag":"tag","keyId":"v1"}','client',array['https://www.googleapis.com/auth/youtube.readonly']);
SQL
studio_b=$!
PGAPPNAME=studio-deleted-start "${studio_psql[@]}" <<'SQL' >"$studio_logs/profile-delete-race-c.log" 2>&1 &
select public.platform_youtube_oauth('begin','substo','user_delete_race',repeat('d',64),repeat('e',64));
SQL
studio_c=$!
wait "$studio_a" || { cat "$studio_logs/profile-delete-race-a.log"; exit 1; }
wait "$studio_b" || { cat "$studio_logs/profile-delete-race-b.log"; exit 1; }
wait "$studio_c" || { cat "$studio_logs/profile-delete-race-c.log"; exit 1; }
rg -q '^ f$' "$studio_logs/profile-delete-race-b.log"
rg -q '^ f$' "$studio_logs/profile-delete-race-c.log"
"${studio_psql[@]}" <<'SQL'
do $$ begin
 if exists(select 1 from public.platform_google_youtube_connections where app='substo' and clerk_user_id='user_delete_race')
 or exists(select 1 from public.platform_google_youtube_oauth_states where app='substo' and clerk_user_id='user_delete_race')
 or not exists(select 1 from public.platform_profile_deletions where app='substo' and clerk_user_id='user_delete_race')
 or (select count(*) from public.platform_profile_deletion_events where app='substo' and clerk_user_id='user_delete_race')<>1 then raise exception 'OAuth resurrected deleted profile or duplicated deletion event'; end if;
end $$;
select 'Platform profile deletion/callback concurrency assertions passed' as result;
SQL
