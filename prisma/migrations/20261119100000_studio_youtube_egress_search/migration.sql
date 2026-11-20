BEGIN;
-- Related YouTube videos, tier 2: when the requesting account's Mac cannot search, the hosted worker may search in the
-- server's browser through the Location's connected device network (isolated gateway listener, YouTube/Google hosts only).
-- Admission is the same member + AI-manager authority as the Mac route. Hosted job, read-only, never paid, never retried.
CREATE FUNCTION studio.studio_enqueue_youtube_search_egress(p_location_id text,p_actor_app text,p_clerk_user_id text,p_command jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
declare q text:=btrim(coalesce(p_command->>'query','')); k text:=p_command->>'requestKey'; lim integer; j studio.studio_jobs%rowtype; why text:=p_command->>'macReason';
begin
 if jsonb_typeof(p_command) is distinct from 'object' or char_length(q) not between 1 and 160 or k is null or k !~ '^[A-Za-z0-9:._-]{1,120}$'
  or coalesce(p_command->>'limit','5') !~ '^[0-9]{1,2}$' or (why is not null and why !~ '^[A-Z0-9]{1,40}$') then raise exception 'Invalid YouTube search' using errcode='22023'; end if;
 lim:=coalesce(p_command->>'limit','5')::integer;
 if lim not between 3 and 12 then raise exception 'Invalid YouTube search' using errcode='22023'; end if;
 perform studio.studio_lock_location_member(p_location_id,p_actor_app,p_clerk_user_id);
 perform studio.studio_lock_ai_manager(p_location_id,p_actor_app,p_clerk_user_id);
 if (select count(*) from studio.studio_jobs where location_id=p_location_id and kind in ('studio.youtube_search','studio.youtube_search_egress') and created_by_clerk_user_id=p_clerk_user_id and created_at>clock_timestamp()-interval '1 minute')>=20
  then raise exception 'Too many searches' using errcode='YS005'; end if;
 j:=studio.studio_enqueue_job(p_location_id,'studio.youtube_search_egress',jsonb_strip_nulls(jsonb_build_object('query',q,'limit',lim,'macReason',why)),'ytegress:'||k,p_clerk_user_id,1);
 return jsonb_build_object('jobId',j.id,'status',j.status);
end $$;
REVOKE ALL ON FUNCTION studio.studio_enqueue_youtube_search_egress(text,text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION studio.studio_enqueue_youtube_search_egress(text,text,text,jsonb) TO service_role;
COMMIT;
