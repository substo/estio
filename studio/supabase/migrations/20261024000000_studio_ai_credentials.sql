-- Customer-supplied AI keys and per-location spend caps. The application
-- encrypts keys (AES-256-GCM, STUDIO_SECRETS_KEY) before they reach this
-- database; plaintext never enters SQL. Hosted AI work must reserve budget
-- before calling the provider and settle actual cost afterwards.
begin;

create table public.studio_location_ai_credentials (
  location_id text not null references public.studio_locations(location_id) on delete cascade,
  provider text not null check (provider in ('openai')),
  ciphertext text not null check (ciphertext ~ '^[A-Za-z0-9+/]+={0,2}$'),
  iv text not null check (iv ~ '^[A-Za-z0-9+/]{16}$'),
  auth_tag text not null check (auth_tag ~ '^[A-Za-z0-9+/]{22}==$'),
  key_id text not null check (key_id ~ '^[a-z0-9_-]{1,32}$'),
  key_hint text not null check (key_hint ~ '^[A-Za-z0-9_-]{4}$'),
  version bigint not null default 1,
  set_by_clerk_user_id text not null,
  set_at timestamptz not null default now(),
  primary key (location_id,provider)
);

create table public.studio_location_ai_settings (
  location_id text primary key references public.studio_locations(location_id) on delete cascade,
  -- Zero disables hosted AI spend. Micro-USD avoids float rounding.
  monthly_budget_micros bigint not null default 0 check (monthly_budget_micros between 0 and 100000000000),
  version bigint not null default 1,
  updated_by_clerk_user_id text not null,
  updated_at timestamptz not null default now()
);

create table public.studio_ai_usage (
  id uuid primary key default gen_random_uuid(),
  location_id text not null references public.studio_locations(location_id) on delete cascade,
  provider text not null check (provider in ('openai')),
  operation text not null check (operation ~ '^[a-z][a-z0-9_.-]{0,63}$'),
  status text not null check (status in ('reserved','settled','released')),
  reserved_micros bigint not null check (reserved_micros >= 0),
  cost_micros bigint check (cost_micros is null or cost_micros >= 0),
  model text check (model is null or model ~ '^[A-Za-z0-9._:-]{1,100}$'),
  input_tokens bigint check (input_tokens is null or input_tokens >= 0),
  output_tokens bigint check (output_tokens is null or output_tokens >= 0),
  audio_seconds numeric check (audio_seconds is null or audio_seconds >= 0),
  -- Reservations are charged to the month they were made in.
  usage_month date not null,
  reserved_at timestamptz not null default now(),
  settled_at timestamptz,
  check ((status = 'settled') = (cost_micros is not null and settled_at is not null))
);
create index studio_ai_usage_month_idx on public.studio_ai_usage(location_id,usage_month,status);

alter table public.studio_location_ai_credentials enable row level security;
alter table public.studio_location_ai_settings enable row level security;
alter table public.studio_ai_usage enable row level security;
revoke all on public.studio_location_ai_credentials, public.studio_location_ai_settings, public.studio_ai_usage from public,anon,authenticated,service_role;
grant select on public.studio_location_ai_credentials, public.studio_location_ai_settings, public.studio_ai_usage to service_role;

-- Settings require a location manager. Estio roles live in Business and are
-- checked by the server (location ADMIN); Substo owner/admin is locked here.
create function public.studio_lock_ai_manager(p_location_id text, p_actor_app text, p_clerk_user_id text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_app text;
begin
  if p_location_id is null or p_actor_app is null or p_actor_app not in ('estio','substo')
    or p_clerk_user_id is null or pg_catalog.btrim(p_clerk_user_id) = '' then
    raise exception 'Invalid AI settings actor' using errcode = '22023';
  end if;
  select app into v_app from public.studio_locations where location_id = p_location_id for update;
  if v_app is null or v_app <> p_actor_app then
    raise exception 'AI settings access denied' using errcode = '42501';
  end if;
  if v_app = 'substo' then
    perform 1 from public.studio_location_memberships where location_id = p_location_id and location_app = 'substo'
      and clerk_user_id = p_clerk_user_id and role in ('owner','admin') for share;
    if not found then raise exception 'AI settings require a location owner or admin' using errcode = '42501'; end if;
  end if;
end;
$$;
revoke all on function public.studio_lock_ai_manager(text,text,text) from public,anon,authenticated,service_role;

create function public.studio_set_ai_credential(
  p_location_id text, p_actor_app text, p_clerk_user_id text, p_provider text,
  p_ciphertext text, p_iv text, p_auth_tag text, p_key_id text, p_key_hint text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_row public.studio_location_ai_credentials%rowtype;
begin
  perform public.studio_lock_ai_manager(p_location_id, p_actor_app, p_clerk_user_id);
  insert into public.studio_location_ai_credentials(location_id,provider,ciphertext,iv,auth_tag,key_id,key_hint,set_by_clerk_user_id)
    values(p_location_id,p_provider,p_ciphertext,p_iv,p_auth_tag,p_key_id,p_key_hint,p_clerk_user_id)
    on conflict (location_id,provider) do update set ciphertext=excluded.ciphertext, iv=excluded.iv, auth_tag=excluded.auth_tag,
      key_id=excluded.key_id, key_hint=excluded.key_hint, version=public.studio_location_ai_credentials.version+1,
      set_by_clerk_user_id=excluded.set_by_clerk_user_id, set_at=pg_catalog.clock_timestamp()
    returning * into v_row;
  return pg_catalog.jsonb_build_object('provider',v_row.provider,'keyHint',v_row.key_hint,'version',v_row.version);
end;
$$;

create function public.studio_clear_ai_credential(p_location_id text, p_actor_app text, p_clerk_user_id text, p_provider text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  perform public.studio_lock_ai_manager(p_location_id, p_actor_app, p_clerk_user_id);
  delete from public.studio_location_ai_credentials where location_id=p_location_id and provider=p_provider;
  return found;
end;
$$;

create function public.studio_set_ai_budget(p_location_id text, p_actor_app text, p_clerk_user_id text, p_monthly_budget_micros bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_row public.studio_location_ai_settings%rowtype;
begin
  if p_monthly_budget_micros is null then raise exception 'Invalid budget' using errcode = '22023'; end if;
  perform public.studio_lock_ai_manager(p_location_id, p_actor_app, p_clerk_user_id);
  insert into public.studio_location_ai_settings(location_id,monthly_budget_micros,updated_by_clerk_user_id)
    values(p_location_id,p_monthly_budget_micros,p_clerk_user_id)
    on conflict (location_id) do update set monthly_budget_micros=excluded.monthly_budget_micros,
      version=public.studio_location_ai_settings.version+1, updated_by_clerk_user_id=excluded.updated_by_clerk_user_id, updated_at=pg_catalog.clock_timestamp()
    returning * into v_row;
  return pg_catalog.jsonb_build_object('monthlyBudgetMicros',v_row.monthly_budget_micros,'version',v_row.version);
end;
$$;

-- Atomically reserve estimated spend against this calendar month (UTC). The
-- settings row lock serializes concurrent reservations, so parallel workers
-- cannot jointly exceed the cap. Returns null when the cap would be exceeded.
create function public.studio_reserve_ai_spend(p_location_id text, p_provider text, p_operation text, p_estimated_micros bigint)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_budget bigint;
  v_month date := pg_catalog.date_trunc('month', pg_catalog.now() at time zone 'UTC')::date;
  v_used bigint;
  v_id uuid;
begin
  if p_estimated_micros is null or p_estimated_micros < 0 then raise exception 'Invalid estimate' using errcode = '22023'; end if;
  select monthly_budget_micros into v_budget from public.studio_location_ai_settings where location_id=p_location_id for update;
  if v_budget is null or v_budget = 0 then return null; end if;
  if not exists(select 1 from public.studio_location_ai_credentials where location_id=p_location_id and provider=p_provider) then return null; end if;
  select coalesce(pg_catalog.sum(case status when 'settled' then cost_micros when 'reserved' then reserved_micros else 0 end),0)
    into v_used from public.studio_ai_usage where location_id=p_location_id and usage_month=v_month;
  if v_used + p_estimated_micros > v_budget then return null; end if;
  insert into public.studio_ai_usage(location_id,provider,operation,status,reserved_micros,usage_month)
    values(p_location_id,p_provider,p_operation,'reserved',p_estimated_micros,v_month) returning id into v_id;
  return v_id;
end;
$$;

-- Record actual provider usage. Actual cost may exceed the estimate (that is
-- recorded honestly and counts against later reservations). Idempotent.
create function public.studio_settle_ai_spend(p_location_id text, p_usage_id uuid, p_cost_micros bigint,
  p_model text, p_input_tokens bigint, p_output_tokens bigint, p_audio_seconds numeric)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_row public.studio_ai_usage%rowtype;
begin
  if p_cost_micros is null or p_cost_micros < 0 then raise exception 'Invalid cost' using errcode = '22023'; end if;
  select * into v_row from public.studio_ai_usage where id=p_usage_id and location_id=p_location_id for update;
  if not found then raise exception 'Unknown AI usage reservation' using errcode = '22023'; end if;
  if v_row.status = 'settled' then
    if v_row.cost_micros <> p_cost_micros then raise exception 'AI usage already settled differently' using errcode = '23505'; end if;
    return pg_catalog.jsonb_build_object('id',v_row.id,'replayed',true);
  end if;
  update public.studio_ai_usage set status='settled', cost_micros=p_cost_micros, model=p_model, input_tokens=p_input_tokens,
    output_tokens=p_output_tokens, audio_seconds=p_audio_seconds, settled_at=pg_catalog.clock_timestamp()
    where id=p_usage_id returning * into v_row;
  return pg_catalog.jsonb_build_object('id',v_row.id,'replayed',false);
end;
$$;

-- A provider call that never started (or failed before billing) frees its hold.
create function public.studio_release_ai_spend(p_location_id text, p_usage_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update public.studio_ai_usage set status='released' where id=p_usage_id and location_id=p_location_id and status='reserved';
  return found;
end;
$$;

revoke all on function public.studio_set_ai_credential(text,text,text,text,text,text,text,text,text) from public,anon,authenticated;
revoke all on function public.studio_clear_ai_credential(text,text,text,text) from public,anon,authenticated;
revoke all on function public.studio_set_ai_budget(text,text,text,bigint) from public,anon,authenticated;
revoke all on function public.studio_reserve_ai_spend(text,text,text,bigint) from public,anon,authenticated;
revoke all on function public.studio_settle_ai_spend(text,uuid,bigint,text,bigint,bigint,numeric) from public,anon,authenticated;
revoke all on function public.studio_release_ai_spend(text,uuid) from public,anon,authenticated;
grant execute on function public.studio_set_ai_credential(text,text,text,text,text,text,text,text,text) to service_role;
grant execute on function public.studio_clear_ai_credential(text,text,text,text) to service_role;
grant execute on function public.studio_set_ai_budget(text,text,text,bigint) to service_role;
grant execute on function public.studio_reserve_ai_spend(text,text,text,bigint) to service_role;
grant execute on function public.studio_settle_ai_spend(text,uuid,bigint,text,bigint,bigint,numeric) to service_role;
grant execute on function public.studio_release_ai_spend(text,uuid) to service_role;
commit;
