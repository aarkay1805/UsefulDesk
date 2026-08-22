-- Account sharing means one Meta template identity belongs to the tenant, not
-- to an individual teammate. Refuse to discard any historical rows if an older
-- installation contains cross-teammate duplicates; the operator can archive or
-- otherwise reconcile the reported rows before retrying.
DO $$
DECLARE
  dupe_count INT;
  sample TEXT;
BEGIN
  SELECT count(*) INTO dupe_count
  FROM (
    SELECT account_id, name, language
    FROM public.message_templates
    GROUP BY account_id, name, language
    HAVING count(*) > 1
  ) dupes;

  IF dupe_count > 0 THEN
    SELECT string_agg(
      account_id::text || ' / ' || name || ' / ' ||
        COALESCE(language, '(null)') || ' (' || count || ' rows)',
      E'\n  '
    )
    INTO sample
    FROM (
      SELECT account_id, name, language, count(*) AS count
      FROM public.message_templates
      GROUP BY account_id, name, language
      HAVING count(*) > 1
    ) dupe_detail;

    RAISE EXCEPTION
      E'Cannot add UNIQUE(account_id, name, language) on message_templates — % duplicate combination(s):\n  %\nPreserve the noncanonical rows in an audit/archive location, reconcile each group to one active row, then re-run migrations.',
      dupe_count, sample;
  END IF;
END
$$;

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

CREATE UNIQUE INDEX IF NOT EXISTS message_templates_account_name_language_key
  ON public.message_templates (account_id, name, language);

COMMENT ON INDEX public.message_templates_account_name_language_key IS
  'One shared template identity per account, matching the account-scoped Meta catalog.';
