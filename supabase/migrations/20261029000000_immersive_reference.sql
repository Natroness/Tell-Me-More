-- A close-up photo can't show World Labs the place, so the world may be built on a real photo
-- of it found on the web instead (docs/IMMERSIVE.md §5.6). `reference` holds our copy's path
-- and the source it is credited to; input_mode 'reference' means the world was built from it.
alter table immersive_world add column reference jsonb;

alter table immersive_world drop constraint immersive_world_input_mode_check;
alter table immersive_world add constraint immersive_world_input_mode_check
  check (input_mode in ('image', 'reference', 'text'));

alter table immersive_world drop constraint immersive_world_status_check;
alter table immersive_world add constraint immersive_world_status_check
  check (status in ('queued', 'writing_scene', 'finding_reference', 'generating', 'saving',
                    'placing_spots', 'ready', 'failed'));
