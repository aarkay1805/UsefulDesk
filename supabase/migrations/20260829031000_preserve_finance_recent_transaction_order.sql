-- Preserve the Finance Overview's existing JavaScript ordering contract.
--
-- The overview historically sorted the displayed occurredAt strings. A DATE
-- expense such as 2026-08-22 therefore sorts ahead of a late-UTC payment whose
-- displayed value begins 2026-08-21, regardless of their converted instants.
-- Rewrite only the two final ordering expressions without editing the already
-- applied snapshot migration.

DO $migration$
DECLARE
  v_definition TEXT;
  v_changed BOOLEAN := FALSE;
BEGIN
  SELECT pg_get_functiondef(
    'public.finance_overview_snapshot(uuid,date,text,date)'::REGPROCEDURE
  )
  INTO v_definition;

  IF STRPOS(v_definition, 'row.occurred_sort DESC') > 0 THEN
    v_definition := REPLACE(
      v_definition,
      'row.occurred_sort DESC',
      '(row.value ->> ''occurredAt'') COLLATE "C" DESC'
    );
    v_changed := TRUE;
  ELSIF STRPOS(
    v_definition,
    '(row.value ->> ''occurredAt'') COLLATE "C" DESC'
  ) = 0 THEN
    RAISE EXCEPTION 'Unexpected finance overview aggregate ordering definition';
  END IF;

  IF STRPOS(v_definition, 'transaction.occurred_sort DESC') > 0 THEN
    v_definition := REPLACE(
      v_definition,
      'transaction.occurred_sort DESC',
      '(transaction.value ->> ''occurredAt'') COLLATE "C" DESC'
    );
    v_changed := TRUE;
  ELSIF STRPOS(
    v_definition,
    '(transaction.value ->> ''occurredAt'') COLLATE "C" DESC'
  ) = 0 THEN
    RAISE EXCEPTION 'Unexpected finance overview limit ordering definition';
  END IF;

  IF v_changed THEN
    EXECUTE v_definition;
  END IF;
END
$migration$;

ALTER FUNCTION public.finance_overview_snapshot(UUID, DATE, TEXT, DATE)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.finance_overview_snapshot(UUID, DATE, TEXT, DATE)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.finance_overview_snapshot(UUID, DATE, TEXT, DATE)
  TO authenticated;

