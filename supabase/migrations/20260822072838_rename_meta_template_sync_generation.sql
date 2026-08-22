DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'message_templates'
      AND column_name = 'provider_last_seen_at'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'message_templates'
      AND column_name = 'provider_sync_generation_at'
  ) THEN
    ALTER TABLE public.message_templates
      RENAME COLUMN provider_last_seen_at TO provider_sync_generation_at;
  END IF;
END
$$;

COMMENT ON COLUMN public.message_templates.provider_sync_generation_at IS
  'Start time of the newest Meta sync generation that reconciled this template as present or missing; used as a compare-and-set guard against overlapping stale sync writes.';
