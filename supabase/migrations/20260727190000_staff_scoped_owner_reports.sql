-- Staff-scoped owner reporting. A selected teammate owns a report row when
-- the underlying lead/member contact is assigned to that auth user. NULL keeps
-- the existing all-staff account aggregate. Every function remains SECURITY
-- INVOKER, so base-table RLS continues to enforce the tenant boundary.

DROP FUNCTION IF EXISTS public.owner_report(DATE, DATE, TEXT);
DROP FUNCTION IF EXISTS public.owner_report_source_revenue(DATE, DATE, TEXT);
DROP FUNCTION IF EXISTS public.owner_report_plan_options(DATE, DATE, TEXT);
DROP FUNCTION IF EXISTS public.owner_report_average_sale_price(DATE, DATE, TEXT);



CREATE OR REPLACE FUNCTION public.owner_report(
  p_start_date DATE,
  p_end_date DATE,
  p_time_zone TEXT DEFAULT 'UTC',
  p_staff_user_id UUID DEFAULT NULL
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
  scoped_contacts AS MATERIALIZED (
    SELECT contact.*
    FROM public.contacts AS contact
    WHERE p_staff_user_id IS NULL
      OR contact.assigned_to = p_staff_user_id
  ),
  scoped_memberships AS MATERIALIZED (
    SELECT membership.*
    FROM public.memberships AS membership
    JOIN scoped_contacts AS contact ON contact.id = membership.contact_id
  ),
  scoped_payments AS MATERIALIZED (
    SELECT payment.*
    FROM public.payments AS payment
    WHERE p_staff_user_id IS NULL
      OR EXISTS (
        SELECT 1
        FROM scoped_memberships AS membership
        WHERE membership.id = payment.membership_id
      )
  ),
  scoped_attendance AS MATERIALIZED (
    SELECT visit.*
    FROM public.attendance AS visit
    WHERE p_staff_user_id IS NULL
      OR EXISTS (
        SELECT 1
        FROM scoped_memberships AS membership
        WHERE membership.id = visit.membership_id
      )
  ),
  scoped_dues AS MATERIALIZED (
    SELECT due.*
    FROM public.membership_dues AS due
    WHERE p_staff_user_id IS NULL
      OR EXISTS (
        SELECT 1
        FROM scoped_memberships AS membership
        WHERE membership.id = due.membership_id
      )
  ),
  scoped_activity AS MATERIALIZED (
    SELECT activity.*
    FROM public.member_activity AS activity
    WHERE p_staff_user_id IS NULL
      OR EXISTS (
        SELECT 1
        FROM scoped_memberships AS membership
        WHERE membership.id = activity.membership_id
      )
  ),
  scoped_mandates AS MATERIALIZED (
    SELECT mandate.*
    FROM public.payment_mandates AS mandate
    WHERE p_staff_user_id IS NULL
      OR EXISTS (
        SELECT 1
        FROM scoped_memberships AS membership
        WHERE membership.id = mandate.membership_id
      )
  ),
  member_joined AS (
    SELECT
      m.id,
      m.contact_id,
      m.plan_id,
      COALESCE(m.converted_at, m.created_at) AS joined_at
    FROM scoped_memberships AS m
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
    LEFT JOIN scoped_payments AS p
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
    LEFT JOIN scoped_attendance AS a
      ON a.checked_in_at >= r.previous_start_at
      AND a.checked_in_at < r.current_end_at
  ),
  acquisition_cohort AS (
    SELECT
      c.id,
      COALESCE(NULLIF(BTRIM(c.source), ''), 'unknown') AS source,
      c.created_at,
      mj.joined_at
    FROM scoped_contacts AS c
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
    FROM scoped_memberships AS m
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
    FROM scoped_payments AS p
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
    FROM scoped_attendance AS a
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
        FROM scoped_memberships AS m
        JOIN public.membership_plans AS mp ON mp.id = m.plan_id
        WHERE m.status = 'active'
          AND m.is_trial = FALSE
          AND mp.plan_type = 'recurring'
          AND m.end_date BETWEEN r.today AND r.today + 7
      ) AS renewals_due,
      (
        SELECT COUNT(*)::BIGINT
        FROM scoped_dues AS md
        WHERE md.balance > 0
      ) AS outstanding_dues,
      (
        SELECT COALESCE(SUM(md.balance), 0)::NUMERIC
        FROM scoped_dues AS md
        WHERE md.balance > 0
      ) AS outstanding_amount,
      (
        SELECT COUNT(*)::BIGINT
        FROM scoped_activity AS ma
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
        FROM scoped_memberships AS m
        JOIN scoped_contacts AS c ON c.id = m.contact_id
        WHERE m.status = 'active'
          AND m.is_trial = FALSE
          AND m.end_date >= r.today
          AND c.churn_risk = TRUE
      ) AS churn_risk,
      (
        SELECT COUNT(*)::BIGINT
        FROM scoped_memberships AS m
        WHERE m.is_trial = TRUE
          AND m.status <> 'cancelled'
          AND m.converted_at IS NULL
          AND m.end_date <= r.today + 3
      ) AS trial_followups,
      (
        SELECT COUNT(DISTINCT pm.membership_id)::BIGINT
        FROM scoped_mandates AS pm
        WHERE pm.status = 'failed'
          AND NOT EXISTS (
            SELECT 1
            FROM scoped_mandates AS active_pm
            WHERE active_pm.membership_id = pm.membership_id
              AND active_pm.status = 'active'
          )
      ) AS failed_mandates
    FROM ranges AS r
  ),
  plan_active AS (
    SELECT m.plan_id, COUNT(*)::BIGINT AS value
    FROM scoped_memberships AS m
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
    FROM scoped_payments AS p
    CROSS JOIN ranges AS r
    WHERE p.plan_id IS NOT NULL
      AND p.status = 'paid'
      AND p.paid_at >= r.current_start_at
      AND p.paid_at < r.current_end_at
    GROUP BY p.plan_id
  ),
  plan_visits AS (
    SELECT m.plan_id, COUNT(a.id)::BIGINT AS value
    FROM scoped_attendance AS a
    JOIN scoped_memberships AS m ON m.id = a.membership_id
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
    FROM scoped_payments AS p
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
    FROM scoped_payments AS p
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

ALTER FUNCTION public.owner_report(DATE, DATE, TEXT, UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.owner_report(DATE, DATE, TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.owner_report(DATE, DATE, TEXT, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.owner_report(DATE, DATE, TEXT, UUID) TO authenticated;


CREATE OR REPLACE FUNCTION public.owner_report_source_revenue(
  p_start_date DATE,
  p_end_date DATE,
  p_time_zone TEXT DEFAULT 'UTC',
  p_staff_user_id UUID DEFAULT NULL
)
RETURNS TABLE (source TEXT, revenue NUMERIC)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH raw_params AS (
    SELECT
      LEAST(
        COALESCE(p_start_date, CURRENT_DATE - 29),
        COALESCE(p_end_date, CURRENT_DATE)
      ) AS report_start,
      GREATEST(
        COALESCE(p_start_date, CURRENT_DATE - 29),
        COALESCE(p_end_date, CURRENT_DATE)
      ) AS report_end,
      COALESCE(NULLIF(BTRIM(p_time_zone), ''), 'UTC') AS tz
  ),
  ranges AS (
    SELECT
      report_start::TIMESTAMP AT TIME ZONE tz AS current_start_at,
      (report_end + 1)::TIMESTAMP AT TIME ZONE tz AS current_end_at
    FROM raw_params
  ),
  scoped_contacts AS MATERIALIZED (
    SELECT contact.*
    FROM public.contacts AS contact
    WHERE p_staff_user_id IS NULL
      OR contact.assigned_to = p_staff_user_id
  ),
  cohort AS (
    SELECT
      c.id,
      COALESCE(NULLIF(BTRIM(c.source), ''), 'unknown') AS source
    FROM scoped_contacts AS c
    CROSS JOIN ranges AS r
    WHERE c.created_at >= r.current_start_at
      AND c.created_at < r.current_end_at
  )
  SELECT
    cohort.source,
    COALESCE(SUM(p.amount), 0)::NUMERIC AS revenue
  FROM cohort
  CROSS JOIN ranges AS r
  LEFT JOIN public.memberships AS m
    ON m.contact_id = cohort.id
    AND m.is_trial = FALSE
  LEFT JOIN public.payments AS p
    ON p.membership_id = m.id
    AND p.status = 'paid'
    AND p.paid_at >= r.current_start_at
    AND p.paid_at < r.current_end_at
  GROUP BY cohort.source
  ORDER BY revenue DESC, cohort.source;
$$;

ALTER FUNCTION public.owner_report_source_revenue(DATE, DATE, TEXT, UUID)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.owner_report_source_revenue(DATE, DATE, TEXT, UUID)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.owner_report_source_revenue(DATE, DATE, TEXT, UUID)
  FROM anon;
GRANT EXECUTE ON FUNCTION public.owner_report_source_revenue(DATE, DATE, TEXT, UUID)
  TO authenticated;


CREATE OR REPLACE FUNCTION public.owner_report_plan_options(
  p_start_date DATE,
  p_end_date DATE,
  p_time_zone TEXT DEFAULT 'UTC',
  p_staff_user_id UUID DEFAULT NULL
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
  scoped_contacts AS MATERIALIZED (
    SELECT contact.*
    FROM public.contacts AS contact
    WHERE p_staff_user_id IS NULL
      OR contact.assigned_to = p_staff_user_id
  ),
  scoped_memberships AS MATERIALIZED (
    SELECT membership.*
    FROM public.memberships AS membership
    JOIN scoped_contacts AS contact ON contact.id = membership.contact_id
  ),
  scoped_periods AS MATERIALIZED (
    SELECT period.*
    FROM public.membership_periods AS period
    WHERE p_staff_user_id IS NULL
      OR EXISTS (
        SELECT 1
        FROM scoped_memberships AS membership
        WHERE membership.id = period.membership_id
      )
  ),
  scoped_payments AS MATERIALIZED (
    SELECT payment.*
    FROM public.payments AS payment
    WHERE p_staff_user_id IS NULL
      OR EXISTS (
        SELECT 1
        FROM scoped_memberships AS membership
        WHERE membership.id = payment.membership_id
      )
  ),
  scoped_attendance AS MATERIALIZED (
    SELECT visit.*
    FROM public.attendance AS visit
    WHERE p_staff_user_id IS NULL
      OR EXISTS (
        SELECT 1
        FROM scoped_memberships AS membership
        WHERE membership.id = visit.membership_id
      )
  ),
  initial_period AS (
    SELECT DISTINCT ON (period.membership_id)
      period.membership_id,
      period.plan_id,
      period.pricing_option_id
    FROM scoped_periods AS period
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
    FROM scoped_memberships AS membership
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
    FROM scoped_memberships AS membership
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
    FROM scoped_payments AS payment
    CROSS JOIN ranges AS range
    LEFT JOIN scoped_periods AS period
      ON period.membership_id = payment.membership_id
      AND period.period_end IS NOT DISTINCT FROM payment.period_end
    LEFT JOIN scoped_memberships AS membership
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
    FROM scoped_attendance AS attendance
    CROSS JOIN ranges AS range
    JOIN scoped_memberships AS membership
      ON membership.id = attendance.membership_id
    LEFT JOIN LATERAL (
      SELECT
        candidate.plan_id,
        candidate.pricing_option_id
      FROM scoped_periods AS candidate
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

ALTER FUNCTION public.owner_report_plan_options(DATE, DATE, TEXT, UUID)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.owner_report_plan_options(DATE, DATE, TEXT, UUID)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.owner_report_plan_options(DATE, DATE, TEXT, UUID)
  FROM anon;
GRANT EXECUTE ON FUNCTION public.owner_report_plan_options(DATE, DATE, TEXT, UUID)
  TO authenticated;


CREATE OR REPLACE FUNCTION public.owner_report_average_sale_price(
  p_start_date DATE,
  p_end_date DATE,
  p_time_zone TEXT DEFAULT 'UTC',
  p_staff_user_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH raw_params AS (
    SELECT
      LEAST(
        COALESCE(p_start_date, CURRENT_DATE - 29),
        COALESCE(p_end_date, CURRENT_DATE)
      ) AS report_start,
      GREATEST(
        COALESCE(p_start_date, CURRENT_DATE - 29),
        COALESCE(p_end_date, CURRENT_DATE)
      ) AS report_end,
      COALESCE(NULLIF(BTRIM(p_time_zone), ''), 'UTC') AS tz
  ),
  ranges AS (
    SELECT
      report_start::TIMESTAMP AT TIME ZONE tz AS current_start_at,
      (report_end + 1)::TIMESTAMP AT TIME ZONE tz AS current_end_at,
      (
        report_start - (report_end - report_start + 1)::INTEGER
      )::TIMESTAMP AT TIME ZONE tz AS previous_start_at
    FROM raw_params
  ),
  scoped_contacts AS MATERIALIZED (
    SELECT contact.*
    FROM public.contacts AS contact
    WHERE p_staff_user_id IS NULL
      OR contact.assigned_to = p_staff_user_id
  ),
  scoped_memberships AS MATERIALIZED (
    SELECT membership.*
    FROM public.memberships AS membership
    JOIN scoped_contacts AS contact ON contact.id = membership.contact_id
  ),
  scoped_periods AS MATERIALIZED (
    SELECT period.*
    FROM public.membership_periods AS period
    WHERE p_staff_user_id IS NULL
      OR EXISTS (
        SELECT 1
        FROM scoped_memberships AS membership
        WHERE membership.id = period.membership_id
      )
  ),
  first_invoices AS (
    SELECT DISTINCT ON (mp.membership_id)
      mp.membership_id,
      mp.fee_amount
    FROM scoped_periods AS mp
    ORDER BY
      mp.membership_id,
      mp.period_start,
      mp.created_at,
      mp.id
  ),
  joined_members AS (
    SELECT
      m.id,
      COALESCE(m.converted_at, m.created_at) AS joined_at,
      COALESCE(fi.fee_amount, 0) AS sale_value
    FROM scoped_memberships AS m
    LEFT JOIN first_invoices AS fi ON fi.membership_id = m.id
    WHERE m.is_trial = FALSE
  ),
  values_by_period AS (
    SELECT
      COUNT(jm.id) FILTER (
        WHERE jm.joined_at >= r.current_start_at
          AND jm.joined_at < r.current_end_at
      ) AS current_count,
      COALESCE(SUM(jm.sale_value) FILTER (
        WHERE jm.joined_at >= r.current_start_at
          AND jm.joined_at < r.current_end_at
      ), 0) AS current_total,
      COUNT(jm.id) FILTER (
        WHERE jm.joined_at >= r.previous_start_at
          AND jm.joined_at < r.current_start_at
      ) AS previous_count,
      COALESCE(SUM(jm.sale_value) FILTER (
        WHERE jm.joined_at >= r.previous_start_at
          AND jm.joined_at < r.current_start_at
      ), 0) AS previous_total
    FROM ranges AS r
    LEFT JOIN joined_members AS jm
      ON jm.joined_at >= r.previous_start_at
      AND jm.joined_at < r.current_end_at
  )
  SELECT jsonb_build_object(
    'current',
    CASE
      WHEN current_count = 0 THEN 0
      ELSE ROUND(current_total / current_count, 2)
    END,
    'previous',
    CASE
      WHEN previous_count = 0 THEN 0
      ELSE ROUND(previous_total / previous_count, 2)
    END
  )
  FROM values_by_period;
$$;

ALTER FUNCTION public.owner_report_average_sale_price(DATE, DATE, TEXT, UUID)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.owner_report_average_sale_price(DATE, DATE, TEXT, UUID)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.owner_report_average_sale_price(DATE, DATE, TEXT, UUID)
  FROM anon;
GRANT EXECUTE ON FUNCTION public.owner_report_average_sale_price(DATE, DATE, TEXT, UUID)
  TO authenticated;
