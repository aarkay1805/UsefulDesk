-- Billing-option detail for the owner report's plan-performance accordion.
-- SECURITY INVOKER keeps every base-table read behind the caller's existing
-- account RLS. The browser supplies calendar dates plus the account timezone
-- so attendance is attributed to the billing period active on the visit day.

CREATE OR REPLACE FUNCTION public.owner_report_plan_options(
  p_start_date DATE,
  p_end_date DATE,
  p_time_zone TEXT DEFAULT 'UTC'
)
RETURNS JSONB
LANGUAGE SQL
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH
  raw_params AS (
    SELECT
      COALESCE(p_start_date, CURRENT_DATE - 29) AS supplied_start,
      COALESCE(p_end_date, CURRENT_DATE) AS supplied_end,
      COALESCE(NULLIF(BTRIM(p_time_zone), ''), 'UTC') AS tz
  ),
  ranges AS (
    SELECT
      LEAST(supplied_start, supplied_end) AS report_start,
      GREATEST(supplied_start, supplied_end) AS report_end,
      tz,
      (NOW() AT TIME ZONE tz)::DATE AS today,
      LEAST(supplied_start, supplied_end)::TIMESTAMP
        AT TIME ZONE tz AS current_start_at,
      (GREATEST(supplied_start, supplied_end) + 1)::TIMESTAMP
        AT TIME ZONE tz AS current_end_at
    FROM raw_params
  ),
  initial_period AS (
    SELECT DISTINCT ON (period.membership_id)
      period.membership_id,
      period.plan_id,
      period.pricing_option_id
    FROM public.membership_periods AS period
    ORDER BY
      period.membership_id,
      period.period_start,
      period.created_at,
      period.id
  ),
  option_active AS (
    SELECT
      membership.plan_id,
      membership.pricing_option_id,
      COUNT(*)::BIGINT AS value
    FROM public.memberships AS membership
    CROSS JOIN ranges AS range
    WHERE membership.status = 'active'
      AND membership.is_trial = FALSE
      AND membership.end_date >= range.today
      AND membership.plan_id IS NOT NULL
    GROUP BY membership.plan_id, membership.pricing_option_id
  ),
  option_new AS (
    SELECT
      COALESCE(initial.plan_id, membership.plan_id) AS plan_id,
      COALESCE(
        initial.pricing_option_id,
        membership.pricing_option_id
      ) AS pricing_option_id,
      COUNT(*)::BIGINT AS value
    FROM public.memberships AS membership
    CROSS JOIN ranges AS range
    LEFT JOIN initial_period AS initial
      ON initial.membership_id = membership.id
    WHERE membership.is_trial = FALSE
      AND COALESCE(membership.converted_at, membership.created_at)
        >= range.current_start_at
      AND COALESCE(membership.converted_at, membership.created_at)
        < range.current_end_at
      AND COALESCE(initial.plan_id, membership.plan_id) IS NOT NULL
    GROUP BY
      COALESCE(initial.plan_id, membership.plan_id),
      COALESCE(initial.pricing_option_id, membership.pricing_option_id)
  ),
  option_revenue AS (
    SELECT
      COALESCE(
        payment.plan_id,
        period.plan_id,
        membership.plan_id
      ) AS plan_id,
      COALESCE(
        period.pricing_option_id,
        membership.pricing_option_id
      ) AS pricing_option_id,
      SUM(payment.amount)::NUMERIC AS value
    FROM public.payments AS payment
    CROSS JOIN ranges AS range
    LEFT JOIN public.membership_periods AS period
      ON period.membership_id = payment.membership_id
      AND period.period_end IS NOT DISTINCT FROM payment.period_end
    LEFT JOIN public.memberships AS membership
      ON membership.id = payment.membership_id
    WHERE payment.status = 'paid'
      AND payment.paid_at >= range.current_start_at
      AND payment.paid_at < range.current_end_at
      AND COALESCE(
        payment.plan_id,
        period.plan_id,
        membership.plan_id
      ) IS NOT NULL
    GROUP BY
      COALESCE(payment.plan_id, period.plan_id, membership.plan_id),
      COALESCE(period.pricing_option_id, membership.pricing_option_id)
  ),
  option_visits AS (
    SELECT
      COALESCE(period.plan_id, membership.plan_id) AS plan_id,
      COALESCE(
        period.pricing_option_id,
        membership.pricing_option_id
      ) AS pricing_option_id,
      COUNT(attendance.id)::BIGINT AS value
    FROM public.attendance AS attendance
    CROSS JOIN ranges AS range
    JOIN public.memberships AS membership
      ON membership.id = attendance.membership_id
    LEFT JOIN LATERAL (
      SELECT
        candidate.plan_id,
        candidate.pricing_option_id
      FROM public.membership_periods AS candidate
      WHERE candidate.membership_id = attendance.membership_id
        AND (attendance.checked_in_at AT TIME ZONE range.tz)::DATE
          BETWEEN candidate.period_start AND candidate.period_end
      ORDER BY
        candidate.period_start DESC,
        candidate.created_at DESC,
        candidate.id DESC
      LIMIT 1
    ) AS period ON TRUE
    WHERE attendance.checked_in_at >= range.current_start_at
      AND attendance.checked_in_at < range.current_end_at
      AND COALESCE(period.plan_id, membership.plan_id) IS NOT NULL
    GROUP BY
      COALESCE(period.plan_id, membership.plan_id),
      COALESCE(period.pricing_option_id, membership.pricing_option_id)
  ),
  unassigned_keys AS (
    SELECT plan_id FROM option_active WHERE pricing_option_id IS NULL
    UNION
    SELECT plan_id FROM option_new WHERE pricing_option_id IS NULL
    UNION
    SELECT plan_id FROM option_revenue WHERE pricing_option_id IS NULL
    UNION
    SELECT plan_id FROM option_visits WHERE pricing_option_id IS NULL
  ),
  option_dimensions AS (
    SELECT
      option.plan_id,
      option.id,
      option.duration_count,
      option.duration_unit,
      option.price,
      option.is_active,
      option.sort_order
    FROM public.plan_pricing_options AS option

    UNION ALL

    SELECT
      unassigned.plan_id,
      NULL::UUID AS id,
      NULL::INTEGER AS duration_count,
      NULL::TEXT AS duration_unit,
      NULL::NUMERIC AS price,
      FALSE AS is_active,
      2147483647 AS sort_order
    FROM unassigned_keys AS unassigned
  ),
  option_breakdown AS (
    SELECT
      dimension.plan_id,
      dimension.id,
      dimension.duration_count,
      dimension.duration_unit,
      dimension.price,
      dimension.sort_order,
      COALESCE(active.value, 0)::BIGINT AS active_members,
      COALESCE(new_members.value, 0)::BIGINT AS new_members,
      COALESCE(revenue.value, 0)::NUMERIC AS revenue,
      COALESCE(visits.value, 0)::BIGINT AS visits
    FROM option_dimensions AS dimension
    LEFT JOIN option_active AS active
      ON active.plan_id = dimension.plan_id
      AND active.pricing_option_id IS NOT DISTINCT FROM dimension.id
    LEFT JOIN option_new AS new_members
      ON new_members.plan_id = dimension.plan_id
      AND new_members.pricing_option_id IS NOT DISTINCT FROM dimension.id
    LEFT JOIN option_revenue AS revenue
      ON revenue.plan_id = dimension.plan_id
      AND revenue.pricing_option_id IS NOT DISTINCT FROM dimension.id
    LEFT JOIN option_visits AS visits
      ON visits.plan_id = dimension.plan_id
      AND visits.pricing_option_id IS NOT DISTINCT FROM dimension.id
    WHERE dimension.is_active
      OR COALESCE(active.value, 0) > 0
      OR COALESCE(new_members.value, 0) > 0
      OR COALESCE(revenue.value, 0) > 0
      OR COALESCE(visits.value, 0) > 0
  ),
  plans AS (
    SELECT
      breakdown.plan_id,
      JSONB_AGG(
        JSONB_BUILD_OBJECT(
          'id', breakdown.id,
          'durationCount', breakdown.duration_count,
          'durationUnit', breakdown.duration_unit,
          'price', breakdown.price,
          'activeMembers', breakdown.active_members,
          'newMembers', breakdown.new_members,
          'revenue', breakdown.revenue,
          'visits', breakdown.visits
        )
        ORDER BY
          breakdown.sort_order,
          breakdown.duration_count,
          breakdown.id
      ) AS billing_options
    FROM option_breakdown AS breakdown
    GROUP BY breakdown.plan_id
  )
  SELECT COALESCE(
    JSONB_AGG(
      JSONB_BUILD_OBJECT(
        'planId', plan.plan_id,
        'billingOptions', plan.billing_options
      )
      ORDER BY plan.plan_id
    ),
    '[]'::JSONB
  )
  FROM plans AS plan;
$$;

ALTER FUNCTION public.owner_report_plan_options(DATE, DATE, TEXT)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.owner_report_plan_options(DATE, DATE, TEXT)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.owner_report_plan_options(DATE, DATE, TEXT)
  FROM anon;
GRANT EXECUTE ON FUNCTION public.owner_report_plan_options(DATE, DATE, TEXT)
  TO authenticated;
