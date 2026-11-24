-- Stop a video that is being made or changed. Real SQL against an isolated PostgreSQL cluster.
create function pg_temp.pair(w text,actor text,code text,hash text) returns uuid language plpgsql as $$
declare r jsonb; h text:=encode(sha256(convert_to(code,'UTF8')),'hex'); d uuid;
begin
 r:=studio.studio_device_pair_start('substo','Test Mac','macOS',h,code);
 perform studio.studio_device_pairing_action(w,'substo',actor,'approve',code,gen_random_uuid());
 r:=studio.studio_device_pair_poll('substo',(r->>'pairingId')::uuid,h,hash);d:=(r->>'deviceId')::uuid;
 update studio.studio_devices set processing_enabled=true,seen_at=clock_timestamp() where id=d;
 return d;
end $$;
create function pg_temp.fails(sql text) returns boolean language plpgsql as $$
begin execute sql; return false; exception when others then return true; end $$;
do $$
declare w text:='bb000000-0000-4000-8000-0000000000b1'; w2 text:='bb000000-0000-4000-8000-0000000000b2';
 d uuid; rec uuid:=gen_random_uuid(); rec2 uuid:=gen_random_uuid(); rec3 uuid:=gen_random_uuid();
 jq uuid; jr uuid; jdone uuid; jother uuid; tok uuid:=gen_random_uuid(); r jsonb; ext jsonb; s record;
 h1 text:=repeat('a',64);
begin
 perform studio.studio_create_substo_location(w,'Stop fixture','st-owner');
 perform studio.studio_create_substo_location(w2,'Other tenant','st-other');
 d:=pg_temp.pair(w,'st-owner','STPAAAAA',h1);
 if has_function_privilege('authenticated','studio.studio_stop_video(text,text,text,uuid)','EXECUTE')
  or not has_function_privilege('service_role','studio.studio_stop_video(text,text,text,uuid)','EXECUTE') then raise exception 'Unsafe stop grants'; end if;
 insert into studio.studio_records(location_id,id,kind,title,payload) values (w,rec,'content','Launch video','{"script":"Hi."}'),(w,rec2,'content','Other piece','{"script":"Hi."}'),(w2,rec3,'content','Foreign','{"script":"Hi."}');

 -- a queued assembly and a running edit on the same piece, a finished one, one on another piece
 jq:=(studio.studio_enqueue_job(w,'studio.video_assemble',jsonb_build_object('recordId',rec),'stop-q:'||gen_random_uuid(),'st-owner',1)).id;
 jr:=(studio.studio_enqueue_job(w,'studio.video_edit',jsonb_build_object('recordId',rec,'instruction','x'),'stop-r:'||gen_random_uuid(),'st-owner',1)).id;
 jdone:=(studio.studio_enqueue_job(w,'studio.video_edit',jsonb_build_object('recordId',rec,'instruction','old'),'stop-d:'||gen_random_uuid(),'st-owner',1)).id;
 jother:=(studio.studio_enqueue_job(w,'studio.video_assemble',jsonb_build_object('recordId',rec2),'stop-o:'||gen_random_uuid(),'st-owner',1)).id;
 update studio.studio_jobs set execution_target='device',device_id=d where id in (jq,jr,jdone,jother);
 update studio.studio_jobs set status='running',lease_owner='mac',lease_token=tok,lease_expires_at=clock_timestamp()+interval '2 minutes' where id=jr;
 update studio.studio_jobs set status='succeeded',finished_at=clock_timestamp() where id=jdone;

 -- the owner stops it: queued and running jobs of this piece are cancelled; the finished one and the other piece are not
 r:=studio.studio_stop_video(w,'substo','st-owner',rec);
 if (r->>'stopped')::int<>2 then raise exception 'Expected 2 stopped, got %',r; end if;
 select * into s from studio.studio_jobs where id=jq;
 if s.status<>'cancelled' or s.last_error_code<>'video_stopped' or s.finished_at is null then raise exception 'Queued job not cancelled'; end if;
 select * into s from studio.studio_jobs where id=jr;
 if s.status<>'cancelled' or s.lease_owner is not null or s.lease_expires_at is not null or s.last_error_code<>'video_stopped' then raise exception 'Running job not cancelled and released'; end if;
 if (select status from studio.studio_jobs where id=jdone)<>'succeeded' then raise exception 'A finished job was changed'; end if;
 if (select status from studio.studio_jobs where id=jother)<>'queued' then raise exception 'Another piece was stopped'; end if;

 -- the Mac's next lease renewal is refused (that is what aborts the agent), and it cannot report success afterwards
 begin
  ext:=studio.studio_video_assembly_device_command(h1,'substo','extend',jsonb_build_object('workerId','mac','jobId',jr,'leaseToken',tok,'leaseSeconds',120));
 exception when others then ext:=null; end;
 if coalesce(ext::text,'') ~ '"(held|extended|ok)": *true' then raise exception 'A stopped job could still renew its lease: %',ext; end if;
 begin perform studio.studio_video_assembly_device_command(h1,'substo','complete',jsonb_build_object('workerId','mac','jobId',jr,'leaseToken',tok,'result','{}'::jsonb)); exception when others then null; end;
 if (select status from studio.studio_jobs where id=jr)<>'cancelled' then raise exception 'A stopped job came back'; end if;

 -- nothing running: a calm zero, not an error
 r:=studio.studio_stop_video(w,'substo','st-owner',rec);
 if (r->>'stopped')::int<>0 then raise exception 'Expected 0 on a second stop, got %',r; end if;

 -- another tenant, a stranger, an unknown piece: refused, and nothing changes
 if not pg_temp.fails(format('select studio.studio_stop_video(%L,%L,%L,%L)',w,'substo','st-other',rec2)) then raise exception 'A member of another Location could stop this'; end if;
 if not pg_temp.fails(format('select studio.studio_stop_video(%L,%L,%L,%L)',w,'substo','st-owner',rec3)) then raise exception 'A piece of another Location was reachable'; end if;
 if not pg_temp.fails(format('select studio.studio_stop_video(%L,%L,%L,%L)',w,'substo','st-owner',gen_random_uuid())) then raise exception 'An unknown piece was accepted'; end if;
 if (select status from studio.studio_jobs where id=jother)<>'queued' then raise exception 'A refused call still changed a job'; end if;
end $$;
