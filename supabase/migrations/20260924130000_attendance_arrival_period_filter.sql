-- Keep the existing attendance RPC available to deployed clients. The new
-- function filters the relational roster before counting, sorting, and paging.
-- Assigned arrival is a recurring wall-clock hint, independent of check-ins.
DO $migration$
DECLARE
  v_source REGPROCEDURE :=
    'public.member_attendance_page(timestamp with time zone,timestamp with time zone,date,text,integer,boolean,text,text,uuid[],text,text,integer,integer)'::REGPROCEDURE;
  v_definition TEXT;
  v_old TEXT;
  v_new TEXT;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(v_source) INTO v_definition;

  v_old := 'FUNCTION public.member_attendance_page(';
  v_new := 'FUNCTION public.member_attendance_page_by_arrival(';
  IF pg_catalog.strpos(v_definition, v_old) = 0 THEN
    RAISE EXCEPTION 'Attendance function name changed';
  END IF;
  v_definition := pg_catalog.replace(v_definition, v_old, v_new);

  v_old := 'p_page_size integer)';
  v_new := 'p_page_size integer, p_arrival_bucket text)';
  IF pg_catalog.strpos(v_definition, v_old) = 0 THEN
    RAISE EXCEPTION 'Attendance function signature changed';
  END IF;
  v_definition := pg_catalog.replace(v_definition, v_old, v_new);

  v_old := 'OR p_sort_direction IS NULL OR p_page IS NULL OR p_page_size IS NULL THEN';
  v_new := 'OR p_sort_direction IS NULL OR p_page IS NULL OR p_page_size IS NULL
     OR p_arrival_bucket IS NULL THEN';
  IF pg_catalog.strpos(v_definition, v_old) = 0 THEN
    RAISE EXCEPTION 'Attendance argument validation changed';
  END IF;
  v_definition := pg_catalog.replace(v_definition, v_old, v_new);

  v_old := $old$  IF pg_catalog.length(v_search) > 200 THEN$old$;
  v_new := $new$  IF p_arrival_bucket NOT IN (
    'all', 'morning', 'afternoon', 'evening', 'overnight', 'unassigned'
  ) THEN
    RAISE EXCEPTION 'Unknown assigned arrival filter'
      USING ERRCODE = '22023';
  END IF;
  IF pg_catalog.length(v_search) > 200 THEN$new$;
  IF pg_catalog.strpos(v_definition, v_old) = 0 THEN
    RAISE EXCEPTION 'Attendance filter validation changed';
  END IF;
  v_definition := pg_catalog.replace(v_definition, v_old, v_new);

  v_old := $old$v_sort_key NOT IN ('name', 'checked_in_at', 'checked_out_at')$old$;
  v_new := $new$v_sort_key NOT IN ('name', 'assigned_arrival_time', 'checked_in_at', 'checked_out_at')$new$;
  IF pg_catalog.strpos(v_definition, v_old) = 0 THEN
    RAISE EXCEPTION 'Attendance sort validation changed';
  END IF;
  v_definition := pg_catalog.replace(v_definition, v_old, v_new);

  v_old := 'contact.phone AS contact_phone,';
  v_new := 'contact.phone AS contact_phone,
        contact.assigned_arrival_time AS assigned_arrival_time,';
  IF pg_catalog.strpos(v_definition, v_old) = 0 THEN
    RAISE EXCEPTION 'Attendance roster contact shape changed';
  END IF;
  v_definition := pg_catalog.replace(v_definition, v_old, v_new);

  v_old := $old$    filtered AS MATERIALIZED (
      SELECT scope.*
      FROM base_scope AS scope
      WHERE (p_bucket = 'present') = (scope.attendance_id IS NOT NULL)
        AND ($old$;
  v_new := $new$    eligible AS MATERIALIZED (
      SELECT scope.*
      FROM base_scope AS scope
      WHERE (
        p_arrival_bucket = 'all'
        OR (p_arrival_bucket = 'unassigned' AND scope.assigned_arrival_time IS NULL)
        OR (p_arrival_bucket = 'morning'
          AND scope.assigned_arrival_time >= TIME '05:00'
          AND scope.assigned_arrival_time < TIME '12:00')
        OR (p_arrival_bucket = 'afternoon'
          AND scope.assigned_arrival_time >= TIME '12:00'
          AND scope.assigned_arrival_time < TIME '17:00')
        OR (p_arrival_bucket = 'evening'
          AND scope.assigned_arrival_time >= TIME '17:00')
        OR (p_arrival_bucket = 'overnight'
          AND scope.assigned_arrival_time < TIME '05:00')
      )
        AND ($new$;
  IF pg_catalog.strpos(v_definition, v_old) = 0 THEN
    RAISE EXCEPTION 'Attendance filter scope changed';
  END IF;
  v_definition := pg_catalog.replace(v_definition, v_old, v_new);

  v_old := $old$    filtered_count AS ($old$;
  v_new := $new$    filtered AS MATERIALIZED (
      SELECT scope.*
      FROM eligible AS scope
      WHERE (p_bucket = 'present') = (scope.attendance_id IS NOT NULL)
    ),
    filtered_count AS ($new$;
  IF pg_catalog.strpos(v_definition, v_old) = 0 THEN
    RAISE EXCEPTION 'Attendance count scope changed';
  END IF;
  v_definition := pg_catalog.replace(v_definition, v_old, v_new);

  v_old := $old$      FROM base_scope
    ),
    plan_options AS ($old$;
  v_new := $new$      FROM eligible
    ),
    plan_options AS ($new$;
  IF pg_catalog.strpos(v_definition, v_old) = 0 THEN
    RAISE EXCEPTION 'Attendance facet scope changed';
  END IF;
  v_definition := pg_catalog.replace(v_definition, v_old, v_new);

  v_old := $old$          ORDER BY
            CASE WHEN v_sort_key = 'name'$old$;
  v_new := $new$          ORDER BY
            CASE WHEN v_sort_key = 'assigned_arrival_time' AND v_sort_direction = 'asc'
              THEN scope.assigned_arrival_time END ASC NULLS LAST,
            CASE WHEN v_sort_key = 'assigned_arrival_time' AND v_sort_direction = 'desc'
              THEN scope.assigned_arrival_time END DESC NULLS LAST,
            CASE WHEN v_sort_key = 'name'$new$;
  IF pg_catalog.strpos(v_definition, v_old) = 0 THEN
    RAISE EXCEPTION 'Attendance window sort changed';
  END IF;
  v_definition := pg_catalog.replace(v_definition, v_old, v_new);

  v_old := $old$      ORDER BY
        CASE WHEN v_sort_key = 'name'$old$;
  v_new := $new$      ORDER BY
        CASE WHEN v_sort_key = 'assigned_arrival_time' AND v_sort_direction = 'asc'
          THEN scope.assigned_arrival_time END ASC NULLS LAST,
        CASE WHEN v_sort_key = 'assigned_arrival_time' AND v_sort_direction = 'desc'
          THEN scope.assigned_arrival_time END DESC NULLS LAST,
        CASE WHEN v_sort_key = 'name'$new$;
  IF pg_catalog.strpos(v_definition, v_old) = 0 THEN
    RAISE EXCEPTION 'Attendance page sort changed';
  END IF;
  v_definition := pg_catalog.replace(v_definition, v_old, v_new);

  v_old := $old$v_sort_key IN ('checked_in_at', 'checked_out_at')$old$;
  v_new := $new$v_sort_key IN ('assigned_arrival_time', 'checked_in_at', 'checked_out_at')$new$;
  IF pg_catalog.strpos(v_definition, v_old) = 0 THEN
    RAISE EXCEPTION 'Attendance sort tie-breaker changed';
  END IF;
  v_definition := pg_catalog.replace(v_definition, v_old, v_new);

  EXECUTE v_definition;
END;
$migration$;

ALTER FUNCTION public.member_attendance_page_by_arrival(
  TIMESTAMPTZ, TIMESTAMPTZ, DATE, TEXT, INTEGER, BOOLEAN, TEXT, TEXT,
  UUID[], TEXT, TEXT, INTEGER, INTEGER, TEXT
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.member_attendance_page_by_arrival(
  TIMESTAMPTZ, TIMESTAMPTZ, DATE, TEXT, INTEGER, BOOLEAN, TEXT, TEXT,
  UUID[], TEXT, TEXT, INTEGER, INTEGER, TEXT
) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.member_attendance_page_by_arrival(
  TIMESTAMPTZ, TIMESTAMPTZ, DATE, TEXT, INTEGER, BOOLEAN, TEXT, TEXT,
  UUID[], TEXT, TEXT, INTEGER, INTEGER, TEXT
) TO authenticated;

NOTIFY pgrst, 'reload schema';
