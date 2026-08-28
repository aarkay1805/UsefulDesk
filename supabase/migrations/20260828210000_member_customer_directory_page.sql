-- Collapse the All-members page, exact total, and quick-filter counts into one
-- RLS-preserving database call. The directory keeps its public row contract,
-- but computes memberships, services, balances, and follow-ups set-wise instead
-- of repeating correlated lateral work for every contact.

CREATE OR REPLACE VIEW public.member_customer_directory
WITH (security_invoker = true) AS
WITH latest_membership AS (
  SELECT DISTINCT ON (candidate.account_id, candidate.contact_id)
    candidate.*
  FROM public.memberships AS candidate
  ORDER BY
    candidate.account_id,
    candidate.contact_id,
    candidate.updated_at DESC,
    candidate.id DESC
),
services AS (
  SELECT
    service.account_id,
    service.contact_id,
    COALESCE(
      MIN(service.end_date) FILTER (
        WHERE service.status = 'active'
          AND service.end_date >= (
            NOW() AT TIME ZONE account.timezone
          )::DATE
      ),
      MAX(service.end_date)
    ) AS service_expiry,
    COUNT(service.id)::INTEGER AS service_count
  FROM public.member_services AS service
  JOIN public.accounts AS account ON account.id = service.account_id
  GROUP BY service.account_id, service.contact_id
),
billing AS (
  SELECT
    invoice.account_id,
    invoice.contact_id,
    COALESCE(SUM(invoice.collectible_balance), 0)::NUMERIC(12, 2)
      AS generic_balance
  FROM public.invoice_balances AS invoice
  WHERE invoice.state = 'open'
  GROUP BY invoice.account_id, invoice.contact_id
),
open_follow_ups AS (
  SELECT
    follow_up.account_id,
    follow_up.contact_id,
    COUNT(follow_up.id)::INTEGER AS open_follow_up_count
  FROM public.follow_ups AS follow_up
  WHERE follow_up.status = 'open'
  GROUP BY follow_up.account_id, follow_up.contact_id
)
SELECT
  contact.account_id,
  contact.id AS contact_id,
  CASE
    WHEN membership.id IS NULL THEN 'service'::TEXT
    ELSE 'membership'::TEXT
  END AS customer_kind,
  membership.id AS membership_id,
  membership.member_number,
  membership.user_id AS membership_user_id,
  membership.plan_id,
  membership.pricing_option_id,
  membership.start_date AS membership_start_date,
  membership.end_date AS membership_end_date,
  membership.status AS membership_status,
  membership.fee_amount AS membership_fee_amount,
  membership.fee_status AS membership_fee_status,
  COALESCE(membership.is_trial, false) AS membership_is_trial,
  membership.frozen_at AS membership_frozen_at,
  membership.collection_mode AS membership_collection_mode,
  membership.created_at AS membership_created_at,
  membership.updated_at AS membership_updated_at,
  services.service_expiry,
  CASE
    WHEN membership.id IS NULL THEN services.service_expiry
    ELSE membership.end_date
  END AS display_expiry,
  COALESCE(services.service_count, 0)::INTEGER AS service_count,
  COALESCE(billing.generic_balance, 0)::NUMERIC(12, 2) AS generic_balance,
  COALESCE(open_follow_ups.open_follow_up_count, 0)::INTEGER
    AS open_follow_up_count,
  contact.name AS contact_name,
  contact.phone AS contact_phone,
  contact.email AS contact_email,
  contact.avatar_url AS contact_avatar_url,
  contact.assigned_to AS contact_assigned_to,
  contact.churn_risk AS contact_churn_risk,
  to_jsonb(contact) AS contact,
  CASE WHEN plan.id IS NULL THEN NULL ELSE to_jsonb(plan) END AS plan
FROM public.contacts AS contact
JOIN public.accounts AS account ON account.id = contact.account_id
LEFT JOIN latest_membership AS membership
  ON membership.account_id = contact.account_id
 AND membership.contact_id = contact.id
LEFT JOIN public.membership_plans AS plan ON plan.id = membership.plan_id
LEFT JOIN services
  ON services.account_id = contact.account_id
 AND services.contact_id = contact.id
LEFT JOIN billing
  ON billing.account_id = contact.account_id
 AND billing.contact_id = contact.id
LEFT JOIN open_follow_ups
  ON open_follow_ups.account_id = contact.account_id
 AND open_follow_ups.contact_id = contact.id
WHERE membership.id IS NOT NULL OR COALESCE(services.service_count, 0) > 0;

GRANT SELECT ON public.member_customer_directory TO authenticated, service_role;
REVOKE ALL ON public.member_customer_directory FROM anon;

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
  v_plan_ids UUID[] := COALESCE(p_plan_ids, ARRAY[]::UUID[]);
  v_statuses TEXT[] := COALESCE(p_statuses, ARRAY[]::TEXT[]);
  v_fee_statuses TEXT[] := COALESCE(p_fee_statuses, ARRAY[]::TEXT[]);
  v_churn_risk TEXT[] := COALESCE(p_churn_risk, ARRAY[]::TEXT[]);
  v_follow_ups TEXT[] := COALESCE(p_follow_ups, ARRAY[]::TEXT[]);
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
  IF v_sort_key NOT IN (
    'contact_name',
    'member_number',
    'display_expiry',
    'membership_fee_amount',
    'membership_fee_status',
    'membership_start_date'
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
        pg_catalog.cardinality(v_churn_risk) <> 1
        OR directory.contact_churn_risk = (v_churn_risk[1] = 'yes')
      ) AS churn_matches,
      (
        pg_catalog.cardinality(v_follow_ups) = 0
        OR directory.open_follow_up_count > 0
      ) AS follow_up_matches
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
          evaluated.contact_id
      ) AS row_order
    FROM evaluated
    WHERE evaluated.plan_matches
      AND evaluated.status_matches
      AND evaluated.fee_matches
      AND evaluated.churn_matches
      AND evaluated.follow_up_matches
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
              'churn_matches',
              'follow_up_matches',
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
        AND evaluated.churn_matches
        AND evaluated.follow_up_matches
    ),
    'quickFilterCounts', pg_catalog.jsonb_build_object(
      'churnRisk', (
        SELECT COUNT(*)
        FROM evaluated
        WHERE evaluated.plan_matches
          AND evaluated.status_matches
          AND evaluated.fee_matches
          AND evaluated.contact_churn_risk = TRUE
          AND evaluated.follow_up_matches
      ),
      'feesDue', (
        SELECT COUNT(*)
        FROM evaluated
        WHERE evaluated.plan_matches
          AND evaluated.status_matches
          AND evaluated.customer_kind = 'membership'
          AND evaluated.membership_fee_status = 'due'
          AND evaluated.churn_matches
          AND evaluated.follow_up_matches
      ),
      'followUps', (
        SELECT COUNT(*)
        FROM evaluated
        WHERE evaluated.plan_matches
          AND evaluated.status_matches
          AND evaluated.fee_matches
          AND evaluated.churn_matches
          AND evaluated.open_follow_up_count > 0
      )
    )
  )
  INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.member_customer_directory_page(
  DATE, TEXT, UUID[], TEXT[], TEXT[], TEXT[], TEXT[], TEXT, TEXT, INTEGER, INTEGER
) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.member_customer_directory_page(
  DATE, TEXT, UUID[], TEXT[], TEXT[], TEXT[], TEXT[], TEXT, TEXT, INTEGER, INTEGER
) TO authenticated;

COMMENT ON FUNCTION public.member_customer_directory_page(
  DATE, TEXT, UUID[], TEXT[], TEXT[], TEXT[], TEXT[], TEXT, TEXT, INTEGER, INTEGER
) IS 'One RLS-invoker All-members page, total, and quick-filter snapshot; NULL page size returns all matching rows for explicit export/select-all actions.';
