-- PostgreSQL resolves PL/pgSQL output parameters before UNION result names.
-- Ordering the claim RPCs by `delivery_id` therefore becomes an unsupported
-- expression at runtime. Use the result-column ordinal without changing order.

DO $repair$
DECLARE
  function_signature REGPROCEDURE;
  function_sql TEXT;
BEGIN
  FOREACH function_signature IN ARRAY ARRAY[
    'public.claim_push_deliveries(uuid,integer,integer)'::REGPROCEDURE,
    'public.claim_push_receipts(uuid,integer,integer)'::REGPROCEDURE
  ]
  LOOP
    SELECT pg_get_functiondef(function_signature) INTO function_sql;

    IF function_sql LIKE '%ORDER BY delivery_id NULLS LAST%' THEN
      EXECUTE replace(
        function_sql,
        'ORDER BY delivery_id NULLS LAST',
        'ORDER BY 1 NULLS LAST'
      );
    ELSIF function_sql NOT LIKE '%ORDER BY 1 NULLS LAST%' THEN
      RAISE EXCEPTION 'Unexpected push claim function definition: %',
        function_signature;
    END IF;
  END LOOP;
END;
$repair$;
