-- P2-5: replace the Attendance tab's full membership/contact/plan download,
-- selected-day attendance download, and conditional sequential usage-count
-- RPC with one bounded selected-branch snapshot. Check-in/out mutations keep
-- their existing direct RLS paths and fresh per-member warning count.

CREATE OR REPLACE FUNCTION public.member_attendance_page(
  p_day_start TIMESTAMPTZ,
  p_day_end TIMESTAMPTZ,
  p_today DATE,
  p_time_zone TEXT,
  p_week_start INTEGER,
  p_include_usage BOOLEAN,
  p_bucket TEXT,
  p_search TEXT,
  p_plan_ids UUID[],
  p_sort_key TEXT,
  p_sort_direction TEXT,
  p_page INTEGER,
  p_page_size INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_search TEXT := pg_catalog.btrim(COALESCE(p_search, ''));
  v_search_pattern TEXT;
  v_plan_ids UUID[] := COALESCE(p_plan_ids, ARRAY[]::UUID[]);
  v_sort_key TEXT := pg_catalog.lower(COALESCE(p_sort_key, ''));
  v_sort_direction TEXT := pg_catalog.lower(COALESCE(p_sort_direction, ''));
BEGIN
  IF p_day_start IS NULL OR p_day_end IS NULL OR p_today IS NULL
     OR p_time_zone IS NULL OR p_include_usage IS NULL OR p_bucket IS NULL
     OR p_search IS NULL OR p_plan_ids IS NULL OR p_sort_key IS NULL
     OR p_sort_direction IS NULL OR p_page IS NULL OR p_page_size IS NULL THEN
    RAISE EXCEPTION 'Attendance snapshot arguments must not be null'
      USING ERRCODE = '22004';
  END IF;

  IF p_day_end <= p_day_start THEN
    RAISE EXCEPTION 'Attendance day end must follow day start'
      USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_timezone_names AS zone
    WHERE zone.name = p_time_zone
  ) THEN
    RAISE EXCEPTION 'Unknown attendance time zone'
      USING ERRCODE = '22023';
  END IF;
  IF p_week_start < 0 OR p_week_start > 6 THEN
    RAISE EXCEPTION 'Attendance week start is out of range'
      USING ERRCODE = '22023';
  END IF;
  IF p_bucket NOT IN ('present', 'absent') THEN
    RAISE EXCEPTION 'Unknown attendance bucket'
      USING ERRCODE = '22023';
  END IF;
  IF pg_catalog.length(v_search) > 200 THEN
    RAISE EXCEPTION 'Attendance search is too long'
      USING ERRCODE = '22023';
  END IF;
  IF pg_catalog.cardinality(v_plan_ids) > 100
     OR pg_catalog.array_position(v_plan_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'Attendance plan filter is invalid'
      USING ERRCODE = '22023';
  END IF;
  IF v_sort_key NOT IN ('name', 'checked_in_at', 'checked_out_at') THEN
    RAISE EXCEPTION 'Unknown attendance sort'
      USING ERRCODE = '22023';
  END IF;
  IF v_sort_direction NOT IN ('asc', 'desc') THEN
    RAISE EXCEPTION 'Unknown attendance sort direction'
      USING ERRCODE = '22023';
  END IF;
  IF p_page < 0 THEN
    RAISE EXCEPTION 'Attendance page is out of range'
      USING ERRCODE = '22023';
  END IF;
  IF p_page_size < 1 OR p_page_size > 100 THEN
    RAISE EXCEPTION 'Attendance page size is out of range'
      USING ERRCODE = '22023';
  END IF;

  v_search_pattern := '%' ||
    pg_catalog.replace(
      pg_catalog.replace(
        pg_catalog.replace(pg_catalog.lower(v_search), '\', '\\'),
        '%', '\%'
      ),
      '_', '\_'
    ) || '%';

  RETURN (
    WITH day_attendance AS MATERIALIZED (
      SELECT DISTINCT ON (visit.contact_id)
        visit.id,
        visit.account_id,
        visit.contact_id,
        visit.membership_id,
        visit.user_id,
        visit.checked_in_at,
        visit.checked_out_at,
        visit.method,
        visit.note,
        visit.created_at
      FROM public.attendance AS visit
      WHERE visit.checked_in_at >= p_day_start
        AND visit.checked_in_at < p_day_end
      ORDER BY visit.contact_id, visit.checked_in_at DESC, visit.id DESC
    ),
    base_scope AS MATERIALIZED (
      SELECT
        membership.id AS membership_id,
        membership.plan_id,
        membership.start_date,
        contact.name AS contact_name,
        contact.phone AS contact_phone,
        plan.plan_type,
        plan.attendance_limit_count,
        plan.attendance_limit_interval,
        plan.sessions_count,
        visit.id AS attendance_id,
        visit.checked_in_at,
        visit.checked_out_at,
        jsonb_build_object(
          'id', membership.id,
          'account_id', membership.account_id,
          'contact_id', membership.contact_id,
          'user_id', membership.user_id,
          'plan_id', membership.plan_id,
          'pricing_option_id', membership.pricing_option_id,
          'member_number', membership.member_number,
          'start_date', membership.start_date,
          'end_date', membership.end_date,
          'status', membership.status,
          'fee_amount', membership.fee_amount,
          'fee_status', membership.fee_status,
          'frozen_at', membership.frozen_at,
          'notes', membership.notes,
          'is_trial', membership.is_trial,
          'converted_at', membership.converted_at,
          'collection_mode', membership.collection_mode,
          'conversion_list_price', membership.conversion_list_price,
          'conversion_discount_type', membership.conversion_discount_type,
          'conversion_discount_value', membership.conversion_discount_value,
          'conversion_discount_amount', membership.conversion_discount_amount,
          'conversion_standard_end_date', membership.conversion_standard_end_date,
          'conversion_bonus_months', membership.conversion_bonus_months,
          'created_at', membership.created_at,
          'updated_at', membership.updated_at,
          'contact', jsonb_build_object(
            'id', contact.id,
            'user_id', contact.user_id,
            'account_id', contact.account_id,
            'phone', contact.phone,
            'name', contact.name,
            'email', contact.email,
            'company', contact.company,
            'avatar_url', contact.avatar_url,
            'created_at', contact.created_at,
            'updated_at', contact.updated_at
          ),
          'plan', CASE WHEN plan.id IS NULL THEN NULL ELSE jsonb_build_object(
            'id', plan.id,
            'account_id', plan.account_id,
            'name', plan.name,
            'price', plan.price,
            'duration_days', plan.duration_days,
            'description', plan.description,
            'plan_type', plan.plan_type,
            'attendance_limit_count', plan.attendance_limit_count,
            'attendance_limit_interval', plan.attendance_limit_interval,
            'sessions_count', plan.sessions_count,
            'is_active', plan.is_active,
            'created_at', plan.created_at,
            'updated_at', plan.updated_at
          ) END
        ) AS membership_json,
        CASE WHEN visit.id IS NULL THEN NULL ELSE jsonb_build_object(
          'id', visit.id,
          'account_id', visit.account_id,
          'contact_id', visit.contact_id,
          'membership_id', visit.membership_id,
          'user_id', visit.user_id,
          'checked_in_at', visit.checked_in_at,
          'checked_out_at', visit.checked_out_at,
          'method', visit.method,
          'note', visit.note,
          'created_at', visit.created_at
        ) END AS attendance_json
      FROM public.memberships AS membership
      JOIN public.contacts AS contact
        ON contact.id = membership.contact_id
       AND contact.account_id = membership.account_id
      LEFT JOIN public.membership_plans AS plan
        ON plan.id = membership.plan_id
       AND plan.account_id = membership.account_id
      LEFT JOIN day_attendance AS visit
        ON visit.contact_id = membership.contact_id
       AND visit.account_id = membership.account_id
    ),
    filtered AS MATERIALIZED (
      SELECT scope.*
      FROM base_scope AS scope
      WHERE (p_bucket = 'present') = (scope.attendance_id IS NOT NULL)
        AND (
          pg_catalog.cardinality(v_plan_ids) = 0
          OR scope.plan_id = ANY(v_plan_ids)
        )
        AND (
          v_search = ''
          OR pg_catalog.lower(COALESCE(scope.contact_name, ''))
               COLLATE "und-x-icu" LIKE v_search_pattern ESCAPE '\'
          OR pg_catalog.lower(COALESCE(scope.contact_phone, ''))
               COLLATE "und-x-icu" LIKE v_search_pattern ESCAPE '\'
          OR scope.membership_json->>'member_number'
               LIKE v_search_pattern ESCAPE '\'
        )
    ),
    filtered_count AS (
      SELECT COUNT(*)::INTEGER AS total_count
      FROM filtered
    ),
    page_info AS (
      SELECT
        total_count,
        CASE
          WHEN total_count = 0 THEN 0
          ELSE least(p_page, (total_count - 1) / p_page_size)
        END AS page
      FROM filtered_count
    ),
    page_rows AS MATERIALIZED (
      SELECT
        scope.*,
        ROW_NUMBER() OVER (
          ORDER BY
            CASE WHEN v_sort_key = 'name' AND v_sort_direction = 'asc'
              THEN COALESCE(scope.contact_name, '') END
              COLLATE "und-x-icu" ASC,
            CASE WHEN v_sort_key = 'name' AND v_sort_direction = 'desc'
              THEN COALESCE(scope.contact_name, '') END
              COLLATE "und-x-icu" DESC,
            CASE WHEN v_sort_key = 'checked_in_at' AND v_sort_direction = 'asc'
              THEN scope.checked_in_at END ASC NULLS LAST,
            CASE WHEN v_sort_key = 'checked_in_at' AND v_sort_direction = 'desc'
              THEN scope.checked_in_at END DESC NULLS LAST,
            CASE WHEN v_sort_key = 'checked_out_at' AND v_sort_direction = 'asc'
              THEN scope.checked_out_at END ASC NULLS LAST,
            CASE WHEN v_sort_key = 'checked_out_at' AND v_sort_direction = 'desc'
              THEN scope.checked_out_at END DESC NULLS LAST,
            CASE WHEN v_sort_key IN ('checked_in_at', 'checked_out_at')
              THEN COALESCE(scope.contact_name, '') END
              COLLATE "und-x-icu" ASC,
            scope.membership_id ASC
        ) AS row_order
      FROM filtered AS scope
      ORDER BY
        CASE WHEN v_sort_key = 'name' AND v_sort_direction = 'asc'
          THEN COALESCE(scope.contact_name, '') END
          COLLATE "und-x-icu" ASC,
        CASE WHEN v_sort_key = 'name' AND v_sort_direction = 'desc'
          THEN COALESCE(scope.contact_name, '') END
          COLLATE "und-x-icu" DESC,
        CASE WHEN v_sort_key = 'checked_in_at' AND v_sort_direction = 'asc'
          THEN scope.checked_in_at END ASC NULLS LAST,
        CASE WHEN v_sort_key = 'checked_in_at' AND v_sort_direction = 'desc'
          THEN scope.checked_in_at END DESC NULLS LAST,
        CASE WHEN v_sort_key = 'checked_out_at' AND v_sort_direction = 'asc'
          THEN scope.checked_out_at END ASC NULLS LAST,
        CASE WHEN v_sort_key = 'checked_out_at' AND v_sort_direction = 'desc'
          THEN scope.checked_out_at END DESC NULLS LAST,
        CASE WHEN v_sort_key IN ('checked_in_at', 'checked_out_at')
          THEN COALESCE(scope.contact_name, '') END
          COLLATE "und-x-icu" ASC,
        scope.membership_id ASC
      LIMIT p_page_size
      OFFSET (SELECT page * p_page_size FROM page_info)
    ),
    page_with_windows AS (
      SELECT
        row.*,
        CASE
          WHEN row.plan_type = 'session_pack' AND row.sessions_count IS NOT NULL
            THEN row.start_date
          WHEN row.plan_type <> 'session_pack'
               AND row.attendance_limit_count IS NOT NULL
               AND row.attendance_limit_interval = 'period'
            THEN row.start_date
          WHEN row.plan_type <> 'session_pack'
               AND row.attendance_limit_count IS NOT NULL
               AND row.attendance_limit_interval = 'month'
            THEN pg_catalog.date_trunc('month', p_today::TIMESTAMP)::DATE
          WHEN row.plan_type <> 'session_pack'
               AND row.attendance_limit_count IS NOT NULL
               AND row.attendance_limit_interval = 'week'
            THEN p_today - (
              (
                EXTRACT(DOW FROM p_today)::INTEGER
                - p_week_start + 7
              ) % 7
            )
          ELSE NULL
        END AS usage_start_date
      FROM page_rows AS row
    ),
    result_rows AS (
      SELECT
        row.membership_json,
        row.attendance_json,
        row.row_order,
        COALESCE(usage.used, 0)::BIGINT AS used
      FROM page_with_windows AS row
      LEFT JOIN LATERAL (
        SELECT COUNT(visit.id)::BIGINT AS used
        FROM public.attendance AS visit
        WHERE p_include_usage
          AND row.usage_start_date IS NOT NULL
          AND visit.membership_id = row.membership_id
          AND visit.checked_in_at >= (
            row.usage_start_date::TIMESTAMP AT TIME ZONE p_time_zone
          )
      ) AS usage ON TRUE
    ),
    facets AS (
      SELECT
        COUNT(*) FILTER (WHERE attendance_id IS NOT NULL)::INTEGER
          AS present_count,
        COUNT(*) FILTER (WHERE attendance_id IS NULL)::INTEGER
          AS absent_count
      FROM base_scope
    ),
    plan_options AS (
      SELECT COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'value', option.plan_id,
            'label', option.plan_name
          )
          ORDER BY option.plan_name COLLATE "und-x-icu", option.plan_id
        ),
        '[]'::JSONB
      ) AS options
      FROM (
        SELECT DISTINCT
          scope.plan_id,
          scope.membership_json->'plan'->>'name' AS plan_name
        FROM base_scope AS scope
        WHERE scope.plan_id IS NOT NULL
          AND scope.membership_json->'plan' <> 'null'::JSONB
      ) AS option
    )
    SELECT jsonb_build_object(
      'rows', COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object(
            'membership', row.membership_json,
            'attendance', row.attendance_json,
            'used', row.used
          )
          ORDER BY row.row_order
        )
        FROM result_rows AS row
      ), '[]'::JSONB),
      'page', page_info.page,
      'totalCount', page_info.total_count,
      'presentCount', facets.present_count,
      'absentCount', facets.absent_count,
      'planOptions', plan_options.options
    )
    FROM page_info
    CROSS JOIN facets
    CROSS JOIN plan_options
  );
END;
$$;

ALTER FUNCTION public.member_attendance_page(
  TIMESTAMPTZ, TIMESTAMPTZ, DATE, TEXT, INTEGER, BOOLEAN, TEXT, TEXT,
  UUID[], TEXT, TEXT, INTEGER, INTEGER
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.member_attendance_page(
  TIMESTAMPTZ, TIMESTAMPTZ, DATE, TEXT, INTEGER, BOOLEAN, TEXT, TEXT,
  UUID[], TEXT, TEXT, INTEGER, INTEGER
) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.member_attendance_page(
  TIMESTAMPTZ, TIMESTAMPTZ, DATE, TEXT, INTEGER, BOOLEAN, TEXT, TEXT,
  UUID[], TEXT, TEXT, INTEGER, INTEGER
) TO authenticated;
