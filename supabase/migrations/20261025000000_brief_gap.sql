-- Brief gap migration: StoryRequest, Notification, Profile prefs, upload/story status.
-- See Family Object Stories Brief §6 + goals/PLAN.md Step 1.

-- Profiles (Brief User age/ui_mode) -------------------------------------------
create table profile (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  age int check (age is null or (age >= 0 and age <= 130)),
  ui_mode text not null default 'simplified'
    check (ui_mode in ('regular', 'simplified', 'extra_simple')),
  avatar_media_id uuid references media(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Story requests (Brief §6 StoryRequest + §4 workflow) -------------------------
create table story_request (
  id uuid primary key default gen_random_uuid(),
  heirloom_id uuid not null references heirloom(id) on delete cascade,
  capture_media_id uuid references media(id) on delete set null,
  listener_id uuid not null references person(id) on delete cascade,
  storyteller_id uuid not null references person(id) on delete cascade,
  message text not null default '',
  status text not null default 'pending'
    check (status in ('pending', 'in_progress', 'completed', 'declined', 'cancelled')),
  idempotency_key text unique,
  created_at timestamptz not null default now(),
  check (listener_id != storyteller_id)
);
create index on story_request (heirloom_id, status);
create index on story_request (storyteller_id, status);
create index on story_request (listener_id, status);

-- Notifications (Brief §6 + §7 in-app when push off) ---------------------------
create table notification (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references person(id) on delete cascade,
  type text not null check (type in
    ('request_received', 'request_declined', 'story_ready', 'memory_added')),
  request_id uuid references story_request(id) on delete cascade,
  story_id uuid references story(id) on delete cascade,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index on notification (recipient_id, read_at);

-- Interviews answer a request; compose_story completes it and notifies the listener.
alter table interview add column request_id uuid references story_request(id) on delete set null;

-- Video captures are kept alongside the still frame the AI reads.
alter table media drop constraint media_kind_check;
alter table media add constraint media_kind_check
  check (kind in ('photo', 'video', 'audio', 'scan', 'generated_image'));

-- Media upload status (Brief §6 Upload states) ---------------------------------
alter table media add column if not exists
  upload_status text not null default 'ready'
  check (upload_status in ('uploading', 'ready', 'failed'));

-- Story link + status (Brief §6 Story) -----------------------------------------
alter table story add column if not exists request_id uuid
  references story_request(id) on delete set null;
alter table story add column if not exists storyteller_id uuid
  references person(id) on delete set null;
alter table story add column if not exists recording_media_id uuid
  references media(id) on delete set null;
alter table story add column if not exists status text not null default 'published'
  check (status in ('draft', 'published'));

-- RLS --------------------------------------------------------------------------
-- True when the caller shares at least one family with this user.
create function private.shares_family(other uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.member mine
    join public.member theirs on theirs.family_id = mine.family_id
    where mine.user_id = (select auth.uid()) and theirs.user_id = other
  );
$$;
grant execute on function private.shares_family(uuid) to authenticated;

alter table profile enable row level security;
alter table story_request enable row level security;
alter table notification enable row level security;

revoke all on all tables in schema public from anon, authenticated;

grant select on profile, story_request, notification to authenticated;
-- re-grant existing tables (revoke all wiped them; restore per init migration)
grant select on family, person, relationship, member, heirloom, media, interview, turn, segment,
  fact, context_card, memory_note, story, job to authenticated;

-- Age is personal: only you and people in your families can read your profile.
create policy "self or family read" on profile for select to authenticated
  using (user_id = (select auth.uid()) or private.shares_family(user_id));

create policy "members read" on story_request for select to authenticated
  using (private.is_member(private.heirloom_family(heirloom_id)));

-- A notification is for one person: only the account linked to that person reads it.
create policy "recipient reads" on notification for select to authenticated
  using (exists (
    select 1 from public.member m
    where m.person_id = notification.recipient_id and m.user_id = (select auth.uid())
  ));

-- Realtime: phone subscribes to requests + inbox (goals/PLAN.md Step 2) ---------
alter publication supabase_realtime add table story_request, notification, media, heirloom, profile;
