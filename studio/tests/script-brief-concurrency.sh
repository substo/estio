#!/usr/bin/env bash
# Only the disposable harness's private Unix socket, never a configured target.
set -euo pipefail
studio_socket=$1
studio_logs=$2
studio_psql=(env -u PGSERVICE -u PGHOSTADDR -u PGOPTIONS psql --no-psqlrc --host="$studio_socket" --port=55439 --username=studio_test --dbname=postgres --set=ON_ERROR_STOP=1 --set=VERBOSITY=verbose)
"${studio_psql[@]}" <<'SQL' >"$studio_logs/brief-race-setup.log"
insert into public.studio_records(workspace_id,id,kind,title,payload) values('ab100000-0000-4000-8000-000000000001','ab200000-0000-4000-8000-000000000003','content','Race idea','{"stage":"idea","script":"Old race script"}');
insert into public.studio_record_links values('ab100000-0000-4000-8000-000000000001','ab200000-0000-4000-8000-000000000003','ab200000-0000-4000-8000-000000000002');
select public.studio_enqueue_script_brief('ab100000-0000-4000-8000-000000000001','substo','brief-owner','ab500000-0000-4000-8000-000000000009','[{"id":"ab200000-0000-4000-8000-000000000003","version":1}]','Race',true);
select public.studio_claim_jobs('brief-race',50,60);
select public.studio_begin_text_run_attempt(r.workspace_id,r.id,r.job_id,j.lease_owner,j.lease_token)
 from public.studio_idea_reviews r join public.studio_jobs j on j.id=r.job_id where r.request_id='ab500000-0000-4000-8000-000000000009';
select public.studio_finish_text_run_attempt(a.workspace_id,a.idea_review_id,a.job_id,a.worker_id,a.lease_token,a.id,
 '{"audiencePromise":"A useful method","angle":"A practical angle","hook":"Start here","outline":["Problem","Method"],"claims":[{"claim":"A claim to verify","sourceIds":[],"verificationNeeded":true}],"verificationGaps":["Verify this claim"],"script":"Generated race draft [VERIFY: claim]"}',1000,1000,'resp_race','gpt-6-luna-standard-2026-10-23')
 from public.studio_ai_attempts a join public.studio_idea_reviews r on r.id=a.idea_review_id where r.request_id='ab500000-0000-4000-8000-000000000009';
SQL
"${studio_psql[@]}" <<'SQL' >"$studio_logs/brief-race-a.log" 2>&1 &
begin;
select id from public.studio_idea_reviews where request_id='ab500000-0000-4000-8000-000000000009' for update;
\echo LOCKED
do $$ declare n integer; begin
  for n in 1..250 loop
    if (select version from public.studio_records where workspace_id='ab100000-0000-4000-8000-000000000001' and id='ab200000-0000-4000-8000-000000000003')=2 then return; end if;
    perform pg_sleep(0.02);
  end loop;
  raise exception 'Concurrent human edit did not arrive';
end $$;
select public.studio_apply_script_brief(workspace_id,'substo','brief-owner',id,'ab500000-0000-4000-8000-000000000010',1,true)
 from public.studio_idea_reviews where request_id='ab500000-0000-4000-8000-000000000009';
commit;
SQL
studio_a=$!
studio_ready=false
for studio_poll in {1..100}; do
  if rg -q '^LOCKED$' "$studio_logs/brief-race-a.log"; then studio_ready=true; break; fi
  sleep 0.02
done
if [[ "$studio_ready" != true ]]; then wait "$studio_a" || true; cat "$studio_logs/brief-race-a.log"; exit 1; fi
# A real independent human edit commits while application A holds its run lock.
"${studio_psql[@]}" <<'SQL' >"$studio_logs/brief-race-human.log"
update public.studio_records set version=version+1,payload=payload||'{"script":"Concurrent human script"}'
 where workspace_id='ab100000-0000-4000-8000-000000000001' and id='ab200000-0000-4000-8000-000000000003';
SQL
"${studio_psql[@]}" <<'SQL' >"$studio_logs/brief-race-b.log" 2>&1 &
select public.studio_apply_script_brief(workspace_id,'substo','brief-owner',id,'ab500000-0000-4000-8000-000000000011',1,true)
 from public.studio_idea_reviews where request_id='ab500000-0000-4000-8000-000000000009';
SQL
studio_b=$!
if wait "$studio_a"; then echo 'Application overwrote a concurrent human edit' >&2; exit 1; fi
if wait "$studio_b"; then echo 'Competing stale application succeeded' >&2; exit 1; fi
rg -q '40001' "$studio_logs/brief-race-a.log"
rg -q '40001' "$studio_logs/brief-race-b.log"
"${studio_psql[@]}" <<'SQL'
do $$ begin
 if (select payload->>'script' from public.studio_records where workspace_id='ab100000-0000-4000-8000-000000000001' and id='ab200000-0000-4000-8000-000000000003')<>'Concurrent human script'
 or exists(select 1 from public.studio_script_brief_applications where review_id=(select id from public.studio_idea_reviews where request_id='ab500000-0000-4000-8000-000000000009')) then
 raise exception 'Concurrent brief application lost a human edit or appended a false audit event'; end if;
end $$;
select 'Studio script application concurrency assertions passed' as result;
SQL
