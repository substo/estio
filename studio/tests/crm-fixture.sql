-- Test-only stand-in for the CRM tables Studio reads (Prisma owns the real ones).
-- Only the columns Studio's views and foreign keys use are created.
create role anon;
create role authenticated;
create role service_role bypassrls;
create type public."AuthRealm" as enum ('estio', 'substo');
create type public."UserRole" as enum ('ADMIN', 'MEMBER');
create table public."Location" (
  id text primary key,
  "authRealm" public."AuthRealm" not null default 'estio',
  name text,
  "createdAt" timestamp(3) not null default current_timestamp,
  "updatedAt" timestamp(3) not null default current_timestamp
);
create table public."User" (
  id text primary key,
  "authRealm" public."AuthRealm" not null default 'estio',
  "clerkId" text,
  email text not null,
  unique ("authRealm", "clerkId")
);
create table public."UserLocationRole" (
  id text primary key,
  "userId" text not null references public."User"(id) on delete cascade,
  "locationId" text not null references public."Location"(id) on delete cascade,
  role public."UserRole" not null default 'MEMBER',
  "createdAt" timestamp(3) not null default current_timestamp,
  "updatedAt" timestamp(3) not null default current_timestamp,
  unique ("userId", "locationId")
);
create table public."_LocationToUser" (
  "A" text not null references public."Location"(id) on delete cascade,
  "B" text not null references public."User"(id) on delete cascade,
  primary key ("A", "B")
);
