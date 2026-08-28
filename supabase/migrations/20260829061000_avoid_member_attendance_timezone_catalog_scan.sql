-- pg_timezone_names is a set-returning catalogue function that rebuilds more
-- than 1,100 zone rows per call. Preserve strict zone validation without that
-- fixed ~60 ms tax by asking PostgreSQL to resolve the supplied zone directly.
-- This is a forward repair because 20260829060000 is already applied.

DO $migration$
DECLARE
  v_function REGPROCEDURE :=
    'public.member_attendance_page(timestamp with time zone,timestamp with time zone,date,text,integer,boolean,text,text,uuid[],text,text,integer,integer)'::REGPROCEDURE;
  v_definition TEXT;
  v_slow_validation TEXT := $slow$  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_timezone_names AS zone
    WHERE zone.name = p_time_zone
  ) THEN
    RAISE EXCEPTION 'Unknown attendance time zone'
      USING ERRCODE = '22023';
  END IF;$slow$;
  v_direct_validation TEXT := $direct$  BEGIN
    PERFORM p_today::TIMESTAMP AT TIME ZONE p_time_zone;
  EXCEPTION
    WHEN invalid_parameter_value THEN
      RAISE EXCEPTION 'Unknown attendance time zone'
        USING ERRCODE = '22023';
  END;$direct$;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(v_function)
  INTO v_definition;

  IF pg_catalog.strpos(v_definition, v_slow_validation) > 0 THEN
    v_definition := pg_catalog.replace(
      v_definition,
      v_slow_validation,
      v_direct_validation
    );
    EXECUTE v_definition;
  ELSIF pg_catalog.strpos(v_definition, v_direct_validation) = 0 THEN
    RAISE EXCEPTION 'member_attendance_page timezone validation shape changed';
  END IF;
END;
$migration$;

REVOKE ALL ON FUNCTION public.member_attendance_page(
  TIMESTAMPTZ, TIMESTAMPTZ, DATE, TEXT, INTEGER, BOOLEAN, TEXT, TEXT,
  UUID[], TEXT, TEXT, INTEGER, INTEGER
) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.member_attendance_page(
  TIMESTAMPTZ, TIMESTAMPTZ, DATE, TEXT, INTEGER, BOOLEAN, TEXT, TEXT,
  UUID[], TEXT, TEXT, INTEGER, INTEGER
) TO authenticated;
