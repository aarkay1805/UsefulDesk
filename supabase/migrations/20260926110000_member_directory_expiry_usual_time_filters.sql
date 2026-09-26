-- Extend the one RLS-invoker directory boundary with display-expiry and usual-time facets.
-- The new trailing defaults keep existing clients working during rollout.

DROP FUNCTION IF EXISTS public.member_customer_directory_page(DATE, TEXT, UUID[], TEXT[], TEXT[], TEXT[], TEXT[], TEXT, TEXT, INTEGER, INTEGER, UUID[], BOOLEAN, UUID[], BOOLEAN);

CREATE OR REPLACE FUNCTION public.member_customer_directory_page(
  p_today DATE,
  p_search TEXT,
  p_plan_ids UUID[],
  p_statuses TEXT[],
  p_fee_statuses TEXT[],
  p_churn_risk TEXT[],
  p_follow_ups TEXT[],
  p_sort_key TEXT,
  p_sort_direction TEXT,
  p_page INTEGER,
  p_page_size INTEGER,
  p_assignee_ids UUID[] DEFAULT ARRAY[]::UUID[],
  p_include_unassigned BOOLEAN DEFAULT FALSE,
  p_trainer_ids UUID[] DEFAULT ARRAY[]::UUID[],
  p_include_no_trainer BOOLEAN DEFAULT FALSE,
  p_expiry_filters TEXT[] DEFAULT ARRAY[]::TEXT[],
  p_expiry_from DATE DEFAULT NULL,
  p_expiry_to DATE DEFAULT NULL,
  p_usual_times TEXT[] DEFAULT ARRAY[]::TEXT[]
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_search TEXT := pg_catalog.btrim(COALESCE(p_search, ''));
  v_plan_ids UUID[] := COALESCE(p_plan_ids, ARRAY[]::UUID[]);
  v_statuses TEXT[] := COALESCE(p_statuses, ARRAY[]::TEXT[]);
  v_fee_statuses TEXT[] := COALESCE(p_fee_statuses, ARRAY[]::TEXT[]);
  v_assignee_ids UUID[] := COALESCE(p_assignee_ids, ARRAY[]::UUID[]);
  v_include_unassigned BOOLEAN := COALESCE(p_include_unassigned, FALSE);
  v_trainer_ids UUID[] := COALESCE(p_trainer_ids, ARRAY[]::UUID[]);
  v_include_no_trainer BOOLEAN := COALESCE(p_include_no_trainer, FALSE);
  v_churn_risk TEXT[] := COALESCE(p_churn_risk, ARRAY[]::TEXT[]);
  v_follow_ups TEXT[] := COALESCE(p_follow_ups, ARRAY[]::TEXT[]);
  v_expiry_filters TEXT[] := COALESCE(p_expiry_filters, ARRAY[]::TEXT[]);
  v_usual_times TEXT[] := COALESCE(p_usual_times, ARRAY[]::TEXT[]);
  v_sort_key TEXT := COALESCE(p_sort_key, 'display_expiry');
  v_sort_direction TEXT := COALESCE(p_sort_direction, 'asc');
  v_offset INTEGER;
  v_result JSONB;
BEGIN
  IF p_today IS NULL THEN
    RAISE EXCEPTION 'Member directory date is required'
      USING ERRCODE = '22004';
  END IF;
  IF p_page IS NULL OR p_page < 0 THEN
    RAISE EXCEPTION 'Member directory page must be zero or greater'
      USING ERRCODE = '22023';
  END IF;
  IF p_page_size IS NOT NULL AND (p_page_size < 1 OR p_page_size > 1000) THEN
    RAISE EXCEPTION 'Member directory page size must be between 1 and 1000'
      USING ERRCODE = '22023';
  END IF;
  IF p_page_size IS NULL AND p_page <> 0 THEN
    RAISE EXCEPTION 'An unbounded member directory read must start at page zero'
      USING ERRCODE = '22023';
  END IF;
  IF NOT v_statuses <@ ARRAY[
    'active', 'expired', 'frozen', 'cancelled', 'trial', 'service_customer'
  ]::TEXT[] THEN
    RAISE EXCEPTION 'Member directory status filter is invalid'
      USING ERRCODE = '22023';
  END IF;
  IF NOT v_fee_statuses <@ ARRAY['paid', 'due']::TEXT[] THEN
    RAISE EXCEPTION 'Member directory fee-status filter is invalid'
      USING ERRCODE = '22023';
  END IF;
  IF NOT v_churn_risk <@ ARRAY['yes', 'no']::TEXT[]
     OR pg_catalog.cardinality(v_churn_risk) > 2 THEN
    RAISE EXCEPTION 'Member directory churn-risk filter is invalid'
      USING ERRCODE = '22023';
  END IF;
  IF NOT v_follow_ups <@ ARRAY['open']::TEXT[] THEN
    RAISE EXCEPTION 'Member directory follow-up filter is invalid'
      USING ERRCODE = '22023';
  END IF;
  IF NOT v_expiry_filters <@ ARRAY[
    'today', 'next7', 'next30', 'expired', 'custom', 'no_expiry'
  ]::TEXT[] THEN
    RAISE EXCEPTION 'Member directory expiry filter is invalid'
      USING ERRCODE = '22023';
  END IF;
  IF 'custom' = ANY(v_expiry_filters)
     AND (p_expiry_from IS NULL OR p_expiry_to IS NULL
       OR p_expiry_from > p_expiry_to) THEN
    RAISE EXCEPTION 'Member directory expiry range is invalid'
      USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.unnest(v_usual_times) AS chosen(value)
    WHERE chosen.value NOT IN (
      'morning', 'afternoon', 'evening', 'overnight', 'unassigned'
    )
      AND chosen.value !~ '^time:([01][0-9]|2[0-3]):(00|30)$'
  ) THEN
    RAISE EXCEPTION 'Member directory usual-time filter is invalid'
      USING ERRCODE = '22023';
  END IF;
  IF v_sort_key NOT IN (
    'contact_name',
    'member_number',
    'display_expiry',
    'membership_fee_amount',
    'membership_fee_status',
    'membership_start_date',
    'assigned_arrival_time'
  ) THEN
    RAISE EXCEPTION 'Member directory sort is invalid'
      USING ERRCODE = '22023';
  END IF;
  IF v_sort_direction NOT IN ('asc', 'desc') THEN
    RAISE EXCEPTION 'Member directory sort direction is invalid'
      USING ERRCODE = '22023';
  END IF;

  v_offset := CASE
    WHEN p_page_size IS NULL THEN 0
    ELSE p_page * p_page_size
  END;

  WITH directory AS MATERIALIZED (
    SELECT directory_row.*
    FROM public.member_customer_directory AS directory_row
    WHERE v_search = ''
      OR (
        v_search ~ '^[0-9]+$'
        AND (
          directory_row.contact_name ILIKE '%' || v_search || '%'
          OR directory_row.contact_phone ILIKE '%' || v_search || '%'
          OR directory_row.member_number::TEXT ILIKE '%' || v_search || '%'
        )
      )
      OR (
        v_search !~ '^[0-9]+$'
        AND (
          directory_row.contact_name ILIKE '%' || v_search || '%'
          OR directory_row.contact_phone ILIKE '%' || v_search || '%'
          OR directory_row.contact_email ILIKE '%' || v_search || '%'
        )
      )
  ),
  evaluated AS MATERIALIZED (
    SELECT
      directory.*,
      (
        pg_catalog.cardinality(v_plan_ids) = 0
        OR (
          directory.customer_kind = 'membership'
          AND directory.plan_id = ANY(v_plan_ids)
        )
      ) AS plan_matches,
      (
        pg_catalog.cardinality(v_statuses) = 0
        OR (
          'active' = ANY(v_statuses)
          AND directory.customer_kind = 'membership'
          AND directory.membership_status = 'active'
          AND directory.membership_is_trial = FALSE
          AND directory.membership_end_date >= p_today
        )
        OR (
          'expired' = ANY(v_statuses)
          AND directory.customer_kind = 'membership'
          AND directory.membership_status = 'active'
          AND directory.membership_is_trial = FALSE
          AND directory.membership_end_date < p_today
        )
        OR (
          'frozen' = ANY(v_statuses)
          AND directory.customer_kind = 'membership'
          AND directory.membership_status = 'frozen'
        )
        OR (
          'cancelled' = ANY(v_statuses)
          AND directory.customer_kind = 'membership'
          AND directory.membership_status = 'cancelled'
        )
        OR (
          'trial' = ANY(v_statuses)
          AND directory.customer_kind = 'membership'
          AND directory.membership_is_trial = TRUE
        )
        OR (
          'service_customer' = ANY(v_statuses)
          AND directory.customer_kind = 'service'
        )
      ) AS status_matches,
      (
        pg_catalog.cardinality(v_fee_statuses) = 0
        OR (
          directory.customer_kind = 'membership'
          AND directory.membership_fee_status = ANY(v_fee_statuses)
        )
      ) AS fee_matches,
      (
        (
          pg_catalog.cardinality(v_assignee_ids) = 0
          AND NOT v_include_unassigned
        )
        OR directory.contact_assigned_to = ANY(v_assignee_ids)
        OR (
          v_include_unassigned
          AND directory.contact_assigned_to IS NULL
        )
      ) AS assignee_matches,
      (
        (
          pg_catalog.cardinality(v_trainer_ids) = 0
          AND NOT v_include_no_trainer
        )
        OR (
          directory.contact ->> 'trainer_id'
        )::UUID = ANY(v_trainer_ids)
        OR (
          v_include_no_trainer
          AND directory.contact ->> 'trainer_id' IS NULL
        )
      ) AS trainer_matches,
      (
        pg_catalog.cardinality(v_churn_risk) <> 1
        OR directory.contact_churn_risk = (v_churn_risk[1] = 'yes')
      ) AS churn_matches,
      (
        pg_catalog.cardinality(v_follow_ups) = 0
        OR directory.open_follow_up_count > 0
      ) AS follow_up_matches,
      (
        pg_catalog.cardinality(v_expiry_filters) = 0
        OR ('today' = ANY(v_expiry_filters) AND directory.display_expiry = p_today)
        OR ('next7' = ANY(v_expiry_filters)
          AND directory.display_expiry BETWEEN p_today AND p_today + 6)
        OR ('next30' = ANY(v_expiry_filters)
          AND directory.display_expiry BETWEEN p_today AND p_today + 29)
        OR ('expired' = ANY(v_expiry_filters)
          AND directory.display_expiry < p_today)
        OR ('custom' = ANY(v_expiry_filters)
          AND directory.display_expiry BETWEEN p_expiry_from AND p_expiry_to)
        OR ('no_expiry' = ANY(v_expiry_filters)
          AND directory.display_expiry IS NULL)
      ) AS expiry_matches,
      (
        pg_catalog.cardinality(v_usual_times) = 0
        OR ('unassigned' = ANY(v_usual_times)
          AND directory.contact ->> 'assigned_arrival_time' IS NULL)
        OR EXISTS (
          SELECT 1 FROM pg_catalog.unnest(v_usual_times) AS chosen(value)
          WHERE
            (chosen.value = 'morning' AND
              pg_catalog.left(directory.contact ->> 'assigned_arrival_time', 5)
                BETWEEN '05:00' AND '11:30')
            OR (chosen.value = 'afternoon' AND
              pg_catalog.left(directory.contact ->> 'assigned_arrival_time', 5)
                BETWEEN '12:00' AND '16:30')
            OR (chosen.value = 'evening' AND
              pg_catalog.left(directory.contact ->> 'assigned_arrival_time', 5)
                BETWEEN '17:00' AND '23:30')
            OR (chosen.value = 'overnight' AND
              pg_catalog.left(directory.contact ->> 'assigned_arrival_time', 5)
                BETWEEN '00:00' AND '04:30')
            OR (chosen.value LIKE 'time:%' AND
              pg_catalog.left(directory.contact ->> 'assigned_arrival_time', 5)
                = pg_catalog.substr(chosen.value, 6))
        )
      ) AS usual_time_matches
    FROM directory
  ),
  ordered AS (
    SELECT
      evaluated.*,
      pg_catalog.row_number() OVER (
        ORDER BY
          CASE WHEN v_sort_key = 'contact_name' AND v_sort_direction = 'asc'
            THEN evaluated.contact_name END ASC NULLS LAST,
          CASE WHEN v_sort_key = 'contact_name' AND v_sort_direction = 'desc'
            THEN evaluated.contact_name END DESC NULLS FIRST,
          CASE WHEN v_sort_key = 'member_number' AND v_sort_direction = 'asc'
            THEN evaluated.member_number END ASC NULLS LAST,
          CASE WHEN v_sort_key = 'member_number' AND v_sort_direction = 'desc'
            THEN evaluated.member_number END DESC NULLS FIRST,
          CASE WHEN v_sort_key = 'display_expiry' AND v_sort_direction = 'asc'
            THEN evaluated.display_expiry END ASC NULLS LAST,
          CASE WHEN v_sort_key = 'display_expiry' AND v_sort_direction = 'desc'
            THEN evaluated.display_expiry END DESC NULLS FIRST,
          CASE WHEN v_sort_key = 'membership_fee_amount' AND v_sort_direction = 'asc'
            THEN evaluated.membership_fee_amount END ASC NULLS LAST,
          CASE WHEN v_sort_key = 'membership_fee_amount' AND v_sort_direction = 'desc'
            THEN evaluated.membership_fee_amount END DESC NULLS FIRST,
          CASE WHEN v_sort_key = 'membership_fee_status' AND v_sort_direction = 'asc'
            THEN evaluated.membership_fee_status END ASC NULLS LAST,
          CASE WHEN v_sort_key = 'membership_fee_status' AND v_sort_direction = 'desc'
            THEN evaluated.membership_fee_status END DESC NULLS FIRST,
          CASE WHEN v_sort_key = 'membership_start_date' AND v_sort_direction = 'asc'
            THEN evaluated.membership_start_date END ASC NULLS LAST,
          CASE WHEN v_sort_key = 'membership_start_date' AND v_sort_direction = 'desc'
            THEN evaluated.membership_start_date END DESC NULLS FIRST,
          CASE WHEN v_sort_key = 'assigned_arrival_time' AND v_sort_direction = 'asc'
            THEN (evaluated.contact ->> 'assigned_arrival_time')::TIME END ASC NULLS LAST,
          CASE WHEN v_sort_key = 'assigned_arrival_time' AND v_sort_direction = 'desc'
            THEN (evaluated.contact ->> 'assigned_arrival_time')::TIME END DESC NULLS LAST,
          evaluated.contact_id
      ) AS row_order
    FROM evaluated
    WHERE evaluated.plan_matches
      AND evaluated.status_matches
      AND evaluated.fee_matches
      AND evaluated.assignee_matches
      AND evaluated.trainer_matches
      AND evaluated.churn_matches
      AND evaluated.follow_up_matches
      AND evaluated.expiry_matches
      AND evaluated.usual_time_matches
  ),
  page_rows AS MATERIALIZED (
    SELECT ordered.*
    FROM ordered
    ORDER BY ordered.row_order
    LIMIT p_page_size
    OFFSET v_offset
  )
  SELECT pg_catalog.jsonb_build_object(
    'rows', COALESCE(
      (
        SELECT pg_catalog.jsonb_agg(
          pg_catalog.to_jsonb(page_rows)
            - ARRAY[
              'plan_matches',
              'status_matches',
              'fee_matches',
              'assignee_matches',
              'trainer_matches',
              'churn_matches',
              'follow_up_matches',
              'expiry_matches',
              'usual_time_matches',
              'row_order'
            ]::TEXT[]
          ORDER BY page_rows.row_order
        )
        FROM page_rows
      ),
      '[]'::JSONB
    ),
    'totalCount', (
      SELECT COUNT(*)
      FROM evaluated
      WHERE evaluated.plan_matches
        AND evaluated.status_matches
        AND evaluated.fee_matches
        AND evaluated.assignee_matches
        AND evaluated.trainer_matches
        AND evaluated.churn_matches
        AND evaluated.follow_up_matches
      AND evaluated.expiry_matches
      AND evaluated.usual_time_matches
    ),
    'quickFilterCounts', pg_catalog.jsonb_build_object(
      'churnRisk', (
        SELECT COUNT(*)
        FROM evaluated
        WHERE evaluated.plan_matches
          AND evaluated.status_matches
          AND evaluated.fee_matches
          AND evaluated.assignee_matches
          AND evaluated.trainer_matches
          AND evaluated.contact_churn_risk = TRUE
          AND evaluated.follow_up_matches
      AND evaluated.expiry_matches
      AND evaluated.usual_time_matches
      ),
      'feesDue', (
        SELECT COUNT(*)
        FROM evaluated
        WHERE evaluated.plan_matches
          AND evaluated.status_matches
          AND evaluated.customer_kind = 'membership'
          AND evaluated.membership_fee_status = 'due'
          AND evaluated.assignee_matches
          AND evaluated.trainer_matches
          AND evaluated.churn_matches
          AND evaluated.follow_up_matches
      AND evaluated.expiry_matches
      AND evaluated.usual_time_matches
      ),
      'followUps', (
        SELECT COUNT(*)
        FROM evaluated
        WHERE evaluated.plan_matches
          AND evaluated.status_matches
          AND evaluated.fee_matches
          AND evaluated.assignee_matches
          AND evaluated.trainer_matches
          AND evaluated.churn_matches
          AND evaluated.open_follow_up_count > 0
          AND evaluated.expiry_matches
          AND evaluated.usual_time_matches
      )
    )
  )
  INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.member_customer_directory_page(
  DATE, TEXT, UUID[], TEXT[], TEXT[], TEXT[], TEXT[], TEXT, TEXT, INTEGER, INTEGER, UUID[], BOOLEAN, UUID[], BOOLEAN, TEXT[], DATE, DATE, TEXT[]
) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.member_customer_directory_page(
  DATE, TEXT, UUID[], TEXT[], TEXT[], TEXT[], TEXT[], TEXT, TEXT, INTEGER, INTEGER, UUID[], BOOLEAN, UUID[], BOOLEAN, TEXT[], DATE, DATE, TEXT[]
) TO authenticated;

COMMENT ON FUNCTION public.member_customer_directory_page(
  DATE, TEXT, UUID[], TEXT[], TEXT[], TEXT[], TEXT[], TEXT, TEXT, INTEGER, INTEGER, UUID[], BOOLEAN, UUID[], BOOLEAN, TEXT[], DATE, DATE, TEXT[]
) IS 'One RLS-invoker All-members page, total, and quick-filter snapshot with display-expiry and usual-time facets; NULL page size returns all matching rows for explicit export/select-all actions.';
