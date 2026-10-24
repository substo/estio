-- Canonical, workspace-scoped Substo knowledge data. Apply after library schema.
begin;

create table public.studio_knowledge_topics (
  workspace_id uuid not null references public.studio_workspaces(id) on delete cascade,
  id uuid not null,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  primary key (workspace_id,id)
);

create table public.studio_knowledge_sources (
  workspace_id uuid not null references public.studio_workspaces(id) on delete cascade,
  id uuid not null,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  total_units integer not null check (total_units >= 0),
  covered_units integer not null check (covered_units >= 0 and covered_units <= total_units),
  primary key (workspace_id,id),
  foreign key (workspace_id,id) references public.studio_records(workspace_id,id) on delete restrict
);

create table public.studio_knowledge_insights (
  workspace_id uuid not null references public.studio_workspaces(id) on delete cascade,
  id uuid not null,
  source_id uuid not null,
  topic_id uuid,
  status text not null check (status in ('pending','approved','rejected')),
  statement text not null,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  primary key (workspace_id,id),
  unique (workspace_id,id,source_id),
  foreign key (workspace_id,source_id) references public.studio_knowledge_sources(workspace_id,id) on delete restrict,
  foreign key (workspace_id,topic_id) references public.studio_knowledge_topics(workspace_id,id) on delete restrict
);

create table public.studio_knowledge_evidence (
  workspace_id uuid not null references public.studio_workspaces(id) on delete cascade,
  id uuid not null,
  insight_id uuid not null,
  source_id uuid not null,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  primary key (workspace_id,id),
  foreign key (workspace_id,insight_id,source_id) references public.studio_knowledge_insights(workspace_id,id,source_id) on delete cascade,
  foreign key (workspace_id,source_id) references public.studio_knowledge_sources(workspace_id,id) on delete restrict
);

create table public.studio_knowledge_reviews (
  workspace_id uuid not null references public.studio_workspaces(id) on delete cascade,
  id uuid not null,
  insight_id uuid not null,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  primary key (workspace_id,id),
  foreign key (workspace_id,insight_id) references public.studio_knowledge_insights(workspace_id,id) on delete cascade
);

-- Keep each original sidecar envelope once; units reference it by ID so
-- transcript-sized arrays are not duplicated once per unit.
create table public.studio_knowledge_source_unit_sidecars (
  workspace_id uuid not null references public.studio_workspaces(id) on delete cascade,
  id uuid not null,
  source_id uuid not null,
  transcription_id text not null,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  primary key (workspace_id,id),
  unique (workspace_id,id,source_id,transcription_id),
  unique (workspace_id,source_id,transcription_id),
  foreign key (workspace_id,source_id) references public.studio_knowledge_sources(workspace_id,id) on delete cascade
);

-- Unit text, timestamps and frame references remain opaque evidence payloads;
-- media bytes and paths are reconciled separately before storage upload.
create table public.studio_knowledge_source_units (
  workspace_id uuid not null references public.studio_workspaces(id) on delete cascade,
  id uuid not null,
  sidecar_id uuid not null,
  source_id uuid not null,
  transcription_id text not null,
  unit_index integer not null check (unit_index >= 0),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  primary key (workspace_id,id),
  unique (workspace_id,sidecar_id,unit_index),
  foreign key (workspace_id,sidecar_id,source_id,transcription_id) references public.studio_knowledge_source_unit_sidecars(workspace_id,id,source_id,transcription_id) on delete cascade
);

create index studio_knowledge_insights_status_idx on public.studio_knowledge_insights(workspace_id,status,id);
create index studio_knowledge_insights_topic_idx on public.studio_knowledge_insights(workspace_id,topic_id,id);
create index studio_knowledge_evidence_insight_idx on public.studio_knowledge_evidence(workspace_id,insight_id,id);
create index studio_knowledge_reviews_insight_idx on public.studio_knowledge_reviews(workspace_id,insight_id,id);
create index studio_knowledge_units_source_idx on public.studio_knowledge_source_units(workspace_id,source_id,transcription_id,unit_index);

alter table public.studio_knowledge_topics enable row level security;
alter table public.studio_knowledge_sources enable row level security;
alter table public.studio_knowledge_insights enable row level security;
alter table public.studio_knowledge_evidence enable row level security;
alter table public.studio_knowledge_reviews enable row level security;
alter table public.studio_knowledge_source_unit_sidecars enable row level security;
alter table public.studio_knowledge_source_units enable row level security;
revoke all on public.studio_knowledge_topics, public.studio_knowledge_sources, public.studio_knowledge_insights,
  public.studio_knowledge_evidence, public.studio_knowledge_reviews, public.studio_knowledge_source_unit_sidecars, public.studio_knowledge_source_units from public,anon,authenticated;
grant all on public.studio_knowledge_topics, public.studio_knowledge_sources, public.studio_knowledge_insights,
  public.studio_knowledge_evidence, public.studio_knowledge_reviews, public.studio_knowledge_source_unit_sidecars, public.studio_knowledge_source_units to service_role;

commit;
