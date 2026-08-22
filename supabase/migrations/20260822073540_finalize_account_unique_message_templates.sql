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
      E'Cannot enforce account-scoped template identity — % duplicate combination(s):\n  %\nPreserve the noncanonical rows in an audit/archive location, reconcile each group to one active row, then re-run migrations.',
      dupe_count, sample;
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS message_templates_account_name_language_key
  ON public.message_templates (account_id, name, language);

-- Keep message_templates_user_name_language_key until the application version
-- using the account-scoped conflict target is deployed. Dropping it earlier
-- breaks the previous submit route during a mixed-version rollout.
