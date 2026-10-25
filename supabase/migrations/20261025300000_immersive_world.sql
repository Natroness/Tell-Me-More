-- Immersive memories (docs/IMMERSIVE.md §3): a walkable 3D world built from one story photo, on
-- request only. One world per source photo; asset paths live in the private `generated` bucket
-- under the family id, so the existing storage read policy covers them.
create table immersive_world (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references family(id) on delete cascade,
  heirloom_id uuid not null references heirloom(id) on delete cascade,
  source_media_id uuid not null references media(id) on delete cascade,
  requested_by uuid not null,
  requested_by_person uuid references person(id) on delete set null,
  status text not null default 'queued' check (status in
    ('queued', 'writing_scene', 'generating', 'saving', 'placing_spots', 'ready', 'failed')),
  input_mode text check (input_mode in ('image', 'text')),
  scene_prompt text,
  used_fact_ids uuid[] not null default '{}',
  provider text not null default 'worldlabs',
  model text,
  provider_operation_id text,  -- saved before polling, so a restarted job resumes the same world
  provider_world_id text,
  assets jsonb,                -- storage paths: spz_100k, spz_500k, pano, thumbnail, collider
  semantics jsonb,             -- metric_scale_factor, ground_plane_offset
  hotspots jsonb not null default '[]',
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_media_id)
);
create index on immersive_world (heirloom_id);
create index on immersive_world (family_id, created_at);

alter table immersive_world enable row level security;
create policy "members read" on immersive_world for select to authenticated
  using (private.is_member(family_id));
grant select on immersive_world to authenticated;
alter publication supabase_realtime add table immersive_world;
