do $$
declare
 w uuid:='d1100000-0000-4000-8000-000000000001'; other_w uuid:='d1100000-0000-4000-8000-000000000002';
 src uuid:='d1200000-0000-4000-8000-000000000001'; insight uuid:='d1300000-0000-4000-8000-000000000001';
 second uuid:='d1300000-0000-4000-8000-000000000002'; third uuid:='d1300000-0000-4000-8000-000000000003'; fourth uuid:='d1300000-0000-4000-8000-000000000004';
 legacy_topic uuid:='d1400000-0000-4000-8000-000000000001'; foreign_topic uuid:='d1400000-0000-4000-8000-000000000002';
 req uuid:=gen_random_uuid(); result jsonb; replay jsonb; assigned uuid; old_payload jsonb; old_source jsonb; old_evidence jsonb; old_topic jsonb;
 statement text:=E'  Café method.\nExact reviewed wording 🌿  '; count_before integer; table_name text; op text;
begin
 foreach table_name in array array['studio_knowledge_topics','studio_knowledge_topic_names','studio_knowledge_commands'] loop
  foreach op in array array['INSERT','UPDATE','DELETE','TRUNCATE'] loop
   if has_table_privilege('service_role','public.'||table_name,op) then raise exception 'Unsafe knowledge direct writes'; end if;
  end loop;
  if has_table_privilege('authenticated','public.'||table_name,'SELECT') then raise exception 'Knowledge table exposed'; end if;
 end loop;
 if has_function_privilege('authenticated','public.studio_mutate_knowledge_insight(uuid,text,text,uuid,uuid,bigint,text,text,jsonb,text)','EXECUTE')
 or has_function_privilege('service_role','public.studio_resolve_knowledge_topic(uuid,text,text,text)','EXECUTE') then raise exception 'Unsafe knowledge RPC grants'; end if;
 perform public.studio_create_substo_workspace(w,'Knowledge edit fixture','knowledge-editor');
 perform public.studio_create_substo_workspace(other_w,'Other knowledge fixture','knowledge-other');
 insert into public.studio_workspace_memberships(workspace_id,workspace_brand,clerk_user_id,role) values(w,'substo','knowledge-member','member');
 perform public.studio_save_record(w,src,'reference','Exact source','{"notes":"Do not change source"}',0,'knowledge-editor');
 old_source:='{"title":"Exact source","unknown":{"keep":true}}';
 old_payload:='{"kind":"method","statement":"Original imported statement","suggested_topic":"AI workflows","legacy":{"untouched":true}}';
 old_evidence:='{"quote":"  Exact evidence 🌿\n","start_sec":0.5,"frame_file":"original.jpg","unknown":{"keep":true}}';
 old_topic:='{"name":"AI workflows","name_key":"ai workflows","legacy_topic":true}';
 insert into public.studio_knowledge_sources(workspace_id,id,payload,total_units,covered_units) values(w,src,old_source,10,4);
 insert into public.studio_knowledge_topics(workspace_id,id,payload) values(w,legacy_topic,old_topic),(other_w,foreign_topic,'{"name":"Other topic"}');
 insert into public.studio_knowledge_insights(workspace_id,id,source_id,status,statement,payload) values
 (w,insight,src,'pending','Original imported statement',old_payload),(w,second,src,'pending','Second distinct method',old_payload),
 (w,third,src,'pending','Third distinct method',old_payload),(w,fourth,src,'pending','Fourth distinct method',old_payload);
 insert into public.studio_knowledge_evidence(workspace_id,id,insight_id,source_id,payload) values(w,gen_random_uuid(),insight,src,old_evidence);
 insert into public.studio_knowledge_reviews(workspace_id,id,insight_id,payload) values(w,gen_random_uuid(),insight,'{"action":"imported","at":"2020-01-01","legacy_review":true}');
 begin perform public.studio_mutate_knowledge_insight(w,'estio','knowledge-editor',insight,req,1,'edit',statement,'{"mode":"keep"}','');
 raise exception 'Wrong realm edited'; exception when insufficient_privilege then null; end;
 begin perform public.studio_mutate_knowledge_insight(w,'substo','knowledge-other',insight,req,1,'edit',statement,'{"mode":"keep"}','');
 raise exception 'Outsider edited'; exception when insufficient_privilege then null; end;
 begin perform public.studio_mutate_knowledge_insight(other_w,'substo','knowledge-other',insight,req,1,'edit',statement,'{"mode":"keep"}','');
 raise exception 'Foreign insight edited'; exception when no_data_found then null; end;
 begin perform public.studio_mutate_knowledge_insight(w,'substo','knowledge-editor',insight,req,2,'edit',statement,'{"mode":"keep"}','');
 raise exception 'Stale edit'; exception when serialization_failure then null; end;
 begin perform public.studio_mutate_knowledge_insight(w,'substo','knowledge-editor',insight,req,1,'approve',null,jsonb_build_object('mode','existing','id',foreign_topic),'');
 raise exception 'Foreign topic assigned'; exception when invalid_parameter_value then null; end;
 begin perform public.studio_mutate_knowledge_insight(w,'substo','knowledge-editor',insight,req,1,'approve',null,'{"mode":"keep"}','');
 raise exception 'Topic-less approval'; exception when invalid_parameter_value then null; end;
 result:=public.studio_mutate_knowledge_insight(w,'substo','knowledge-member',insight,req,1,'edit',statement,'{"mode":"keep"}',E'  Exact note\n');
 replay:=result;
 if result->>'version'<>'2' or result->>'status'<>'pending'
 or (select i.statement from public.studio_knowledge_insights i where workspace_id=w and id=insight)<>statement then raise exception 'Lossy statement edit'; end if;
 if (select payload->>'previous_statement' from public.studio_knowledge_reviews where id=(result->>'reviewId')::uuid)<>'Original imported statement'
 or (select payload->>'new_statement' from public.studio_knowledge_reviews where id=(result->>'reviewId')::uuid)<>statement
 or (select payload->>'reason' from public.studio_knowledge_reviews where id=(result->>'reviewId')::uuid)<>E'  Exact note\n' then raise exception 'Incomplete edit audit'; end if;
 begin perform public.studio_mutate_knowledge_insight(w,'substo','knowledge-member',insight,req,1,'edit','Changed request','{"mode":"keep"}','');
 raise exception 'Request reused'; exception when unique_violation then null; end;
 -- A pending statement edit and approval/topic resolve commit together.
 result:=public.studio_mutate_knowledge_insight(w,'substo','knowledge-editor',insight,gen_random_uuid(),2,'approve','New approved wording',
  '{"mode":"create","name":" aI   Workflows "}','Review complete');
 if result->>'status'<>'approved' or result->>'version'<>'3' or (result->>'topicId')::uuid<>legacy_topic
 or (select payload from public.studio_knowledge_topics where workspace_id=w and id=legacy_topic)<>old_topic then raise exception 'Legacy topic was not reused exactly'; end if;
 if public.studio_mutate_knowledge_insight(w,'substo','knowledge-member',insight,req,1,'edit',statement,'{"mode":"keep"}',E'  Exact note\n')<>replay
 or (select i.statement from public.studio_knowledge_insights i where workspace_id=w and id=insight)<>'New approved wording' then raise exception 'Replay overwrote later approval'; end if;
 result:=public.studio_mutate_knowledge_insight(w,'substo','knowledge-editor',insight,gen_random_uuid(),3,'edit','Edited after approval','{"mode":"keep"}','');
 if result->>'status'<>'pending' or result->>'version'<>'4' or (result->>'topicId')::uuid<>legacy_topic then raise exception 'Editing silently retained approval or lost topic'; end if;
 begin perform public.studio_mutate_knowledge_insight(w,'substo','knowledge-editor',insight,gen_random_uuid(),4,'edit','Second distinct method','{"mode":"keep"}','');
 raise exception 'Edit duplicated source/kind/statement'; exception when unique_violation then null; end;
 result:=public.studio_mutate_knowledge_insight(w,'substo','knowledge-editor',insight,gen_random_uuid(),4,'reject',null,'{"mode":"keep"}','');
 result:=public.studio_mutate_knowledge_insight(w,'substo','knowledge-editor',insight,gen_random_uuid(),5,'reopen',null,'{"mode":"keep"}','');
 result:=public.studio_mutate_knowledge_insight(w,'substo','knowledge-editor',insight,gen_random_uuid(),6,'approve',null,jsonb_build_object('mode','existing','id',legacy_topic),'');
 if result->>'version'<>'7' then raise exception 'Existing topic approval failed'; end if;
 result:=public.studio_mutate_knowledge_insight(w,'substo','knowledge-editor',second,gen_random_uuid(),1,'approve',null,'{"mode":"create","name":"New Methods"}','');
 assigned:=(result->>'topicId')::uuid;
 result:=public.studio_mutate_knowledge_insight(w,'substo','knowledge-member',third,gen_random_uuid(),1,'approve',null,'{"mode":"create","name":" new   METHODS "}','');
 if (result->>'topicId')::uuid<>assigned or (select count(*) from public.studio_knowledge_topics where workspace_id=w)<>2 then raise exception 'Hosted topic duplicate'; end if;
 -- No original payload/evidence/source/imported review is updated.
 if (select payload from public.studio_knowledge_insights where workspace_id=w and id=insight)<>old_payload
 or (select payload from public.studio_knowledge_sources where workspace_id=w and id=src)<>old_source
 or (select covered_units from public.studio_knowledge_sources where workspace_id=w and id=src)<>4
 or (select payload from public.studio_knowledge_evidence where workspace_id=w and insight_id=insight)<>old_evidence
 or not exists(select 1 from public.studio_knowledge_reviews where workspace_id=w and insight_id=insight and payload='{"action":"imported","at":"2020-01-01","legacy_review":true}') then raise exception 'Edit/review modified provenance'; end if;
 -- Force failure after creating a topic and changing the insight: all must roll back.
 count_before:=(select count(*) from public.studio_knowledge_topics where workspace_id=w);
 alter table public.studio_knowledge_reviews add constraint knowledge_edit_forced_failure check (payload->>'origin' is distinct from 'hosted') not valid;
 begin perform public.studio_mutate_knowledge_insight(w,'substo','knowledge-editor',fourth,gen_random_uuid(),1,'approve','Failed statement','{"mode":"create","name":"Must roll back"}','');
 raise exception 'Forced failure did not fire'; exception when check_violation then null; end;
 alter table public.studio_knowledge_reviews drop constraint knowledge_edit_forced_failure;
 if (select count(*) from public.studio_knowledge_topics where workspace_id=w)<>count_before
 or exists(select 1 from public.studio_knowledge_topic_names where workspace_id=w and name_key='must roll back')
 or (select version from public.studio_knowledge_insights where workspace_id=w and id=fourth)<>1
 or exists(select 1 from public.studio_knowledge_commands where workspace_id=w and insight_id=fourth) then raise exception 'Failed audit left partial edit/topic/command'; end if;
 -- Imported duplicate names remain distinct; creation refuses an ambiguous guess.
 insert into public.studio_knowledge_topics(workspace_id,id,payload) values(w,gen_random_uuid(),'{"name":"Ambiguous"}'),(w,gen_random_uuid(),'{"name":" ambiguous "}');
 begin perform public.studio_mutate_knowledge_insight(w,'substo','knowledge-editor',fourth,gen_random_uuid(),1,'approve',null,'{"mode":"create","name":"AMBIGUOUS"}','');
 raise exception 'Ambiguous legacy topics silently merged'; exception when invalid_parameter_value then null; end;
 -- Legacy status endpoint now safely assigns the suggestion too.
 result:=public.studio_review_knowledge_insight(w,fourth,'approve',1,'substo','knowledge-editor','Legacy tab');
 if (result->>'topicId')::uuid<>legacy_topic or result->>'status'<>'approved' then raise exception 'Legacy approval bypassed topic assignment'; end if;
 insert into public.studio_knowledge_insights(workspace_id,id,source_id,status,statement,payload) values(w,gen_random_uuid(),src,'pending','Fifth distinct method',old_payload) returning id into assigned;
 select id into legacy_topic from public.studio_knowledge_topics where workspace_id=w and payload->>'name'='Ambiguous';
 result:=public.studio_mutate_knowledge_insight(w,'substo','knowledge-editor',assigned,gen_random_uuid(),1,'approve',null,jsonb_build_object('mode','existing','id',legacy_topic),'Explicit ambiguous ID');
 if (result->>'topicId')::uuid<>legacy_topic then raise exception 'Explicit imported topic ID not respected'; end if;
 begin perform 1 from public.studio_find_knowledge_topics(w,'substo','knowledge-other','');
 raise exception 'Outsider searched workspace topics'; exception when insufficient_privilege then null; end;
 select topic_id into assigned from public.studio_knowledge_insights where workspace_id=w and id=second;
 if not exists(select 1 from public.studio_find_knowledge_topics(w,'substo','knowledge-editor','New') where id=assigned) then raise exception 'Topic lookup missed names'; end if;
 delete from public.studio_workspace_memberships where workspace_id=w and clerk_user_id='knowledge-member';
 begin perform public.studio_mutate_knowledge_insight(w,'substo','knowledge-member',insight,req,1,'edit',statement,'{"mode":"keep"}',E'  Exact note\n');
 raise exception 'Revoked member replayed command'; exception when insufficient_privilege then null; end;
end $$;
select 'Studio knowledge edit/topic assertions passed' as result;
