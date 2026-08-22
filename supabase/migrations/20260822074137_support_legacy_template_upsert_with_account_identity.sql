CREATE OR REPLACE FUNCTION public.canonicalize_message_template_insert_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  canonical_user_id UUID;
BEGIN
  SELECT user_id
  INTO canonical_user_id
  FROM public.message_templates
  WHERE account_id = NEW.account_id
    AND name = NEW.name
    AND language IS NOT DISTINCT FROM NEW.language
  LIMIT 1;

  IF canonical_user_id IS NOT NULL THEN
    NEW.user_id := canonical_user_id;
  END IF;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS canonicalize_message_template_insert_user
  ON public.message_templates;

CREATE TRIGGER canonicalize_message_template_insert_user
  BEFORE INSERT ON public.message_templates
  FOR EACH ROW
  EXECUTE FUNCTION public.canonicalize_message_template_insert_user();

COMMENT ON FUNCTION public.canonicalize_message_template_insert_user() IS
  'Mixed-version compatibility: route legacy user-scoped upserts to the existing account-scoped template row.';

REVOKE ALL ON FUNCTION public.canonicalize_message_template_insert_user()
  FROM PUBLIC;
