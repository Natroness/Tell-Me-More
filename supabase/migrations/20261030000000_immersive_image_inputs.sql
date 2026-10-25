-- Keep a durable explanation of reference selection and the actual World Labs input.
-- Later than the existing future-dated reference migration; no old worlds are rewritten.
alter table immersive_world add column input_audit jsonb not null default '{}'
  check (jsonb_typeof(input_audit) = 'object');
