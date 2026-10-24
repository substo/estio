#!/usr/bin/env bash
# Called only by the disposable harness, with its private Unix socket directory.
set -euo pipefail
studio_socket=$1
studio_logs=$2
studio_psql=(env -u PGSERVICE -u PGHOSTADDR -u PGOPTIONS psql --no-psqlrc --host="$studio_socket" --port=55439 --username=studio_test --dbname=postgres --set=ON_ERROR_STOP=1 --set=VERBOSITY=verbose)
"${studio_psql[@]}" <<'SQL' >"$studio_logs/concurrent-setup.log"
select public.studio_create_substo_workspace('e1000000-0000-4000-8000-000000000001','Concurrent review','concurrent-owner');
insert into public.studio_records(workspace_id,id,kind,title,payload)
  values('e1000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000001','content','Audio','{}');
insert into public.studio_workspace_ai_credentials(workspace_id,provider,ciphertext,iv,auth_tag,key_id,key_hint,set_by_clerk_user_id)
  values('e1000000-0000-4000-8000-000000000001','openai','YQ==','AAAAAAAAAAAAAAAA','AAAAAAAAAAAAAAAAAAAAAA==','v1','test','concurrent-owner');
select public.studio_set_ai_budget('e1000000-0000-4000-8000-000000000001','substo','concurrent-owner',1000000);
select public.studio_create_upload('e1000000-0000-4000-8000-000000000001','substo','concurrent-owner','e3000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000001','test.ogg','audio/ogg',100,'studio-media');
select public.studio_complete_upload('e1000000-0000-4000-8000-000000000001','substo','concurrent-owner','e3000000-0000-4000-8000-000000000001',100);
select public.studio_claim_jobs('concurrent-worker',50,60);
select public.studio_begin_transcription_attempt(workspace_id,(payload->>'uploadId')::uuid,id,'concurrent-worker',lease_token,0,10)
  from public.studio_jobs where workspace_id='e1000000-0000-4000-8000-000000000001';
update public.studio_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where workspace_id='e1000000-0000-4000-8000-000000000001';
SQL
# Session A holds the actual job serialization lock while the other sessions
# attempt a competing review and a late worker result.
"${studio_psql[@]}" <<'SQL' >"$studio_logs/concurrent-a.log" 2>&1 &
begin;
select id from public.studio_jobs where workspace_id='e1000000-0000-4000-8000-000000000001' for update;
\echo LOCKED
select pg_sleep(0.5);
select public.studio_review_transcription_attempt(workspace_id,'substo','concurrent-owner',id,'e4000000-0000-4000-8000-000000000001',1,'no_charge','Synthetic provider support case confirms no charge for this exact request.',0,false)
  from public.studio_transcription_attempts where workspace_id='e1000000-0000-4000-8000-000000000001';
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
select public.studio_review_transcription_attempt(workspace_id,'substo','concurrent-owner',id,'e4000000-0000-4000-8000-000000000002',1,'billed','Synthetic conflicting billing record for a stale manager review.',1000,false)
  from public.studio_transcription_attempts where workspace_id='e1000000-0000-4000-8000-000000000001';
SQL
studio_b=$!
"${studio_psql[@]}" <<'SQL' >"$studio_logs/concurrent-worker.log" 2>&1 &
select public.studio_finish_transcription_attempt(workspace_id,upload_id,job_id,worker_id,lease_token,id,'late result','[]')
  from public.studio_transcription_attempts where workspace_id='e1000000-0000-4000-8000-000000000001';
SQL
studio_c=$!
wait "$studio_a"
if wait "$studio_b"; then echo 'Competing stale manager review succeeded' >&2; exit 1; fi
if wait "$studio_c"; then echo 'Expired worker saved a reconciled result' >&2; exit 1; fi
rg -q '40001' "$studio_logs/concurrent-b.log"
rg -q '40001' "$studio_logs/concurrent-worker.log"
"${studio_psql[@]}" <<'SQL'
do $$ begin
  if (select count(*) from public.studio_transcription_reviews where workspace_id='e1000000-0000-4000-8000-000000000001') <> 1
    or exists(select 1 from public.studio_transcript_chunks where workspace_id='e1000000-0000-4000-8000-000000000001')
    or (select status from public.studio_ai_usage where workspace_id='e1000000-0000-4000-8000-000000000001') <> 'released' then
    raise exception 'Concurrent reconciliation violated billing/result isolation'; end if;
end $$;
select 'Studio reconciliation concurrency assertions passed' as result;
SQL
