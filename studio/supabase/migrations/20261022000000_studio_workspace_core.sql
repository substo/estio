-- Hosted Studio foundation. Apply only to the dedicated Substo Supabase project.
-- Estio's business database is intentionally not referenced by foreign keys.

begin;

create table if not exists public.studio_locations (
  -- The CRM Location ID (Prisma `Location.id`, in the separate CRM database).
  -- Studio data belongs to the Location directly; this row exists for foreign
  -- keys and the app check.
  location_id text primary key check (btrim(location_id) <> ''),
  app text not null check (app in ('estio', 'substo')),
  name text not null check (btrim(name) <> ''),
  created_by_clerk_user_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint studio_locations_location_app_unique unique (location_id, app)
);

create index if not exists studio_locations_app_created_idx
  on public.studio_locations (app, created_at desc);

create table if not exists public.studio_location_memberships (
  id uuid primary key default gen_random_uuid(),
  location_id text not null,
  location_app text not null default 'substo' check (location_app = 'substo'),
  clerk_user_id text not null check (btrim(clerk_user_id) <> ''),
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint studio_location_memberships_location_app_fk
    foreign key (location_id, location_app)
    references public.studio_locations (location_id, app)
    on delete cascade,
  constraint studio_location_memberships_location_user_unique
    unique (location_id, clerk_user_id),
  constraint studio_location_memberships_id_location_unique
    unique (id, location_id)
);

create index if not exists studio_location_memberships_user_idx
  on public.studio_location_memberships (clerk_user_id, location_id);

create table if not exists public.studio_location_invitations (
  id uuid primary key default gen_random_uuid(),
  location_id text not null,
  location_app text not null default 'substo' check (location_app = 'substo'),
  email text not null check (btrim(email) <> ''),
  role text not null default 'member' check (role in ('admin', 'member')),
  token_hash text not null unique check (btrim(token_hash) <> ''),
  invited_by_clerk_user_id text not null check (btrim(invited_by_clerk_user_id) <> ''),
  accepted_by_clerk_user_id text,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint studio_location_invitations_location_app_fk
    foreign key (location_id, location_app)
    references public.studio_locations (location_id, app)
    on delete cascade,
  constraint studio_location_invitations_acceptance_check check (
    (accepted_at is null and accepted_by_clerk_user_id is null)
    or
    (accepted_at is not null and accepted_by_clerk_user_id is not null and btrim(accepted_by_clerk_user_id) <> '')
  ),
  constraint studio_location_invitations_not_accepted_and_revoked_check
    check (accepted_at is null or revoked_at is null)
);

create index if not exists studio_location_invitations_location_email_idx
  on public.studio_location_invitations (location_id, lower(email), created_at desc);

create index if not exists studio_location_invitations_pending_expiry_idx
  on public.studio_location_invitations (location_id, expires_at)
  where accepted_at is null and revoked_at is null;

create table if not exists public.studio_media_objects (
  id uuid primary key default gen_random_uuid(),
  location_id text not null references public.studio_locations (location_id) on delete cascade,
  bucket_id text not null default 'studio-media' check (bucket_id = 'studio-media'),
  object_key text not null,
  original_filename text not null check (btrim(original_filename) <> ''),
  content_type text,
  byte_size bigint check (byte_size is null or byte_size >= 0),
  sha256 text,
  created_by_clerk_user_id text,
  created_at timestamptz not null default now(),
  constraint studio_media_objects_location_prefix_check
    check (split_part(object_key, '/', 1) = location_id::text and btrim(object_key) <> ''),
  constraint studio_media_objects_bucket_key_unique unique (bucket_id, object_key),
  constraint studio_media_objects_id_location_unique unique (id, location_id)
);

create index if not exists studio_media_objects_location_created_idx
  on public.studio_media_objects (location_id, created_at desc);

-- RLS is enabled with no client data-access policies. Only trusted server-side
-- operations using the Supabase service role may access these tables. Application
-- authorization must still resolve access from Clerk and Estio location roles.
alter table public.studio_locations enable row level security;
alter table public.studio_location_memberships enable row level security;
alter table public.studio_location_invitations enable row level security;
alter table public.studio_media_objects enable row level security;

revoke all on table public.studio_locations from anon, authenticated;
revoke all on table public.studio_location_memberships from anon, authenticated;
revoke all on table public.studio_location_invitations from anon, authenticated;
revoke all on table public.studio_media_objects from anon, authenticated;

grant all on table public.studio_locations to service_role;
grant all on table public.studio_location_memberships to service_role;
grant all on table public.studio_location_invitations to service_role;
grant all on table public.studio_media_objects to service_role;

create or replace function public.studio_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function public.studio_set_updated_at() from public, anon, authenticated;
grant execute on function public.studio_set_updated_at() to service_role;

drop trigger if exists studio_locations_set_updated_at on public.studio_locations;
create trigger studio_locations_set_updated_at
before update on public.studio_locations
for each row execute function public.studio_set_updated_at();

drop trigger if exists studio_location_memberships_set_updated_at on public.studio_location_memberships;
create trigger studio_location_memberships_set_updated_at
before update on public.studio_location_memberships
for each row execute function public.studio_set_updated_at();

-- The bucket is private. Restrictive policies prevent broad existing client storage
-- policies from exposing it. service_role bypasses RLS and issues signed URLs only
-- after server-side location authorization.
insert into storage.buckets (id, name, public)
values ('studio-media', 'studio-media', false)
on conflict (id) do update set public = false;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'studio_media_client_select_deny'
  ) then
    execute 'create policy studio_media_client_select_deny on storage.objects as restrictive for select to anon, authenticated using (bucket_id <> ''studio-media'')';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'studio_media_client_insert_deny'
  ) then
    execute 'create policy studio_media_client_insert_deny on storage.objects as restrictive for insert to anon, authenticated with check (bucket_id <> ''studio-media'')';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'studio_media_client_update_deny'
  ) then
    execute 'create policy studio_media_client_update_deny on storage.objects as restrictive for update to anon, authenticated using (bucket_id <> ''studio-media'') with check (bucket_id <> ''studio-media'')';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'studio_media_client_delete_deny'
  ) then
    execute 'create policy studio_media_client_delete_deny on storage.objects as restrictive for delete to anon, authenticated using (bucket_id <> ''studio-media'')';
  end if;
end;
$$;

-- Create the Substo location and its first owner atomically. Callers supply and
-- reuse p_location_id as an idempotency key if the request outcome is uncertain.
create or replace function public.studio_create_substo_location(
  p_location_id text,
  p_name text,
  p_clerk_user_id text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_location public.studio_locations%rowtype;
  v_owner_role text;
begin
  if p_location_id is null
     or p_name is null
     or pg_catalog.btrim(p_name) = ''
     or p_clerk_user_id is null
     or pg_catalog.btrim(p_clerk_user_id) = '' then
    raise exception 'Location ID, name, and Clerk user ID are required'
      using errcode = '22023';
  end if;

  insert into public.studio_locations (
    location_id, app, name, created_by_clerk_user_id
  ) values (
    p_location_id, 'substo', pg_catalog.btrim(p_name), pg_catalog.btrim(p_clerk_user_id)
  )
  on conflict (location_id) do nothing;

  select * into v_location
  from public.studio_locations
  where location_id = p_location_id
  for update;

  if not found
     or v_location.app <> 'substo'
     or v_location.name <> pg_catalog.btrim(p_name)
     or v_location.created_by_clerk_user_id is distinct from pg_catalog.btrim(p_clerk_user_id) then
    raise exception 'Location ID is already used by a different location or creator'
      using errcode = '23505';
  end if;

  insert into public.studio_location_memberships (
    location_id, location_app, clerk_user_id, role
  ) values (
    p_location_id, 'substo', pg_catalog.btrim(p_clerk_user_id), 'owner'
  )
  on conflict (location_id, clerk_user_id) do nothing;

  select role into v_owner_role
  from public.studio_location_memberships
  where location_id = p_location_id
    and clerk_user_id = pg_catalog.btrim(p_clerk_user_id);

  if v_owner_role is distinct from 'owner' then
    raise exception 'Location creator already has a non-owner membership'
      using errcode = '23514';
  end if;

  return p_location_id;
end;
$$;

revoke all on function public.studio_create_substo_location(text, text, text) from public, anon, authenticated;
grant execute on function public.studio_create_substo_location(text, text, text) to service_role;

-- Accept an invitation only after the caller has validated the Clerk email as
-- verified. The row lock makes acceptance and membership insertion one atomic,
-- retry-safe transaction for a given token and Clerk user.
create or replace function public.studio_accept_substo_invitation(
  p_token_hash text,
  p_verified_email text,
  p_clerk_user_id text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invitation public.studio_location_invitations%rowtype;
  v_membership_id uuid;
begin
  if p_token_hash is null
     or pg_catalog.btrim(p_token_hash) = ''
     or p_verified_email is null
     or pg_catalog.btrim(p_verified_email) = ''
     or p_clerk_user_id is null
     or pg_catalog.btrim(p_clerk_user_id) = '' then
    raise exception 'Invitation token hash, verified email, and Clerk user ID are required'
      using errcode = '22023';
  end if;

  select * into v_invitation
  from public.studio_location_invitations
  where token_hash = pg_catalog.btrim(p_token_hash)
  for update;

  if not found then
    raise exception 'Invitation is invalid'
      using errcode = 'P0002';
  end if;

  if pg_catalog.lower(pg_catalog.btrim(v_invitation.email))
     <> pg_catalog.lower(pg_catalog.btrim(p_verified_email)) then
    raise exception 'Verified email does not match invitation'
      using errcode = '42501';
  end if;

  if v_invitation.accepted_at is not null then
    if v_invitation.accepted_by_clerk_user_id is distinct from pg_catalog.btrim(p_clerk_user_id) then
      raise exception 'Invitation has already been accepted by another user'
        using errcode = '42501';
    end if;

    select id into v_membership_id
    from public.studio_location_memberships
    where location_id = v_invitation.location_id
      and clerk_user_id = pg_catalog.btrim(p_clerk_user_id);

    if v_membership_id is null then
      raise exception 'Accepted invitation has no matching location membership'
        using errcode = '23514';
    end if;
    return v_membership_id;
  end if;

  if v_invitation.revoked_at is not null or v_invitation.expires_at <= pg_catalog.now() then
    raise exception 'Invitation is revoked or expired'
      using errcode = 'P0002';
  end if;

  insert into public.studio_location_memberships (
    location_id, location_app, clerk_user_id, role
  ) values (
    v_invitation.location_id,
    'substo',
    pg_catalog.btrim(p_clerk_user_id),
    v_invitation.role
  )
  on conflict (location_id, clerk_user_id) do nothing;

  select id into v_membership_id
  from public.studio_location_memberships
  where location_id = v_invitation.location_id
    and clerk_user_id = pg_catalog.btrim(p_clerk_user_id);

  if v_membership_id is null then
    raise exception 'Location membership could not be established'
      using errcode = '23514';
  end if;

  update public.studio_location_invitations
  set accepted_at = pg_catalog.now(),
      accepted_by_clerk_user_id = pg_catalog.btrim(p_clerk_user_id)
  where id = v_invitation.id
    and accepted_at is null
    and revoked_at is null;

  return v_membership_id;
end;
$$;

revoke all on function public.studio_accept_substo_invitation(text, text, text) from public, anon, authenticated;
grant execute on function public.studio_accept_substo_invitation(text, text, text) to service_role;

commit;

