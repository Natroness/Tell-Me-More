-- One shared family view, profile avatars, and live tree/dates.
--
-- active_family_id is the family a user is looking at. Without it every screen showed the
-- family the user owns, so two connected relatives each looked at their own family and never
-- saw each other's objects, dates, tree or availability. Accepting an invitation or a family
-- connection now adopts the shared family; users with several families can switch.
alter table profile
  add column active_family_id uuid references family(id) on delete set null,
  add column avatar_style text check (avatar_style in ('male', 'female')),
  add column avatar_preset text check (avatar_preset in
    ('boy', 'girl', 'man', 'woman', 'older-man', 'older-woman')),
  add column avatar_path text check (avatar_path is null or avatar_path like 'users/%');

-- Avatars are public so every relative's browser can show them without a signed URL.
-- presets/{key}.png holds the six illustrations; users/{user_id}/{id}.{ext} holds uploaded
-- photos. Uploads use backend-minted signed URLs, so no write policy is needed.
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do update set public = true;

-- Realtime applies the existing "members read" policies on these tables.
alter publication supabase_realtime add table person, relationship, member, family_event;
