-- Lorebook initial schema. See docs/DESIGN.md §4.
--
-- Writes go through FastAPI with the service role, which bypasses RLS.
-- RLS here only governs what the browser can read directly: Realtime subscriptions and
-- Storage downloads. Every policy reduces to "is the caller a member of this family".

-- Families and people -------------------------------------------------------

create table family (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  invite_code text unique not null,
  created_at timestamptz not null default now()
);

create table person (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references family(id) on delete cascade,
  display_name text not null,
  full_name text,
  relation_label text,                          -- "grandmother", used in prompts
  birth_year int,
  is_living boolean not null default true,
  avatar_media_id uuid,
  created_at timestamptz not null default now()
);

create table relationship (
  family_id uuid not null references family(id) on delete cascade,
  a uuid not null references person(id) on delete cascade,
  b uuid not null references person(id) on delete cascade,
  kind text not null check (kind in ('parent', 'spouse', 'sibling')),
  primary key (a, b, kind)
);

create table member (
  user_id uuid not null references auth.users(id) on delete cascade,
  family_id uuid not null references family(id) on delete cascade,
  person_id uuid references person(id) on delete set null,
  role text not null default 'member' check (role in ('owner', 'member')),
  primary key (user_id, family_id)
);

-- Heirlooms and media -------------------------------------------------------

create table heirloom (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references family(id) on delete cascade,
  title text,
  category text check (category in
    ('jewelry', 'watch', 'letter', 'recipe', 'clothing', 'toy', 'photo', 'other')),
  cover_media_id uuid,
  created_by uuid not null,
  created_at timestamptz not null default now()
);
create index on heirloom (family_id);

create table media (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references family(id) on delete cascade,
  heirloom_id uuid references heirloom(id) on delete cascade,
  kind text not null check (kind in ('photo', 'audio', 'scan', 'generated_image')),
  storage_path text not null,
  mime text not null,
  duration_ms int,
  width int,
  height int,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index on media (heirloom_id);

alter table heirloom
  add constraint heirloom_cover_fk foreign key (cover_media_id) references media(id) on delete set null;
alter table person
  add constraint person_avatar_fk foreign key (avatar_media_id) references media(id) on delete set null;

-- Interview -----------------------------------------------------------------

create table interview (
  id uuid primary key default gen_random_uuid(),
  heirloom_id uuid not null references heirloom(id) on delete cascade,
  narrator_id uuid not null references person(id),
  interviewer_user_id uuid not null,
  language text not null default 'en',
  state text not null default 'ready'
    check (state in ('ready', 'asking', 'listening', 'thinking', 'wrapping_up', 'done')),
  coverage jsonb not null default '{}',
  created_at timestamptz not null default now(),
  ended_at timestamptz
);
create index on interview (heirloom_id);

create table turn (
  id uuid primary key default gen_random_uuid(),
  interview_id uuid not null references interview(id) on delete cascade,
  idx int not null,
  role text not null check (role in ('question', 'answer')),
  text text,
  audio_media_id uuid references media(id),
  target_slot text,
  unique (interview_id, idx)
);

create table segment (
  id uuid primary key default gen_random_uuid(),
  turn_id uuid not null references turn(id) on delete cascade,
  start_ms int not null,
  end_ms int not null,
  text text not null,
  text_en text
);
create index on segment (turn_id);

-- Knowledge -----------------------------------------------------------------

create table fact (
  id uuid primary key default gen_random_uuid(),
  heirloom_id uuid not null references heirloom(id) on delete cascade,
  kind text not null check (kind in ('memory', 'observation', 'history', 'inference')),
  text text not null,
  source jsonb not null,
  year int,
  place text,
  people uuid[] not null default '{}',
  confidence real,
  created_at timestamptz not null default now()
);
create index on fact (heirloom_id, kind);

create table context_card (
  id uuid primary key default gen_random_uuid(),
  heirloom_id uuid not null references heirloom(id) on delete cascade,
  year int not null,
  place text,
  topic text not null check (topic in ('events', 'music', 'fashion', 'prices', 'place')),
  summary text not null,
  sources jsonb not null check (jsonb_array_length(sources) > 0)
);
create index on context_card (heirloom_id);

create table memory_note (
  id uuid primary key default gen_random_uuid(),
  heirloom_id uuid not null references heirloom(id) on delete cascade,
  author_id uuid not null references person(id),
  text text,
  audio_media_id uuid references media(id),
  created_at timestamptz not null default now(),
  check (text is not null or audio_media_id is not null)
);
create index on memory_note (heirloom_id);

-- Output --------------------------------------------------------------------

create table story (
  id uuid primary key default gen_random_uuid(),
  heirloom_id uuid not null references heirloom(id) on delete cascade,
  version int not null,
  title text not null,
  dek text,
  blocks jsonb not null,
  created_at timestamptz not null default now(),
  unique (heirloom_id, version)
);

-- Pipeline ------------------------------------------------------------------

create table job (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  subject_id uuid not null,
  family_id uuid not null references family(id) on delete cascade,
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  attempts int not null default 0,
  error text,
  output jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (kind, subject_id)
);
create index job_queued_idx on job (created_at) where status = 'queued';

create table serp_cache (
  key text primary key,
  params jsonb not null,
  response jsonb not null,
  created_at timestamptz not null default now()
);

-- Row-level security --------------------------------------------------------

-- Helpers are security definer so policies can look up membership without recursing
-- through member's own RLS. They live in an unexposed schema so the Data API can't call them.
create schema private;
grant usage on schema private to authenticated;

create function private.is_member(fid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.member where family_id = fid and user_id = (select auth.uid())
  );
$$;

create function private.heirloom_family(hid uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select family_id from public.heirloom where id = hid;
$$;

create function private.interview_family(iid uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select h.family_id from public.interview i
  join public.heirloom h on h.id = i.heirloom_id where i.id = iid;
$$;

create function private.turn_family(tid uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select h.family_id from public.turn t
  join public.interview i on i.id = t.interview_id
  join public.heirloom h on h.id = i.heirloom_id where t.id = tid;
$$;

revoke all on all functions in schema private from public;
grant execute on all functions in schema private to authenticated;

alter table family       enable row level security;
alter table person       enable row level security;
alter table relationship enable row level security;
alter table member       enable row level security;
alter table heirloom     enable row level security;
alter table media        enable row level security;
alter table interview    enable row level security;
alter table turn         enable row level security;
alter table segment      enable row level security;
alter table fact         enable row level security;
alter table context_card enable row level security;
alter table memory_note  enable row level security;
alter table story        enable row level security;
alter table job          enable row level security;
alter table serp_cache   enable row level security;  -- no policies: backend only

create policy "members read" on family       for select to authenticated using (private.is_member(id));
create policy "members read" on person       for select to authenticated using (private.is_member(family_id));
create policy "members read" on relationship for select to authenticated using (private.is_member(family_id));
create policy "members read" on member       for select to authenticated using (private.is_member(family_id));
create policy "members read" on heirloom     for select to authenticated using (private.is_member(family_id));
create policy "members read" on media        for select to authenticated using (private.is_member(family_id));
create policy "members read" on job          for select to authenticated using (private.is_member(family_id));
create policy "members read" on interview    for select to authenticated
  using (private.is_member(private.heirloom_family(heirloom_id)));
create policy "members read" on fact         for select to authenticated
  using (private.is_member(private.heirloom_family(heirloom_id)));
create policy "members read" on context_card for select to authenticated
  using (private.is_member(private.heirloom_family(heirloom_id)));
create policy "members read" on memory_note  for select to authenticated
  using (private.is_member(private.heirloom_family(heirloom_id)));
create policy "members read" on story        for select to authenticated
  using (private.is_member(private.heirloom_family(heirloom_id)));
create policy "members read" on turn         for select to authenticated
  using (private.is_member(private.interview_family(interview_id)));
create policy "members read" on segment      for select to authenticated
  using (private.is_member(private.turn_family(turn_id)));

-- Grants --------------------------------------------------------------------
-- Explicit, so this works even when the project doesn't auto-expose new tables.
-- The browser only reads; anon gets nothing; serp_cache is backend-only.

revoke all on all tables in schema public from anon, authenticated;
grant select on family, person, relationship, member, heirloom, media, interview, turn, segment,
  fact, context_card, memory_note, story, job to authenticated;

-- Realtime ------------------------------------------------------------------
-- The phone subscribes to these (DESIGN.md §5.6). Realtime applies the select policies above.

alter publication supabase_realtime add table interview, turn, job, story, memory_note;

-- Storage -------------------------------------------------------------------
-- Object paths are "{family_id}/{heirloom_id}/{media_id}.{ext}". Uploads use signed URLs
-- minted by the backend, so only a read policy is needed.

insert into storage.buckets (id, name, public)
values ('photos', 'photos', false), ('audio', 'audio', false), ('generated', 'generated', false)
on conflict (id) do nothing;

create policy "members read family objects" on storage.objects for select to authenticated
  using (
    bucket_id in ('photos', 'audio', 'generated')
    and private.is_member(((storage.foldername(name))[1])::uuid)
  );
