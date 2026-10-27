#!/usr/bin/env bash
# Two independently generated runs, one source, one exact statement: no duplicate
# pending insight/evidence even when both application transactions overlap.
set -euo pipefail
studio_socket=$1
studio_logs=$2
studio_psql=(env -u PGSERVICE -u PGHOSTADDR -u PGOPTIONS psql --no-psqlrc --host="$studio_socket" --port=55439 --username=studio_test --dbname=postgres --set=ON_ERROR_STOP=1 --set=VERBOSITY=verbose)
"${studio_psql[@]}" <<'SQL' >"$studio_logs/extract-race-setup.log"
do $$ declare request_id uuid;outcome jsonb;j public.studio_jobs%rowtype;a uuid;begin
 foreach request_id in array array['bc500000-0000-4000-8000-000000000091'::uuid,'bc500000-0000-4000-8000-000000000092'::uuid] loop
  outcome:=public.studio_enqueue_knowledge_extraction('bc100000-0000-4000-8000-000000000001','substo','extract-owner',request_id,'bc200000-0000-4000-8000-000000000001',1,'record_text','transcript',1,1,'race',true);
  perform public.studio_claim_jobs('extract-race',50,60);select * into j from public.studio_jobs where id=(outcome->>'jobId')::uuid;
  a:=(public.studio_begin_text_run_attempt(j.location_id,(outcome->>'reviewId')::uuid,j.id,j.lease_owner,j.lease_token)->>'attempt_id')::uuid;
  perform public.studio_finish_text_run_attempt(j.location_id,(outcome->>'reviewId')::uuid,j.id,j.lease_owner,j.lease_token,a,
   '{"findings":[{"kind":"claim","unitId":"record_text:transcript:1","statement":"Concurrent extracted claim","suggestedTopic":"Source","quote":"café"}]}',1000,1000,'resp_race','gpt-6-luna-standard-2026-10-23');
  perform public.studio_complete_job(j.id,j.lease_owner,j.lease_token,'{}');
 end loop;
end $$;
SQL
"${studio_psql[@]}" <<'SQL' >"$studio_logs/extract-race-a.log" 2>&1 &
begin;
select pg_advisory_xact_lock(hashtextextended('knowledge-apply:bc100000-0000-4000-8000-000000000001:bc200000-0000-4000-8000-000000000001',0));
\echo LOCKED
-- Wait until B is actually blocked on the serialization lock, not a fixed delay.
do $$ declare n integer;begin
 for n in 1..250 loop
  perform pg_stat_clear_snapshot();
  if exists(select 1 from pg_stat_activity where application_name='studio-extraction-b' and wait_event='advisory') then return;end if;
  perform pg_sleep(0.02);
 end loop;
 raise exception 'Competing extraction application did not arrive';
end $$;
select public.studio_apply_knowledge_extraction(location_id,'substo','extract-owner',id,'bc500000-0000-4000-8000-000000000093',1,'[0]',true)
 from public.studio_idea_reviews where request_id='bc500000-0000-4000-8000-000000000091';
commit;
SQL
studio_a=$!
studio_ready=false
for studio_poll in {1..100};do
 if rg -q '^LOCKED$' "$studio_logs/extract-race-a.log";then studio_ready=true;break;fi
 sleep 0.02
done
if [[ "$studio_ready" != true ]];then wait "$studio_a" || true;cat "$studio_logs/extract-race-a.log";exit 1;fi
PGAPPNAME=studio-extraction-b "${studio_psql[@]}" <<'SQL' >"$studio_logs/extract-race-b.log" 2>&1 &
select public.studio_apply_knowledge_extraction(location_id,'substo','extract-owner',id,'bc500000-0000-4000-8000-000000000094',1,'[0]',true)
 from public.studio_idea_reviews where request_id='bc500000-0000-4000-8000-000000000092';
SQL
studio_b=$!
wait "$studio_a" || { cat "$studio_logs/extract-race-a.log";exit 1; }
wait "$studio_b" || { cat "$studio_logs/extract-race-b.log";exit 1; }
"${studio_psql[@]}" <<'SQL'
do $$ declare insight uuid;begin
 if (select count(*) from public.studio_knowledge_insights where location_id='bc100000-0000-4000-8000-000000000001' and statement='Concurrent extracted claim')<>1 then raise exception 'Concurrent extraction duplicated knowledge';end if;
 select id into insight from public.studio_knowledge_insights where location_id='bc100000-0000-4000-8000-000000000001' and statement='Concurrent extracted claim';
 if (select count(*) from public.studio_knowledge_evidence where location_id='bc100000-0000-4000-8000-000000000001' and insight_id=insight)<>1
  or (select count(*) from public.studio_knowledge_extraction_findings where location_id='bc100000-0000-4000-8000-000000000001' and insight_id=insight)<>2
  or (select count(*) from public.studio_knowledge_extraction_findings where location_id='bc100000-0000-4000-8000-000000000001' and insight_id=insight and reused)<>1 then
  raise exception 'Concurrent extraction failed exact-match reuse';end if;
end $$;
select 'Studio knowledge extraction concurrency assertions passed' as result;
SQL
