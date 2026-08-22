CREATE SEQUENCE IF NOT EXISTS public.meta_template_sync_generation_seq AS BIGINT;

ALTER TABLE public.message_templates
  ADD COLUMN IF NOT EXISTS provider_sync_generation BIGINT;

ALTER TABLE public.message_templates
  DROP CONSTRAINT IF EXISTS message_templates_provider_sync_generation_positive;

ALTER TABLE public.message_templates
  ADD CONSTRAINT message_templates_provider_sync_generation_positive
  CHECK (provider_sync_generation IS NULL OR provider_sync_generation > 0);

CREATE OR REPLACE FUNCTION public.next_meta_template_sync_generation()
RETURNS BIGINT
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT nextval('public.meta_template_sync_generation_seq');
$$;

REVOKE ALL ON FUNCTION public.next_meta_template_sync_generation() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.next_meta_template_sync_generation()
  TO authenticated, service_role;

COMMENT ON COLUMN public.message_templates.provider_sync_generation IS
  'Database-issued total ordering for Meta sync outcomes; higher generations supersede lower generations.';

COMMENT ON COLUMN public.message_templates.provider_sync_generation_at IS
  'Deprecated timestamp generation retained for migration compatibility; new syncs use provider_sync_generation.';

COMMENT ON FUNCTION public.next_meta_template_sync_generation() IS
  'Allocates a strictly increasing generation used to serialize overlapping Meta template snapshots.';
