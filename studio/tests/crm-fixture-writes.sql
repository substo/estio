-- Test-only writers, applied after the Studio migration. Production never writes
-- these views: Locations and their teams are created by the CRM (Prisma).

-- A Location row for a fixture. Upserts, so suites may create the same ID twice.
create function public.test_location(p_location_id text, p_app text, p_name text default 'Test location')
returns text language sql as $$
  insert into public."Location"(id, "authRealm", name) values (p_location_id, p_app::public."AuthRealm", p_name)
  on conflict (id) do update set name = excluded.name
  returning id
$$;

-- A team member of a Location: CRM user, connection and role (the real membership).
create function public.test_member(p_location_id text, p_clerk_user_id text, p_role text)
returns void language plpgsql as $$
declare v_realm public."AuthRealm"; v_user text;
begin
  select "authRealm" into strict v_realm from public."Location" where id = p_location_id;
  insert into public."User"(id, "authRealm", "clerkId", email)
    values (v_realm || ':' || p_clerk_user_id, v_realm, p_clerk_user_id, p_clerk_user_id || '@test.invalid')
    on conflict (id) do nothing;
  v_user := v_realm || ':' || p_clerk_user_id;
  insert into public."_LocationToUser"("A", "B") values (p_location_id, v_user) on conflict do nothing;
  insert into public."UserLocationRole"(id, "userId", "locationId", role)
    values (gen_random_uuid()::text, v_user, p_location_id, case when p_role in ('owner', 'admin') then 'ADMIN' else 'MEMBER' end::public."UserRole")
    on conflict ("userId", "locationId") do update set role = excluded.role;
end $$;

-- The suites' former provisioning call: a Substo Location whose creator is its admin.
create function studio.studio_create_substo_location(p_location_id text, p_name text, p_clerk_user_id text)
returns text language plpgsql as $$
begin
  if exists (select 1 from public."Location" where id = p_location_id) then
    -- Idempotent for its creator; another account cannot claim the same ID.
    if exists (select 1 from studio.studio_location_members where location_id = p_location_id and clerk_user_id = p_clerk_user_id and role = 'owner') then
      return p_location_id;
    end if;
    raise exception 'Location already exists.' using errcode = '23505';
  end if;
  perform public.test_location(p_location_id, 'substo', p_name);
  perform public.test_member(p_location_id, p_clerk_user_id, 'admin');
  return p_location_id;
end $$;

create function public.test_locations_insert() returns trigger language plpgsql as $$
begin perform public.test_location(new.location_id, new.app, coalesce(new.name, 'Test location')); return new; end $$;
create trigger test_locations_insert instead of insert on studio.studio_locations
  for each row execute function public.test_locations_insert();

create function public.test_members_write() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    delete from public."UserLocationRole" r using public."User" u
      where r."userId" = u.id and r."locationId" = old.location_id and u."clerkId" = old.clerk_user_id;
    return old;
  end if;
  perform public.test_member(new.location_id, new.clerk_user_id, coalesce(new.role, 'member'));
  return new;
end $$;
create trigger test_members_write instead of insert or update or delete on studio.studio_location_members
  for each row execute function public.test_members_write();

-- PostgREST-era privilege assertions run as these roles; production grants them nothing.
grant usage on schema studio to anon, authenticated, service_role;
