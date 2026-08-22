-- Record the provider snapshot generation that last returned each template.
-- Sync writes use this as a compare-and-set guard so an older absent snapshot
-- cannot overwrite a newer sync that already observed the row.

ALTER TABLE public.message_templates
  ADD COLUMN IF NOT EXISTS provider_last_seen_at TIMESTAMPTZ;

COMMENT ON COLUMN public.message_templates.provider_last_seen_at IS
  'Start time of the newest complete or partial Meta sync that returned this template; used as a generation guard against overlapping stale sync writes.';
