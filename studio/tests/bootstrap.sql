-- Minimal Supabase Storage surface for exercising our migrations on fresh PG.
create role anon;
create role authenticated;
create role service_role bypassrls;
create schema storage;
grant usage on schema storage to anon,authenticated,service_role;
create table storage.buckets(id text primary key,name text,public boolean);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id));
alter table storage.objects enable row level security;
grant all on storage.buckets,storage.objects to anon,authenticated,service_role;
create policy broad_legacy_policy on storage.objects to anon,authenticated using(true) with check(true);
