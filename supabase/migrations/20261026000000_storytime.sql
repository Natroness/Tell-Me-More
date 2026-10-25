-- Opt-in Storytime. Generation attempts survive Remove so daily limits cannot be bypassed.
alter table media drop constraint media_kind_check;
alter table media add constraint media_kind_check check (kind in
  ('photo', 'video', 'audio', 'scan', 'generated_image', 'generated_video', 'generated_audio'));
alter table notification drop constraint notification_type_check;
alter table notification add constraint notification_type_check check (type in
  ('request_received', 'request_declined', 'story_ready', 'memory_added', 'storytime_ready'));

create table storytime (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references family(id) on delete cascade,
  heirloom_id uuid not null unique references heirloom(id) on delete cascade,
  story_id uuid not null references story(id) on delete cascade,
  requested_by uuid not null,
  generation_id uuid not null unique,
  status text not null default 'queued' check (status in
    ('queued', 'scripting', 'gathering', 'narrating', 'rendering', 'ready', 'failed')),
  storyboard jsonb,
  assets jsonb not null default '{}',
  video_media_id uuid references media(id) on delete set null,
  poster_media_id uuid references media(id) on delete set null,
  video_story_id uuid references story(id) on delete set null,
  duration_ms integer check (duration_ms > 0),
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index storytime_family_idx on storytime(family_id);
create index storytime_story_idx on storytime(story_id);
create index storytime_video_idx on storytime(video_media_id);
create index storytime_poster_idx on storytime(poster_media_id);
create index storytime_video_story_idx on storytime(video_story_id);

create table storytime_attempt (
  id uuid primary key,
  family_id uuid not null references family(id) on delete cascade,
  heirloom_id uuid not null references heirloom(id) on delete cascade,
  storytime_id uuid references storytime(id) on delete set null,
  requested_by uuid not null,
  assets jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index storytime_attempt_cap_idx on storytime_attempt(family_id, created_at);
create index storytime_attempt_heirloom_idx on storytime_attempt(heirloom_id);
create index storytime_attempt_storytime_idx on storytime_attempt(storytime_id);

alter table storytime enable row level security;
alter table storytime_attempt enable row level security;
revoke all on storytime, storytime_attempt from public, anon, authenticated;
grant select on storytime to authenticated;
create policy "members read" on storytime for select to authenticated
  using (private.is_member(family_id));
-- Attempts are an internal cost ledger; no client grants or policies.
alter publication supabase_realtime add table storytime;
