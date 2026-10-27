begin;
insert into public.studio_locations(location_id,app,name)
values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','substo','Knowledge test');
insert into public.studio_records(location_id,id,kind,title,payload)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','cccccccc-cccc-4ccc-8ccc-cccccccccccc','reference','Knowledge source','{"url":"https://example.test"}');
insert into public.studio_knowledge_topics(location_id,id,payload)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','{"name":"Topic"}');
insert into public.studio_knowledge_sources(location_id,id,payload,total_units,covered_units)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','cccccccc-cccc-4ccc-8ccc-cccccccccccc','{"observed_at":"exact","transcription_id":"tx"}',12,8);
insert into public.studio_knowledge_insights(location_id,id,source_id,topic_id,status,statement,payload)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','dddddddd-dddd-4ddd-8ddd-dddddddddddd','cccccccc-cccc-4ccc-8ccc-cccccccccccc','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','approved','  exact statement  ','{"legacy":true}');
insert into public.studio_knowledge_evidence(location_id,id,insight_id,source_id,payload)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','dddddddd-dddd-4ddd-8ddd-dddddddddddd','cccccccc-cccc-4ccc-8ccc-cccccccccccc','{"quote":"verbatim","start_sec":2.5,"end_sec":4,"frame_file":"frame-01.jpg"}');
insert into public.studio_knowledge_reviews(location_id,id,insight_id,payload)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','ffffffff-ffff-4fff-8fff-ffffffffffff','dddddddd-dddd-4ddd-8ddd-dddddddddddd','{"previous_status":"pending","new_status":"approved","at":"original"}');
insert into public.studio_knowledge_source_unit_sidecars(location_id,id,source_id,transcription_id,payload)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','18181818-1818-4818-8818-181818181818','cccccccc-cccc-4ccc-8ccc-cccccccccccc','tx','{"recordId":"cccccccc-cccc-4ccc-8ccc-cccccccccccc","payload":{"transcriptionId":"tx","units":[]}}');
insert into public.studio_knowledge_source_units(location_id,id,sidecar_id,source_id,transcription_id,unit_index,payload)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','12121212-1212-4212-8212-121212121212','18181818-1818-4818-8818-181818181818','cccccccc-cccc-4ccc-8ccc-cccccccccccc','tx',3,'{"unit":{"text":"caption","audio_ref":"private","ocr":{"text":"caption"}}}');

do $$ begin
  begin
    insert into public.studio_knowledge_evidence(location_id,id,insight_id,source_id,payload)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','13131313-1313-4313-8313-131313131313','dddddddd-dddd-4ddd-8ddd-dddddddddddd','14141414-1414-4414-8414-141414141414','{}');
    raise exception 'cross-source evidence unexpectedly accepted';
  exception when foreign_key_violation then null;
  end;
  begin
    insert into public.studio_knowledge_insights(location_id,id,source_id,status,statement,payload)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','15151515-1515-4515-8515-151515151515','cccccccc-cccc-4ccc-8ccc-cccccccccccc','pending','x','{}');
    insert into public.studio_knowledge_evidence(location_id,id,insight_id,source_id,payload)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','16161616-1616-4616-8616-161616161616','15151515-1515-4515-8515-151515151515','17171717-1717-4717-8717-171717171717','{}');
    raise exception 'cross-location source relation unexpectedly accepted';
  exception when foreign_key_violation then null;
  end;
  begin
    insert into public.studio_knowledge_sources(location_id,id,payload,total_units,covered_units)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','19191919-1919-4919-8919-191919191919','{}',0,0);
    raise exception 'source without matching Studio record unexpectedly accepted';
  exception when foreign_key_violation then null;
  end;
  begin
    insert into public.studio_knowledge_source_unit_sidecars(location_id,id,source_id,transcription_id,payload)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','20202020-2020-4020-8020-202020202020','cccccccc-cccc-4ccc-8ccc-cccccccccccc','tx','{}');
    raise exception 'duplicate sidecar identity unexpectedly accepted';
  exception when unique_violation then null;
  end;
  begin
    insert into public.studio_knowledge_source_units(location_id,id,sidecar_id,source_id,transcription_id,unit_index,payload)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','21212121-2121-4121-8121-212121212121','18181818-1818-4818-8818-181818181818','cccccccc-cccc-4ccc-8ccc-cccccccccccc','other-tx',4,'{"unit":{"text":"misattributed"}}');
    raise exception 'unit with mismatched transcription unexpectedly accepted';
  exception when foreign_key_violation then null;
  end;
end $$;
rollback;
