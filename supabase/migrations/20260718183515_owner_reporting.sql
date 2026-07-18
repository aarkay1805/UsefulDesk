-- ============================================================
-- 20260718183515_owner_reporting.sql
--
-- One exact, account-scoped read model for the owner Reports workspace.
-- The browser supplies a calendar-date range and the account time zone;
-- the function returns KPIs, daily trends, operating alerts, and plan /
-- acquisition / collection breakdowns as one JSON payload.
--
-- SECURITY INVOKER is deliberate: every base table keeps enforcing its
-- existing account RLS, so callers cannot select another tenant's data and
-- no account id parameter is accepted. Empty search_path + fully-qualified
-- relation names prevent object-shadowing attacks. Only authenticated users
-- can execute the function.
-- ============================================================

CREATE OR REPLACE FUNCTION public.owner_report(
  p_start_date DATE,
  p_end_date DATE,
  p_time_zone TEXT DEFAULT 'UTC'
)
RETURNS JSONB
LANGUAGE sql
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
  params AS (
    SELECT
      LEAST(supplied_start, supplied_end) AS report_start,
      GREATEST(supplied_start, supplied_end) AS report_end,
      (GREATEST(supplied_start, supplied_end)
        - LEAST(supplied_start, supplied_end) + 1)::INTEGER AS span_days,
      tz
    FROM raw_params
  ),
  ranges AS (
    SELECT
      report_start,
      report_end,
      span_days,
      tz,
      (NOW() AT TIME ZONE tz)::DATE AS today,
      report_start::TIMESTAMP AT TIME ZONE tz AS current_start_at,
      (report_end + 1)::TIMESTAMP AT TIME ZONE tz AS current_end_at,
      (report_start - span_days)::TIMESTAMP AT TIME ZONE tz AS previous_start_at,
      report_start::TIMESTAMP AT TIME ZONE tz AS previous_end_at
    FROM params
  ),
  member_joined AS (
    SELECT
      m.id,
      m.contact_id,
      m.plan_id,
      COALESCE(m.converted_at, m.created_at) AS joined_at
    FROM public.memberships AS m
    WHERE m.is_trial = FALSE
  ),
  revenue_metrics AS (
    SELECT
      COALESCE(SUM(p.amount) FILTER (
        WHERE p.paid_at >= r.current_start_at
          AND p.paid_at < r.current_end_at
      ), 0)::NUMERIC AS current_value,
      COALESCE(SUM(p.amount) FILTER (
        WHERE p.paid_at >= r.previous_start_at
          AND p.paid_at < r.previous_end_at
      ), 0)::NUMERIC AS previous_value
    FROM ranges AS r
    LEFT JOIN public.payments AS p
      ON p.status = 'paid'
      AND p.paid_at >= r.previous_start_at
      AND p.paid_at < r.current_end_at
  ),
  member_metrics AS (
    SELECT
      COUNT(mj.id) FILTER (
        WHERE mj.joined_at >= r.current_start_at
          AND mj.joined_at < r.current_end_at
      )::BIGINT AS current_value,
      COUNT(mj.id) FILTER (
        WHERE mj.joined_at >= r.previous_start_at
          AND mj.joined_at < r.previous_end_at
      )::BIGINT AS previous_value
    FROM ranges AS r
    LEFT JOIN member_joined AS mj
      ON mj.joined_at >= r.previous_start_at
      AND mj.joined_at < r.current_end_at
  ),
  visit_metrics AS (
    SELECT
      COUNT(a.id) FILTER (
        WHERE a.checked_in_at >= r.current_start_at
          AND a.checked_in_at < r.current_end_at
      )::BIGINT AS current_value,
      COUNT(a.id) FILTER (
        WHERE a.checked_in_at >= r.previous_start_at
          AND a.checked_in_at < r.previous_end_at
      )::BIGINT AS previous_value
    FROM ranges AS r
    LEFT JOIN public.attendance AS a
      ON a.checked_in_at >= r.previous_start_at
      AND a.checked_in_at < r.current_end_at
  ),
  acquisition_cohort AS (
    SELECT
      c.id,
      COALESCE(NULLIF(BTRIM(c.source), ''), 'unknown') AS source,
      c.created_at,
      mj.joined_at
    FROM public.contacts AS c
    CROSS JOIN ranges AS r
    LEFT JOIN member_joined AS mj ON mj.contact_id = c.id
    WHERE c.created_at >= r.previous_start_at
      AND c.created_at < r.current_end_at
  ),
  conversion_counts AS (
    SELECT
      COUNT(ac.id) FILTER (
        WHERE ac.created_at >= r.current_start_at
          AND ac.created_at < r.current_end_at
      )::BIGINT AS current_acquired,
      COUNT(ac.id) FILTER (
        WHERE ac.created_at >= r.current_start_at
          AND ac.created_at < r.current_end_at
          AND ac.joined_at < r.current_end_at
      )::BIGINT AS current_converted,
      COUNT(ac.id) FILTER (
        WHERE ac.created_at >= r.previous_start_at
          AND ac.created_at < r.previous_end_at
      )::BIGINT AS previous_acquired,
      COUNT(ac.id) FILTER (
        WHERE ac.created_at >= r.previous_start_at
          AND ac.created_at < r.previous_end_at
          AND ac.joined_at < r.previous_end_at
      )::BIGINT AS previous_converted
    FROM ranges AS r
    LEFT JOIN acquisition_cohort AS ac
      ON ac.created_at >= r.previous_start_at
      AND ac.created_at < r.current_end_at
  ),
  conversion_metrics AS (
    SELECT
      CASE WHEN current_acquired = 0 THEN 0
        ELSE ROUND(current_converted::NUMERIC * 100 / current_acquired, 1)
      END AS current_value,
      CASE WHEN previous_acquired = 0 THEN 0
        ELSE ROUND(previous_converted::NUMERIC * 100 / previous_acquired, 1)
      END AS previous_value,
      current_acquired,
      current_converted
    FROM conversion_counts
  ),
  active_members AS (
    SELECT COUNT(*)::BIGINT AS total
    FROM public.memberships AS m
    CROSS JOIN ranges AS r
    WHERE m.status = 'active'
      AND m.is_trial = FALSE
      AND m.end_date >= r.today
  ),
  calendar_days AS (
    SELECT day::DATE AS day
    FROM params AS p
    CROSS JOIN LATERAL GENERATE_SERIES(
      p.report_start::TIMESTAMP,
      p.report_end::TIMESTAMP,
      INTERVAL '1 day'
    ) AS day
  ),
  daily_revenue AS (
    SELECT
      (p.paid_at AT TIME ZONE r.tz)::DATE AS day,
      SUM(p.amount)::NUMERIC AS value
    FROM public.payments AS p
    CROSS JOIN ranges AS r
    WHERE p.status = 'paid'
      AND p.paid_at >= r.current_start_at
      AND p.paid_at < r.current_end_at
    GROUP BY 1
  ),
  daily_visits AS (
    SELECT
      (a.checked_in_at AT TIME ZONE r.tz)::DATE AS day,
      COUNT(*)::BIGINT AS value
    FROM public.attendance AS a
    CROSS JOIN ranges AS r
    WHERE a.checked_in_at >= r.current_start_at
      AND a.checked_in_at < r.current_end_at
    GROUP BY 1
  ),
  daily_members AS (
    SELECT
      (mj.joined_at AT TIME ZONE r.tz)::DATE AS day,
      COUNT(*)::BIGINT AS value
    FROM member_joined AS mj
    CROSS JOIN ranges AS r
    WHERE mj.joined_at >= r.current_start_at
      AND mj.joined_at < r.current_end_at
    GROUP BY 1
  ),
  daily_acquisition AS (
    SELECT
      (ac.created_at AT TIME ZONE r.tz)::DATE AS day,
      COUNT(*)::BIGINT AS leads,
      COUNT(*) FILTER (WHERE ac.joined_at < r.current_end_at)::BIGINT AS converted
    FROM acquisition_cohort AS ac
    CROSS JOIN ranges AS r
    WHERE ac.created_at >= r.current_start_at
      AND ac.created_at < r.current_end_at
    GROUP BY 1
  ),
  daily AS (
    SELECT
      cd.day,
      COALESCE(dr.value, 0)::NUMERIC AS revenue,
      COALESCE(dv.value, 0)::BIGINT AS visits,
      COALESCE(dm.value, 0)::BIGINT AS new_members,
      COALESCE(da.leads, 0)::BIGINT AS acquired,
      COALESCE(da.converted, 0)::BIGINT AS converted
    FROM calendar_days AS cd
    LEFT JOIN daily_revenue AS dr USING (day)
    LEFT JOIN daily_visits AS dv USING (day)
    LEFT JOIN daily_members AS dm USING (day)
    LEFT JOIN daily_acquisition AS da USING (day)
    ORDER BY cd.day
  ),
  attention AS (
    SELECT
      (
        SELECT COUNT(*)::BIGINT
        FROM public.memberships AS m
        JOIN public.membership_plans AS mp ON mp.id = m.plan_id
        WHERE m.status = 'active'
          AND m.is_trial = FALSE
          AND mp.plan_type = 'recurring'
          AND m.end_date BETWEEN r.today AND r.today + 7
      ) AS renewals_due,
      (
        SELECT COUNT(*)::BIGINT
        FROM public.membership_dues AS md
        WHERE md.balance > 0
      ) AS outstanding_dues,
      (
        SELECT COALESCE(SUM(md.balance), 0)::NUMERIC
        FROM public.membership_dues AS md
        WHERE md.balance > 0
      ) AS outstanding_amount,
      (
        SELECT COUNT(*)::BIGINT
        FROM public.member_activity AS ma
        WHERE ma.status = 'active'
          AND ma.is_trial = FALSE
          AND ma.end_date >= r.today
          AND (
            ma.last_visit_at IS NULL
            OR (ma.last_visit_at AT TIME ZONE r.tz)::DATE <= r.today - 10
          )
      ) AS inactive_members,
      (
        SELECT COUNT(*)::BIGINT
        FROM public.memberships AS m
        JOIN public.contacts AS c ON c.id = m.contact_id
        WHERE m.status = 'active'
          AND m.is_trial = FALSE
          AND m.end_date >= r.today
          AND c.churn_risk = TRUE
      ) AS churn_risk,
      (
        SELECT COUNT(*)::BIGINT
        FROM public.memberships AS m
        WHERE m.is_trial = TRUE
          AND m.status <> 'cancelled'
          AND m.converted_at IS NULL
          AND m.end_date <= r.today + 3
      ) AS trial_followups,
      (
        SELECT COUNT(DISTINCT pm.membership_id)::BIGINT
        FROM public.payment_mandates AS pm
        WHERE pm.status = 'failed'
          AND NOT EXISTS (
            SELECT 1
            FROM public.payment_mandates AS active_pm
            WHERE active_pm.membership_id = pm.membership_id
              AND active_pm.status = 'active'
          )
      ) AS failed_mandates
    FROM ranges AS r
  ),
  plan_active AS (
    SELECT m.plan_id, COUNT(*)::BIGINT AS value
    FROM public.memberships AS m
    CROSS JOIN ranges AS r
    WHERE m.status = 'active'
      AND m.is_trial = FALSE
      AND m.end_date >= r.today
      AND m.plan_id IS NOT NULL
    GROUP BY m.plan_id
  ),
  plan_new AS (
    SELECT mj.plan_id, COUNT(*)::BIGINT AS value
    FROM member_joined AS mj
    CROSS JOIN ranges AS r
    WHERE mj.plan_id IS NOT NULL
      AND mj.joined_at >= r.current_start_at
      AND mj.joined_at < r.current_end_at
    GROUP BY mj.plan_id
  ),
  plan_revenue AS (
    SELECT p.plan_id, SUM(p.amount)::NUMERIC AS value
    FROM public.payments AS p
    CROSS JOIN ranges AS r
    WHERE p.plan_id IS NOT NULL
      AND p.status = 'paid'
      AND p.paid_at >= r.current_start_at
      AND p.paid_at < r.current_end_at
    GROUP BY p.plan_id
  ),
  plan_visits AS (
    SELECT m.plan_id, COUNT(a.id)::BIGINT AS value
    FROM public.attendance AS a
    JOIN public.memberships AS m ON m.id = a.membership_id
    CROSS JOIN ranges AS r
    WHERE m.plan_id IS NOT NULL
      AND a.checked_in_at >= r.current_start_at
      AND a.checked_in_at < r.current_end_at
    GROUP BY m.plan_id
  ),
  plan_breakdown AS (
    SELECT
      mp.id,
      mp.name,
      COALESCE(pa.value, 0)::BIGINT AS active_members,
      COALESCE(pn.value, 0)::BIGINT AS new_members,
      COALESCE(pr.value, 0)::NUMERIC AS revenue,
      COALESCE(pv.value, 0)::BIGINT AS visits
    FROM public.membership_plans AS mp
    LEFT JOIN plan_active AS pa ON pa.plan_id = mp.id
    LEFT JOIN plan_new AS pn ON pn.plan_id = mp.id
    LEFT JOIN plan_revenue AS pr ON pr.plan_id = mp.id
    LEFT JOIN plan_visits AS pv ON pv.plan_id = mp.id
    WHERE mp.is_active = TRUE
      OR COALESCE(pa.value, 0) > 0
      OR COALESCE(pn.value, 0) > 0
      OR COALESCE(pr.value, 0) > 0
      OR COALESCE(pv.value, 0) > 0
    ORDER BY revenue DESC, active_members DESC, mp.name
    LIMIT 10
  ),
  source_breakdown AS (
    SELECT
      ac.source,
      COUNT(*) FILTER (WHERE ac.joined_at < r.current_end_at)::BIGINT AS members,
      COUNT(*) FILTER (
        WHERE ac.joined_at IS NULL OR ac.joined_at >= r.current_end_at
      )::BIGINT AS leads,
      CASE WHEN COUNT(*) = 0 THEN 0
        ELSE ROUND(
          COUNT(*) FILTER (WHERE ac.joined_at < r.current_end_at)::NUMERIC
          * 100 / COUNT(*),
          1
        )
      END AS conversion_rate
    FROM acquisition_cohort AS ac
    CROSS JOIN ranges AS r
    WHERE ac.created_at >= r.current_start_at
      AND ac.created_at < r.current_end_at
    GROUP BY ac.source
    ORDER BY members DESC, leads DESC, ac.source
    LIMIT 10
  ),
  collection_method_breakdown AS (
    SELECT
      p.method,
      COUNT(*)::BIGINT AS payments,
      SUM(p.amount)::NUMERIC AS amount
    FROM public.payments AS p
    CROSS JOIN ranges AS r
    WHERE p.status = 'paid'
      AND p.paid_at >= r.current_start_at
      AND p.paid_at < r.current_end_at
    GROUP BY p.method
    ORDER BY amount DESC, p.method
  ),
  collection_source_breakdown AS (
    SELECT
      COALESCE(p.source, 'manual') AS source,
      COUNT(*)::BIGINT AS payments,
      SUM(p.amount)::NUMERIC AS amount
    FROM public.payments AS p
    CROSS JOIN ranges AS r
    WHERE p.status = 'paid'
      AND p.paid_at >= r.current_start_at
      AND p.paid_at < r.current_end_at
    GROUP BY COALESCE(p.source, 'manual')
    ORDER BY amount DESC, source
  )
  SELECT JSONB_BUILD_OBJECT(
    'period', JSONB_BUILD_OBJECT(
      'start', r.report_start,
      'end', r.report_end,
      'days', r.span_days
    ),
    'metrics', JSONB_BUILD_OBJECT(
      'revenue', JSONB_BUILD_OBJECT(
        'current', rm.current_value,
        'previous', rm.previous_value
      ),
      'newMembers', JSONB_BUILD_OBJECT(
        'current', mm.current_value,
        'previous', mm.previous_value,
        'activeTotal', am.total
      ),
      'visits', JSONB_BUILD_OBJECT(
        'current', vm.current_value,
        'previous', vm.previous_value
      ),
      'conversion', JSONB_BUILD_OBJECT(
        'current', cm.current_value,
        'previous', cm.previous_value,
        'acquired', cm.current_acquired,
        'converted', cm.current_converted
      )
    ),
    'attention', JSONB_BUILD_OBJECT(
      'renewalsDue', att.renewals_due,
      'outstandingDues', att.outstanding_dues,
      'outstandingAmount', att.outstanding_amount,
      'inactiveMembers', att.inactive_members,
      'churnRisk', att.churn_risk,
      'trialFollowups', att.trial_followups,
      'failedMandates', att.failed_mandates
    ),
    'trend', COALESCE((
      SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
        'date', d.day,
        'revenue', d.revenue,
        'visits', d.visits,
        'newMembers', d.new_members,
        'acquired', d.acquired,
        'converted', d.converted
      ) ORDER BY d.day)
      FROM daily AS d
    ), '[]'::JSONB),
    'plans', COALESCE((
      SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
        'id', pb.id,
        'name', pb.name,
        'activeMembers', pb.active_members,
        'newMembers', pb.new_members,
        'revenue', pb.revenue,
        'visits', pb.visits
      ) ORDER BY pb.revenue DESC, pb.active_members DESC, pb.name)
      FROM plan_breakdown AS pb
    ), '[]'::JSONB),
    'sources', COALESCE((
      SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
        'source', sb.source,
        'leads', sb.leads,
        'members', sb.members,
        'conversionRate', sb.conversion_rate
      ) ORDER BY sb.members DESC, sb.leads DESC, sb.source)
      FROM source_breakdown AS sb
    ), '[]'::JSONB),
    'collectionMethods', COALESCE((
      SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
        'method', cmb.method,
        'payments', cmb.payments,
        'amount', cmb.amount
      ) ORDER BY cmb.amount DESC, cmb.method)
      FROM collection_method_breakdown AS cmb
    ), '[]'::JSONB),
    'collectionSources', COALESCE((
      SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
        'source', csb.source,
        'payments', csb.payments,
        'amount', csb.amount
      ) ORDER BY csb.amount DESC, csb.source)
      FROM collection_source_breakdown AS csb
    ), '[]'::JSONB)
  )
  FROM ranges AS r
  CROSS JOIN revenue_metrics AS rm
  CROSS JOIN member_metrics AS mm
  CROSS JOIN visit_metrics AS vm
  CROSS JOIN conversion_metrics AS cm
  CROSS JOIN active_members AS am
  CROSS JOIN attention AS att;
$$;

ALTER FUNCTION public.owner_report(DATE, DATE, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.owner_report(DATE, DATE, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.owner_report(DATE, DATE, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.owner_report(DATE, DATE, TEXT) TO authenticated;
