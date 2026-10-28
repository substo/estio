#!/usr/bin/env bash
# Called only by the disposable harness, with its private Unix socket directory.
set -euo pipefail
studio_socket=$1
studio_logs=$2
studio_psql=(env -u PGSERVICE -u PGHOSTADDR -u PGOPTIONS psql --no-psqlrc --host="$studio_socket" --port=55439 --username=studio_test --dbname=postgres --set=ON_ERROR_STOP=1 --set=VERBOSITY=verbose)
"${studio_psql[@]}" <<'SQL' >"$studio_logs/concurrent-setup.log"
select studio.studio_create_substo_location('e1000000-0000-4000-8000-000000000001','Concurrent review','concurrent-owner');
insert into studio.studio_records(location_id,id,kind,title,payload)
  values('e1000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000001','content','Audio','{}');
insert into studio.studio_location_ai_credentials(location_id,provider,ciphertext,iv,auth_tag,key_id,key_hint,set_by_clerk_user_id)
  values('e1000000-0000-4000-8000-000000000001','openai','YQ==','AAAAAAAAAAAAAAAA','AAAAAAAAAAAAAAAAAAAAAA==','v1','test','concurrent-owner');
select studio.studio_set_ai_budget('e1000000-0000-4000-8000-000000000001','substo','concurrent-owner',1000000);
select studio.studio_create_upload('e1000000-0000-4000-8000-000000000001','substo','concurrent-owner','e3000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000001','test.ogg','audio/ogg',100,'studio-media');
select studio.studio_complete_upload('e1000000-0000-4000-8000-000000000001','substo','concurrent-owner','e3000000-0000-4000-8000-000000000001',100);
select studio.studio_claim_jobs('concurrent-worker',50,60);
select studio.studio_begin_transcription_attempt(location_id,(payload->>'uploadId')::uuid,id,'concurrent-worker',lease_token,0,10)
  from studio.studio_jobs where location_id='e1000000-0000-4000-8000-000000000001';
update studio.studio_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where location_id='e1000000-0000-4000-8000-000000000001';
SQL
# Session A holds the actual job serialization lock while the other sessions
# attempt a competing review and a late worker result.
"${studio_psql[@]}" <<'SQL' >"$studio_logs/concurrent-a.log" 2>&1 &
begin;
select id from studio.studio_jobs where location_id='e1000000-0000-4000-8000-000000000001' for update;
\echo LOCKED
select pg_sleep(0.5);
select studio.studio_review_transcription_attempt(location_id,'substo','concurrent-owner',id,'e4000000-0000-4000-8000-000000000001',1,'no_charge','Synthetic provider support case confirms no charge for this exact request.',0,false)
  from studio.studio_transcription_attempts where location_id='e1000000-0000-4000-8000-000000000001';
commit;
SQL
studio_a=$!
studio_ready=false
for studio_poll in {1..100}; do
  if rg -q '^LOCKED$' "$studio_logs/concurrent-a.log"; then studio_ready=true; break; fi
  sleep 0.02
done
if [[ "$studio_ready" != true ]]; then wait "$studio_a" || true; cat "$studio_logs/concurrent-a.log"; exit 1; fi
"${studio_psql[@]}" <<'SQL' >"$studio_logs/concurrent-b.log" 2>&1 &
select studio.studio_review_transcription_attempt(location_id,'substo','concurrent-owner',id,'e4000000-0000-4000-8000-000000000002',1,'billed','Synthetic conflicting billing record for a stale manager review.',1000,false)
  from studio.studio_transcription_attempts where location_id='e1000000-0000-4000-8000-000000000001';
SQL
studio_b=$!
"${studio_psql[@]}" <<'SQL' >"$studio_logs/concurrent-worker.log" 2>&1 &
select studio.studio_finish_transcription_attempt(location_id,upload_id,job_id,worker_id,lease_token,id,'late result','[]')
  from studio.studio_transcription_attempts where location_id='e1000000-0000-4000-8000-000000000001';
SQL
studio_c=$!
wait "$studio_a"
if wait "$studio_b"; then echo 'Competing stale manager review succeeded' >&2; exit 1; fi
if wait "$studio_c"; then echo 'Expired worker saved a reconciled result' >&2; exit 1; fi
rg -q '40001' "$studio_logs/concurrent-b.log"
rg -q '40001' "$studio_logs/concurrent-worker.log"
"${studio_psql[@]}" <<'SQL'
do $$ begin
  if (select count(*) from studio.studio_transcription_reviews where location_id='e1000000-0000-4000-8000-000000000001') <> 1
    or exists(select 1 from studio.studio_transcript_chunks where location_id='e1000000-0000-4000-8000-000000000001')
    or (select status from studio.studio_ai_usage where location_id='e1000000-0000-4000-8000-000000000001') <> 'released' then
    raise exception 'Concurrent reconciliation violated billing/result isolation'; end if;
end $$;
select 'Studio reconciliation concurrency assertions passed' as result;
SQL
