-- PostgreSQL treats LEAST/GREATEST as SQL expressions rather than catalog
-- functions, so schema-qualifying them fails only when the RPC is executed.
-- Repair the already-applied function definition without rewriting migration
-- history. Reapplying is safe because the replacements become no-ops.

DO $$
DECLARE
  v_function REGPROCEDURE :=
    'public.member_follow_ups_page(date,text,text,text[],uuid[],boolean,text[],text,text,integer,integer)'::REGPROCEDURE;
  v_definition TEXT;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(v_function)
  INTO v_definition;

  v_definition := pg_catalog.replace(
    v_definition,
    'pg_catalog.least',
    'least'
  );
  v_definition := pg_catalog.replace(
    v_definition,
    'pg_catalog.greatest',
    'greatest'
  );

  EXECUTE v_definition;
END;
$$;

REVOKE ALL ON FUNCTION public.member_follow_ups_page(
  DATE, TEXT, TEXT, TEXT[], UUID[], BOOLEAN, TEXT[], TEXT, TEXT, INTEGER, INTEGER
) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.member_follow_ups_page(
  DATE, TEXT, TEXT, TEXT[], UUID[], BOOLEAN, TEXT[], TEXT, TEXT, INTEGER, INTEGER
) TO authenticated;
