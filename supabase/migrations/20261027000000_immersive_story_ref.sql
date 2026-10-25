-- Reference the story a world was imagined from. Worlds stay per-photo
-- (unique source_media_id); story_id pins which published story version the scene
-- and memory spots came from, so every world resolves to object + story + family.
alter table immersive_world add column story_id uuid references story(id) on delete set null;
create index on immersive_world (story_id);

-- Backfill: the latest published version for the world’s object, where one exists.
update immersive_world w
set story_id = s.id
from story s
where s.heirloom_id = w.heirloom_id
  and s.version = (select max(version) from story where heirloom_id = w.heirloom_id)
  and w.story_id is null;
