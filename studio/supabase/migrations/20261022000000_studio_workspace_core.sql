-- Hosted Studio foundation. Apply only to the dedicated Substo Supabase project.
-- Estio's business database is intentionally not referenced by foreign keys.

begin;

create table if not exists public.studio_workspaces (
  id uuid primary key default gen_random_uuid(),
  brand text not null check (brand in ('estio', 'substo')),
  workspace_type text not null check (workspace_type in ('estio_location', 'substo_standalone')),
  name text not null check (btrim(name) <> ''),
  -- Estio location IDs live in Estio's separate database, so this is an external key.
  estio_location_id text,
  created_by_clerk_user_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint studio_workspaces_brand_type_location_check check (
    (brand = 'estio' and workspace_type = 'estio_location' and estio_location_id is not null and btrim(estio_location_id) <> '')
    or
    (brand = 'substo' and workspace_type = 'substo_standalone' and estio_location_id is null)
  ),
  constraint studio_workspaces_id_brand_unique unique (id, brand)
);

create unique index if not exists studio_workspaces_estio_location_unique_idx
  on public.studio_workspaces (estio_location_id)
  where brand = 'estio' and estio_location_id is not null;

create index if not exists studio_workspaces_brand_created_idx
  on public.studio_workspaces (brand, created_at desc);

create table if not exists public.studio_workspace_memberships (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  workspace_brand text not null default 'substo' check (workspace_brand = 'substo'),
  clerk_user_id text not null check (btrim(clerk_user_id) <> ''),
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint studio_workspace_memberships_workspace_brand_fk
    foreign key (workspace_id, workspace_brand)
    references public.studio_workspaces (id, brand)
    on delete cascade,
  constraint studio_workspace_memberships_workspace_user_unique
    unique (workspace_id, clerk_user_id),
  constraint studio_workspace_memberships_id_workspace_unique
    unique (id, workspace_id)
);

create index if not exists studio_workspace_memberships_user_idx
  on public.studio_workspace_memberships (clerk_user_id, workspace_id);

create table if not exists public.studio_workspace_invitations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  workspace_brand text not null default 'substo' check (workspace_brand = 'substo'),
  email text not null check (btrim(email) <> ''),
  role text not null default 'member' check (role in ('admin', 'member')),
  token_hash text not null unique check (btrim(token_hash) <> ''),
  invited_by_clerk_user_id text not null check (btrim(invited_by_clerk_user_id) <> ''),
  accepted_by_clerk_user_id text,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint studio_workspace_invitations_workspace_brand_fk
    foreign key (workspace_id, workspace_brand)
    references public.studio_workspaces (id, brand)
    on delete cascade,
  constraint studio_workspace_invitations_acceptance_check check (
    (accepted_at is null and accepted_by_clerk_user_id is null)
    or
    (accepted_at is not null and accepted_by_clerk_user_id is not null and btrim(accepted_by_clerk_user_id) <> '')
  ),
  constraint studio_workspace_invitations_not_accepted_and_revoked_check
    check (accepted_at is null or revoked_at is null)
);

create index if not exists studio_workspace_invitations_workspace_email_idx
  on public.studio_workspace_invitations (workspace_id, lower(email), created_at desc);

create index if not exists studio_workspace_invitations_pending_expiry_idx
  on public.studio_workspace_invitations (workspace_id, expires_at)
  where accepted_at is null and revoked_at is null;

create table if not exists public.studio_media_objects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.studio_workspaces (id) on delete cascade,
  bucket_id text not null default 'studio-media' check (bucket_id = 'studio-media'),
  object_key text not null,
  original_filename text not null check (btrim(original_filename) <> ''),
  content_type text,
  byte_size bigint check (byte_size is null or byte_size >= 0),
  sha256 text,
  created_by_clerk_user_id text,
  created_at timestamptz not null default now(),
  constraint studio_media_objects_workspace_prefix_check
    check (split_part(object_key, '/', 1) = workspace_id::text and btrim(object_key) <> ''),
  constraint studio_media_objects_bucket_key_unique unique (bucket_id, object_key),
  constraint studio_media_objects_id_workspace_unique unique (id, workspace_id)
);

create index if not exists studio_media_objects_workspace_created_idx
  on public.studio_media_objects (workspace_id, created_at desc);

-- RLS is enabled with no client data-access policies. Only trusted server-side
-- operations using the Supabase service role may access these tables. Application
-- authorization must still resolve access from Clerk and Estio location roles.
alter table public.studio_workspaces enable row level security;
alter table public.studio_workspace_memberships enable row level security;
alter table public.studio_workspace_invitations enable row level security;
alter table public.studio_media_objects enable row level security;

revoke all on table public.studio_workspaces from anon, authenticated;
revoke all on table public.studio_workspace_memberships from anon, authenticated;
revoke all on table public.studio_workspace_invitations from anon, authenticated;
revoke all on table public.studio_media_objects from anon, authenticated;

grant all on table public.studio_workspaces to service_role;
grant all on table public.studio_workspace_memberships to service_role;
grant all on table public.studio_workspace_invitations to service_role;
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

drop trigger if exists studio_workspaces_set_updated_at on public.studio_workspaces;
create trigger studio_workspaces_set_updated_at
before update on public.studio_workspaces
for each row execute function public.studio_set_updated_at();

drop trigger if exists studio_workspace_memberships_set_updated_at on public.studio_workspace_memberships;
create trigger studio_workspace_memberships_set_updated_at
before update on public.studio_workspace_memberships
for each row execute function public.studio_set_updated_at();

-- The bucket is private. Restrictive policies prevent broad existing client storage
-- policies from exposing it. service_role bypasses RLS and issues signed URLs only
-- after server-side workspace authorization.
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

-- Create the Substo workspace and its first owner atomically. Callers supply and
-- reuse p_workspace_id as an idempotency key if the request outcome is uncertain.
create or replace function public.studio_create_substo_workspace(
  p_workspace_id uuid,
  p_name text,
  p_clerk_user_id text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace public.studio_workspaces%rowtype;
  v_owner_role text;
begin
  if p_workspace_id is null
     or p_name is null
     or pg_catalog.btrim(p_name) = ''
     or p_clerk_user_id is null
     or pg_catalog.btrim(p_clerk_user_id) = '' then
    raise exception 'Workspace ID, name, and Clerk user ID are required'
      using errcode = '22023';
  end if;

  insert into public.studio_workspaces (
    id, brand, workspace_type, name, created_by_clerk_user_id
  ) values (
    p_workspace_id, 'substo', 'substo_standalone', pg_catalog.btrim(p_name), pg_catalog.btrim(p_clerk_user_id)
  )
  on conflict (id) do nothing;

  select * into v_workspace
  from public.studio_workspaces
  where id = p_workspace_id
  for update;

  if not found
     or v_workspace.brand <> 'substo'
     or v_workspace.workspace_type <> 'substo_standalone'
     or v_workspace.name <> pg_catalog.btrim(p_name)
     or v_workspace.created_by_clerk_user_id is distinct from pg_catalog.btrim(p_clerk_user_id) then
    raise exception 'Workspace ID is already used by a different workspace or creator'
      using errcode = '23505';
  end if;

  insert into public.studio_workspace_memberships (
    workspace_id, workspace_brand, clerk_user_id, role
  ) values (
    p_workspace_id, 'substo', pg_catalog.btrim(p_clerk_user_id), 'owner'
  )
  on conflict (workspace_id, clerk_user_id) do nothing;

  select role into v_owner_role
  from public.studio_workspace_memberships
  where workspace_id = p_workspace_id
    and clerk_user_id = pg_catalog.btrim(p_clerk_user_id);

  if v_owner_role is distinct from 'owner' then
    raise exception 'Workspace creator already has a non-owner membership'
      using errcode = '23514';
  end if;

  return p_workspace_id;
end;
$$;

revoke all on function public.studio_create_substo_workspace(uuid, text, text) from public, anon, authenticated;
grant execute on function public.studio_create_substo_workspace(uuid, text, text) to service_role;

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
  v_invitation public.studio_workspace_invitations%rowtype;
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
  from public.studio_workspace_invitations
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
    from public.studio_workspace_memberships
    where workspace_id = v_invitation.workspace_id
      and clerk_user_id = pg_catalog.btrim(p_clerk_user_id);

    if v_membership_id is null then
      raise exception 'Accepted invitation has no matching workspace membership'
        using errcode = '23514';
    end if;
    return v_membership_id;
  end if;

  if v_invitation.revoked_at is not null or v_invitation.expires_at <= pg_catalog.now() then
    raise exception 'Invitation is revoked or expired'
      using errcode = 'P0002';
  end if;

  insert into public.studio_workspace_memberships (
    workspace_id, workspace_brand, clerk_user_id, role
  ) values (
    v_invitation.workspace_id,
    'substo',
    pg_catalog.btrim(p_clerk_user_id),
    v_invitation.role
  )
  on conflict (workspace_id, clerk_user_id) do nothing;

  select id into v_membership_id
  from public.studio_workspace_memberships
  where workspace_id = v_invitation.workspace_id
    and clerk_user_id = pg_catalog.btrim(p_clerk_user_id);

  if v_membership_id is null then
    raise exception 'Workspace membership could not be established'
      using errcode = '23514';
  end if;

  update public.studio_workspace_invitations
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

