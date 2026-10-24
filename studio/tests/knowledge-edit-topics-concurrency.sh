#!/usr/bin/env bash
# Synthetic fixtures on the disposable harness's Unix socket only.
set -euo pipefail
studio_socket=$1
studio_logs=$2
studio_psql=(env -u PGSERVICE -u PGHOSTADDR -u PGOPTIONS psql --no-psqlrc --host="$studio_socket" --port=55439 --username=studio_test --dbname=postgres --set=ON_ERROR_STOP=1 --set=VERBOSITY=verbose)
"${studio_psql[@]}" <<'SQL' >"$studio_logs/knowledge-edit-race-setup.log"
select public.studio_create_substo_workspace('d2100000-0000-4000-8000-000000000001','Knowledge race','knowledge-race-owner');
insert into public.studio_records(workspace_id,id,kind,title,payload) select 'd2100000-0000-4000-8000-000000000001',('d2200000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'reference','Race source '||n,'{}' from generate_series(1,3) n;
insert into public.studio_knowledge_sources(workspace_id,id,payload,total_units,covered_units) select 'd2100000-0000-4000-8000-000000000001',('d2200000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'{}',0,0 from generate_series(1,3) n;
insert into public.studio_knowledge_insights(workspace_id,id,source_id,status,statement,payload) select 'd2100000-0000-4000-8000-000000000001',('d2300000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('d2200000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'pending','Original statement '||n,'{"kind":"claim","legacy":"preserved"}' from generate_series(1,3) n;
SQL
"${studio_psql[@]}" <<'SQL' >"$studio_logs/knowledge-topic-race-a.log" 2>&1 &
begin;
select public.studio_mutate_knowledge_insight('d2100000-0000-4000-8000-000000000001','substo','knowledge-race-owner','d2300000-0000-4000-8000-000000000001','d2500000-0000-4000-8000-000000000001',1,'approve',null,'{"mode":"create","name":"Shared Topic"}','');
\echo LOCKED
do $$ declare n integer; begin
 for n in 1..250 loop
  perform pg_stat_clear_snapshot();
  if exists(select 1 from pg_stat_activity where application_name='studio-knowledge-topic-b' and wait_event='advisory') then return; end if;
  perform pg_sleep(0.02);
 end loop;
 raise exception 'Concurrent independent-source approval did not reach the topic lock';
end $$;
commit;
SQL
studio_a=$!
studio_ready=false
for studio_poll in {1..100}; do
 if rg -q '^LOCKED$' "$studio_logs/knowledge-topic-race-a.log"; then studio_ready=true; break; fi
 sleep 0.02
done
if [[ "$studio_ready" != true ]]; then wait "$studio_a" || true; cat "$studio_logs/knowledge-topic-race-a.log"; exit 1; fi
PGAPPNAME=studio-knowledge-topic-b "${studio_psql[@]}" <<'SQL' >"$studio_logs/knowledge-topic-race-b.log" 2>&1 &
select public.studio_mutate_knowledge_insight('d2100000-0000-4000-8000-000000000001','substo','knowledge-race-owner','d2300000-0000-4000-8000-000000000002','d2500000-0000-4000-8000-000000000002',1,'approve',null,'{"mode":"create","name":" shared   TOPIC "}','');
SQL
studio_b=$!
wait "$studio_a" || { cat "$studio_logs/knowledge-topic-race-a.log"; exit 1; }
wait "$studio_b" || { cat "$studio_logs/knowledge-topic-race-b.log"; exit 1; }
"${studio_psql[@]}" <<'SQL' >"$studio_logs/knowledge-edit-race-a.log" 2>&1 &
begin;
select public.studio_mutate_knowledge_insight('d2100000-0000-4000-8000-000000000001','substo','knowledge-race-owner','d2300000-0000-4000-8000-000000000003','d2500000-0000-4000-8000-000000000003',1,'edit','Committed human correction','{"mode":"keep"}','');
\echo LOCKED
do $$ declare n integer; begin
 for n in 1..250 loop
  perform pg_stat_clear_snapshot();
  if exists(select 1 from pg_stat_activity where application_name='studio-knowledge-edit-b' and wait_event='advisory') then return; end if;
  perform pg_sleep(0.02);
 end loop;
 raise exception 'Stale approval did not reach the source lock';
end $$;
commit;
SQL
studio_a=$!
studio_ready=false
for studio_poll in {1..100}; do
 if rg -q '^LOCKED$' "$studio_logs/knowledge-edit-race-a.log"; then studio_ready=true; break; fi
 sleep 0.02
done
if [[ "$studio_ready" != true ]]; then wait "$studio_a" || true; cat "$studio_logs/knowledge-edit-race-a.log"; exit 1; fi
PGAPPNAME=studio-knowledge-edit-b "${studio_psql[@]}" <<'SQL' >"$studio_logs/knowledge-edit-race-b.log" 2>&1 &
select public.studio_mutate_knowledge_insight('d2100000-0000-4000-8000-000000000001','substo','knowledge-race-owner','d2300000-0000-4000-8000-000000000003','d2500000-0000-4000-8000-000000000004',1,'approve',null,'{"mode":"create","name":"Orphan Topic"}','');
SQL
studio_b=$!
wait "$studio_a" || { cat "$studio_logs/knowledge-edit-race-a.log"; exit 1; }
if wait "$studio_b"; then echo 'Stale approval overwrote the committed human edit' >&2; exit 1; fi
rg -q '40001' "$studio_logs/knowledge-edit-race-b.log"
"${studio_psql[@]}" <<'SQL'
do $$ begin
 if (select count(*) from public.studio_knowledge_topics where workspace_id='d2100000-0000-4000-8000-000000000001')<>1
 or (select count(distinct topic_id) from public.studio_knowledge_insights where workspace_id='d2100000-0000-4000-8000-000000000001' and status='approved')<>1
 or (select count(*) from public.studio_knowledge_insights where workspace_id='d2100000-0000-4000-8000-000000000001' and status='approved')<>2
 or (select count(*) from public.studio_knowledge_topic_names where workspace_id='d2100000-0000-4000-8000-000000000001')<>1
 or (select statement from public.studio_knowledge_insights where workspace_id='d2100000-0000-4000-8000-000000000001' and id='d2300000-0000-4000-8000-000000000003')<>'Committed human correction'
 or (select status from public.studio_knowledge_insights where workspace_id='d2100000-0000-4000-8000-000000000001' and id='d2300000-0000-4000-8000-000000000003')<>'pending'
 or (select count(*) from public.studio_knowledge_commands where workspace_id='d2100000-0000-4000-8000-000000000001')<>3
 or (select count(*) from public.studio_knowledge_reviews where workspace_id='d2100000-0000-4000-8000-000000000001')<>3 then raise exception 'Knowledge concurrency duplicated topics, lost edit or appended false audit'; end if;
end $$;
select 'Studio knowledge topic/edit concurrency assertions passed' as result;
SQL
