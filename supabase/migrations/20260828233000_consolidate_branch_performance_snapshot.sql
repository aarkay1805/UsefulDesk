-- Finance Performance previously dispatched seven reads whose report RPCs
-- independently rebuilt the same branch cohorts. Keep one invoker statement
-- so RLS remains authoritative while contacts, memberships, periods, payments,
-- attendance, and expenses are materialized once and shared by every slice.

CREATE OR REPLACE FUNCTION public.selected_branch_performance_snapshot(
  p_account_id UUID,
  p_start_date DATE,
  p_end_date DATE,
  p_time_zone TEXT DEFAULT 'UTC',
  p_staff_user_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_account_member(p_account_id, 'owner') THEN
    RAISE EXCEPTION 'Selected branch owner access is required'
      USING ERRCODE = '42501';
  END IF;

  RETURN (
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
        (report_start - span_days)::TIMESTAMP AT TIME ZONE tz
          AS previous_start_at,
        report_start::TIMESTAMP AT TIME ZONE tz AS previous_end_at,
        (DATE_TRUNC('month', report_start::TIMESTAMP)
          - INTERVAL '1 month')::DATE AS previous_month_start,
        DATE_TRUNC('month', report_start::TIMESTAMP)::DATE AS month_start,
        (DATE_TRUNC('month', report_start::TIMESTAMP)
          + INTERVAL '1 month')::DATE AS next_month_start
      FROM params
    ),
    scoped_contacts AS MATERIALIZED (
      SELECT contact.*
      FROM public.contacts AS contact
      WHERE contact.account_id = p_account_id
        AND (
          p_staff_user_id IS NULL
          OR contact.assigned_to = p_staff_user_id
        )
    ),
    scoped_memberships AS MATERIALIZED (
      SELECT membership.*
      FROM public.memberships AS membership
      JOIN scoped_contacts AS contact ON contact.id = membership.contact_id
      WHERE membership.account_id = p_account_id
    ),
    scoped_periods AS MATERIALIZED (
      SELECT period.*
      FROM public.membership_periods AS period
      WHERE period.account_id = p_account_id
        AND (
          p_staff_user_id IS NULL
          OR EXISTS (
            SELECT 1
            FROM scoped_memberships AS membership
            WHERE membership.id = period.membership_id
          )
        )
    ),
    scoped_payments AS MATERIALIZED (
      SELECT payment.*
      FROM public.payments AS payment
      WHERE payment.account_id = p_account_id
        AND (
          p_staff_user_id IS NULL
          OR EXISTS (
            SELECT 1
            FROM scoped_memberships AS membership
            WHERE membership.id = payment.membership_id
          )
        )
    ),
    scoped_attendance AS MATERIALIZED (
      SELECT visit.*
      FROM public.attendance AS visit
      WHERE visit.account_id = p_account_id
        AND (
          p_staff_user_id IS NULL
          OR EXISTS (
            SELECT 1
            FROM scoped_memberships AS membership
            WHERE membership.id = visit.membership_id
          )
        )
    ),
    scoped_dues AS MATERIALIZED (
      SELECT due.*
      FROM public.membership_dues AS due
      WHERE due.account_id = p_account_id
        AND (
          p_staff_user_id IS NULL
          OR EXISTS (
            SELECT 1
            FROM scoped_memberships AS membership
            WHERE membership.id = due.membership_id
          )
        )
    ),
    scoped_activity AS MATERIALIZED (
      SELECT activity.*
      FROM public.member_activity AS activity
      WHERE activity.account_id = p_account_id
        AND (
          p_staff_user_id IS NULL
          OR EXISTS (
            SELECT 1
            FROM scoped_memberships AS membership
            WHERE membership.id = activity.membership_id
          )
        )
    ),
    scoped_mandates AS MATERIALIZED (
      SELECT mandate.*
      FROM public.payment_mandates AS mandate
      WHERE mandate.account_id = p_account_id
        AND (
          p_staff_user_id IS NULL
          OR EXISTS (
            SELECT 1
            FROM scoped_memberships AS membership
            WHERE membership.id = mandate.membership_id
          )
        )
    ),
    scoped_expenses AS MATERIALIZED (
      SELECT expense.*
      FROM public.expenses AS expense
      CROSS JOIN ranges AS range
      WHERE expense.account_id = p_account_id
        AND expense.status = 'posted'
        AND expense.occurred_on >= range.previous_month_start
        AND expense.occurred_on < range.next_month_start
    ),
    member_joined AS MATERIALIZED (
      SELECT
        membership.id,
        membership.contact_id,
        membership.plan_id,
        COALESCE(membership.converted_at, membership.created_at) AS joined_at
      FROM scoped_memberships AS membership
      WHERE membership.is_trial = FALSE
    ),
    first_period AS MATERIALIZED (
      SELECT DISTINCT ON (period.membership_id)
        period.membership_id,
        period.plan_id,
        period.pricing_option_id,
        period.fee_amount
      FROM scoped_periods AS period
      ORDER BY
        period.membership_id,
        period.period_start,
        period.created_at,
        period.id
    ),
    revenue_metrics AS (
      SELECT
        COALESCE(SUM(payment.amount) FILTER (
          WHERE payment.paid_at >= range.current_start_at
            AND payment.paid_at < range.current_end_at
        ), 0)::NUMERIC AS current_value,
        COALESCE(SUM(payment.amount) FILTER (
          WHERE payment.paid_at >= range.previous_start_at
            AND payment.paid_at < range.previous_end_at
        ), 0)::NUMERIC AS previous_value
      FROM ranges AS range
      LEFT JOIN scoped_payments AS payment
        ON payment.status = 'paid'
        AND payment.paid_at >= range.previous_start_at
        AND payment.paid_at < range.current_end_at
    ),
    member_metrics AS (
      SELECT
        COUNT(member.id) FILTER (
          WHERE member.joined_at >= range.current_start_at
            AND member.joined_at < range.current_end_at
        )::BIGINT AS current_value,
        COUNT(member.id) FILTER (
          WHERE member.joined_at >= range.previous_start_at
            AND member.joined_at < range.previous_end_at
        )::BIGINT AS previous_value
      FROM ranges AS range
      LEFT JOIN member_joined AS member
        ON member.joined_at >= range.previous_start_at
        AND member.joined_at < range.current_end_at
    ),
    average_sale_price AS (
      SELECT JSONB_BUILD_OBJECT(
        'current', CASE
          WHEN COUNT(member.id) FILTER (
            WHERE member.joined_at >= range.current_start_at
              AND member.joined_at < range.current_end_at
          ) = 0 THEN 0
          ELSE ROUND(
            COALESCE(SUM(COALESCE(period.fee_amount, 0)) FILTER (
              WHERE member.joined_at >= range.current_start_at
                AND member.joined_at < range.current_end_at
            ), 0)
            / COUNT(member.id) FILTER (
              WHERE member.joined_at >= range.current_start_at
                AND member.joined_at < range.current_end_at
            ),
            2
          )
        END,
        'previous', CASE
          WHEN COUNT(member.id) FILTER (
            WHERE member.joined_at >= range.previous_start_at
              AND member.joined_at < range.previous_end_at
          ) = 0 THEN 0
          ELSE ROUND(
            COALESCE(SUM(COALESCE(period.fee_amount, 0)) FILTER (
              WHERE member.joined_at >= range.previous_start_at
                AND member.joined_at < range.previous_end_at
            ), 0)
            / COUNT(member.id) FILTER (
              WHERE member.joined_at >= range.previous_start_at
                AND member.joined_at < range.previous_end_at
            ),
            2
          )
        END
      ) AS value
      FROM ranges AS range
      LEFT JOIN member_joined AS member
        ON member.joined_at >= range.previous_start_at
        AND member.joined_at < range.current_end_at
      LEFT JOIN first_period AS period ON period.membership_id = member.id
    ),
    visit_metrics AS (
      SELECT
        COUNT(visit.id) FILTER (
          WHERE visit.checked_in_at >= range.current_start_at
            AND visit.checked_in_at < range.current_end_at
        )::BIGINT AS current_value,
        COUNT(visit.id) FILTER (
          WHERE visit.checked_in_at >= range.previous_start_at
            AND visit.checked_in_at < range.previous_end_at
        )::BIGINT AS previous_value
      FROM ranges AS range
      LEFT JOIN scoped_attendance AS visit
        ON visit.checked_in_at >= range.previous_start_at
        AND visit.checked_in_at < range.current_end_at
    ),
    acquisition_cohort AS MATERIALIZED (
      SELECT
        contact.id,
        COALESCE(NULLIF(BTRIM(contact.source), ''), 'unknown') AS source,
        contact.received_via,
        contact.created_at,
        member.joined_at
      FROM scoped_contacts AS contact
      CROSS JOIN ranges AS range
      LEFT JOIN member_joined AS member ON member.contact_id = contact.id
      WHERE contact.created_at >= range.previous_start_at
        AND contact.created_at < range.current_end_at
    ),
    conversion_counts AS (
      SELECT
        COUNT(cohort.id) FILTER (
          WHERE cohort.created_at >= range.current_start_at
            AND cohort.created_at < range.current_end_at
        )::BIGINT AS current_acquired,
        COUNT(cohort.id) FILTER (
          WHERE cohort.created_at >= range.current_start_at
            AND cohort.created_at < range.current_end_at
            AND cohort.joined_at < range.current_end_at
        )::BIGINT AS current_converted,
        COUNT(cohort.id) FILTER (
          WHERE cohort.created_at >= range.previous_start_at
            AND cohort.created_at < range.previous_end_at
        )::BIGINT AS previous_acquired,
        COUNT(cohort.id) FILTER (
          WHERE cohort.created_at >= range.previous_start_at
            AND cohort.created_at < range.previous_end_at
            AND cohort.joined_at < range.previous_end_at
        )::BIGINT AS previous_converted
      FROM ranges AS range
      LEFT JOIN acquisition_cohort AS cohort
        ON cohort.created_at >= range.previous_start_at
        AND cohort.created_at < range.current_end_at
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
      FROM scoped_memberships AS membership
      CROSS JOIN ranges AS range
      WHERE membership.status = 'active'
        AND membership.is_trial = FALSE
        AND membership.end_date >= range.today
    ),
    calendar_days AS (
      SELECT day::DATE AS day
      FROM params AS param
      CROSS JOIN LATERAL GENERATE_SERIES(
        param.report_start::TIMESTAMP,
        param.report_end::TIMESTAMP,
        INTERVAL '1 day'
      ) AS day
    ),
    daily_revenue AS (
      SELECT
        (payment.paid_at AT TIME ZONE range.tz)::DATE AS day,
        SUM(payment.amount)::NUMERIC AS value
      FROM scoped_payments AS payment
      CROSS JOIN ranges AS range
      WHERE payment.status = 'paid'
        AND payment.paid_at >= range.current_start_at
        AND payment.paid_at < range.current_end_at
      GROUP BY 1
    ),
    daily_visits AS (
      SELECT
        (visit.checked_in_at AT TIME ZONE range.tz)::DATE AS day,
        COUNT(*)::BIGINT AS value
      FROM scoped_attendance AS visit
      CROSS JOIN ranges AS range
      WHERE visit.checked_in_at >= range.current_start_at
        AND visit.checked_in_at < range.current_end_at
      GROUP BY 1
    ),
    daily_members AS (
      SELECT
        (member.joined_at AT TIME ZONE range.tz)::DATE AS day,
        COUNT(*)::BIGINT AS value
      FROM member_joined AS member
      CROSS JOIN ranges AS range
      WHERE member.joined_at >= range.current_start_at
        AND member.joined_at < range.current_end_at
      GROUP BY 1
    ),
    daily_acquisition AS (
      SELECT
        (cohort.created_at AT TIME ZONE range.tz)::DATE AS day,
        COUNT(*)::BIGINT AS leads,
        COUNT(*) FILTER (
          WHERE cohort.joined_at < range.current_end_at
        )::BIGINT AS converted
      FROM acquisition_cohort AS cohort
      CROSS JOIN ranges AS range
      WHERE cohort.created_at >= range.current_start_at
        AND cohort.created_at < range.current_end_at
      GROUP BY 1
    ),
    daily AS (
      SELECT
        calendar.day,
        COALESCE(revenue.value, 0)::NUMERIC AS revenue,
        COALESCE(visits.value, 0)::BIGINT AS visits,
        COALESCE(members.value, 0)::BIGINT AS new_members,
        COALESCE(acquisition.leads, 0)::BIGINT AS acquired,
        COALESCE(acquisition.converted, 0)::BIGINT AS converted
      FROM calendar_days AS calendar
      LEFT JOIN daily_revenue AS revenue USING (day)
      LEFT JOIN daily_visits AS visits USING (day)
      LEFT JOIN daily_members AS members USING (day)
      LEFT JOIN daily_acquisition AS acquisition USING (day)
      ORDER BY calendar.day
    ),
    attention AS (
      SELECT
        (
          SELECT COUNT(*)::BIGINT
          FROM scoped_memberships AS membership
          JOIN public.membership_plans AS plan ON plan.id = membership.plan_id
          WHERE plan.account_id = p_account_id
            AND membership.status = 'active'
            AND membership.is_trial = FALSE
            AND plan.plan_type = 'recurring'
            AND membership.end_date BETWEEN range.today AND range.today + 7
        ) AS renewals_due,
        (
          SELECT COUNT(*)::BIGINT
          FROM scoped_dues AS due
          WHERE due.balance > 0
        ) AS outstanding_dues,
        (
          SELECT COALESCE(SUM(due.balance), 0)::NUMERIC
          FROM scoped_dues AS due
          WHERE due.balance > 0
        ) AS outstanding_amount,
        (
          SELECT COUNT(*)::BIGINT
          FROM scoped_activity AS activity
          WHERE activity.status = 'active'
            AND activity.is_trial = FALSE
            AND activity.end_date >= range.today
            AND (
              activity.last_visit_at IS NULL
              OR (activity.last_visit_at AT TIME ZONE range.tz)::DATE
                <= range.today - 10
            )
        ) AS inactive_members,
        (
          SELECT COUNT(*)::BIGINT
          FROM scoped_memberships AS membership
          JOIN scoped_contacts AS contact ON contact.id = membership.contact_id
          WHERE membership.status = 'active'
            AND membership.is_trial = FALSE
            AND membership.end_date >= range.today
            AND contact.churn_risk = TRUE
        ) AS churn_risk,
        (
          SELECT COUNT(*)::BIGINT
          FROM scoped_memberships AS membership
          WHERE membership.is_trial = TRUE
            AND membership.status <> 'cancelled'
            AND membership.converted_at IS NULL
            AND membership.end_date <= range.today + 3
        ) AS trial_followups,
        (
          SELECT COUNT(DISTINCT mandate.membership_id)::BIGINT
          FROM scoped_mandates AS mandate
          WHERE mandate.status = 'failed'
            AND NOT EXISTS (
              SELECT 1
              FROM scoped_mandates AS active_mandate
              WHERE active_mandate.membership_id = mandate.membership_id
                AND active_mandate.status = 'active'
            )
        ) AS failed_mandates
      FROM ranges AS range
    ),
    plan_active AS (
      SELECT membership.plan_id, COUNT(*)::BIGINT AS value
      FROM scoped_memberships AS membership
      CROSS JOIN ranges AS range
      WHERE membership.status = 'active'
        AND membership.is_trial = FALSE
        AND membership.end_date >= range.today
        AND membership.plan_id IS NOT NULL
      GROUP BY membership.plan_id
    ),
    plan_new AS (
      SELECT member.plan_id, COUNT(*)::BIGINT AS value
      FROM member_joined AS member
      CROSS JOIN ranges AS range
      WHERE member.plan_id IS NOT NULL
        AND member.joined_at >= range.current_start_at
        AND member.joined_at < range.current_end_at
      GROUP BY member.plan_id
    ),
    plan_revenue AS (
      SELECT payment.plan_id, SUM(payment.amount)::NUMERIC AS value
      FROM scoped_payments AS payment
      CROSS JOIN ranges AS range
      WHERE payment.plan_id IS NOT NULL
        AND payment.status = 'paid'
        AND payment.paid_at >= range.current_start_at
        AND payment.paid_at < range.current_end_at
      GROUP BY payment.plan_id
    ),
    plan_visits AS (
      SELECT membership.plan_id, COUNT(visit.id)::BIGINT AS value
      FROM scoped_attendance AS visit
      JOIN scoped_memberships AS membership
        ON membership.id = visit.membership_id
      CROSS JOIN ranges AS range
      WHERE membership.plan_id IS NOT NULL
        AND visit.checked_in_at >= range.current_start_at
        AND visit.checked_in_at < range.current_end_at
      GROUP BY membership.plan_id
    ),
    plan_breakdown AS MATERIALIZED (
      SELECT
        plan.id,
        plan.name,
        COALESCE(active.value, 0)::BIGINT AS active_members,
        COALESCE(new_members.value, 0)::BIGINT AS new_members,
        COALESCE(revenue.value, 0)::NUMERIC AS revenue,
        COALESCE(visits.value, 0)::BIGINT AS visits
      FROM public.membership_plans AS plan
      LEFT JOIN plan_active AS active ON active.plan_id = plan.id
      LEFT JOIN plan_new AS new_members ON new_members.plan_id = plan.id
      LEFT JOIN plan_revenue AS revenue ON revenue.plan_id = plan.id
      LEFT JOIN plan_visits AS visits ON visits.plan_id = plan.id
      WHERE plan.account_id = p_account_id
        AND (
          plan.is_active = TRUE
          OR COALESCE(active.value, 0) > 0
          OR COALESCE(new_members.value, 0) > 0
          OR COALESCE(revenue.value, 0) > 0
          OR COALESCE(visits.value, 0) > 0
        )
      ORDER BY revenue DESC, active_members DESC, plan.name
      LIMIT 10
    ),
    source_revenue AS (
      SELECT
        cohort.source,
        COALESCE(SUM(payment.amount), 0)::NUMERIC AS revenue
      FROM acquisition_cohort AS cohort
      CROSS JOIN ranges AS range
      LEFT JOIN scoped_memberships AS membership
        ON membership.contact_id = cohort.id
        AND membership.is_trial = FALSE
      LEFT JOIN scoped_payments AS payment
        ON payment.membership_id = membership.id
        AND payment.status = 'paid'
        AND payment.paid_at >= range.current_start_at
        AND payment.paid_at < range.current_end_at
      WHERE cohort.created_at >= range.current_start_at
        AND cohort.created_at < range.current_end_at
      GROUP BY cohort.source
    ),
    source_breakdown AS MATERIALIZED (
      SELECT
        cohort.source,
        COUNT(*) FILTER (
          WHERE cohort.joined_at < range.current_end_at
        )::BIGINT AS members,
        COUNT(*) FILTER (
          WHERE cohort.joined_at IS NULL
            OR cohort.joined_at >= range.current_end_at
        )::BIGINT AS leads,
        COALESCE(revenue.revenue, 0)::NUMERIC AS revenue,
        CASE WHEN COUNT(*) = 0 THEN 0
          ELSE ROUND(
            COUNT(*) FILTER (
              WHERE cohort.joined_at < range.current_end_at
            )::NUMERIC * 100 / COUNT(*),
            1
          )
        END AS conversion_rate
      FROM acquisition_cohort AS cohort
      CROSS JOIN ranges AS range
      LEFT JOIN source_revenue AS revenue ON revenue.source = cohort.source
      WHERE cohort.created_at >= range.current_start_at
        AND cohort.created_at < range.current_end_at
      GROUP BY cohort.source, revenue.revenue
      ORDER BY members DESC, leads DESC, cohort.source
      LIMIT 10
    ),
    collection_method_breakdown AS (
      SELECT
        payment.method,
        COUNT(*)::BIGINT AS payments,
        SUM(payment.amount)::NUMERIC AS amount
      FROM scoped_payments AS payment
      CROSS JOIN ranges AS range
      WHERE payment.status = 'paid'
        AND payment.paid_at >= range.current_start_at
        AND payment.paid_at < range.current_end_at
      GROUP BY payment.method
      ORDER BY amount DESC, payment.method
    ),
    collection_source_breakdown AS (
      SELECT
        COALESCE(payment.source, 'manual') AS source,
        COUNT(*)::BIGINT AS payments,
        SUM(payment.amount)::NUMERIC AS amount
      FROM scoped_payments AS payment
      CROSS JOIN ranges AS range
      WHERE payment.status = 'paid'
        AND payment.paid_at >= range.current_start_at
        AND payment.paid_at < range.current_end_at
      GROUP BY COALESCE(payment.source, 'manual')
      ORDER BY amount DESC, source
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
        COALESCE(period.plan_id, membership.plan_id) AS plan_id,
        COALESCE(
          period.pricing_option_id,
          membership.pricing_option_id
        ) AS pricing_option_id,
        COUNT(*)::BIGINT AS value
      FROM scoped_memberships AS membership
      CROSS JOIN ranges AS range
      LEFT JOIN first_period AS period
        ON period.membership_id = membership.id
      WHERE membership.is_trial = FALSE
        AND COALESCE(membership.converted_at, membership.created_at)
          >= range.current_start_at
        AND COALESCE(membership.converted_at, membership.created_at)
          < range.current_end_at
        AND COALESCE(period.plan_id, membership.plan_id) IS NOT NULL
      GROUP BY
        COALESCE(period.plan_id, membership.plan_id),
        COALESCE(period.pricing_option_id, membership.pricing_option_id)
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
        COUNT(visit.id)::BIGINT AS value
      FROM scoped_attendance AS visit
      CROSS JOIN ranges AS range
      JOIN scoped_memberships AS membership
        ON membership.id = visit.membership_id
      LEFT JOIN LATERAL (
        SELECT
          candidate.plan_id,
          candidate.pricing_option_id
        FROM scoped_periods AS candidate
        WHERE candidate.membership_id = visit.membership_id
          AND (visit.checked_in_at AT TIME ZONE range.tz)::DATE
            BETWEEN candidate.period_start AND candidate.period_end
        ORDER BY
          candidate.period_start DESC,
          candidate.created_at DESC,
          candidate.id DESC
        LIMIT 1
      ) AS period ON TRUE
      WHERE visit.checked_in_at >= range.current_start_at
        AND visit.checked_in_at < range.current_end_at
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
      WHERE option.account_id = p_account_id

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
    plan_options AS (
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
    ),
    ad_cohort AS MATERIALIZED (
      SELECT contact.id
      FROM scoped_contacts AS contact
      CROSS JOIN ranges AS range
      WHERE p_staff_user_id IS NULL
        AND contact.created_at >= range.current_start_at
        AND contact.created_at < range.current_end_at
        AND (
          LOWER(BTRIM(COALESCE(contact.source, '')))
            IN ('instagram', 'facebook')
          OR contact.received_via = 'meta'
        )
    ),
    ad_cohort_stats AS (
      SELECT
        COUNT(*)::BIGINT AS leads,
        COUNT(*) FILTER (
          WHERE EXISTS (
            SELECT 1
            FROM scoped_memberships AS membership
            WHERE membership.contact_id = cohort.id
              AND membership.is_trial = FALSE
          )
        )::BIGINT AS converted_members
      FROM ad_cohort AS cohort
    ),
    ad_cohort_revenue AS (
      SELECT COALESCE(SUM(payment.amount), 0)::NUMERIC AS joining_revenue
      FROM ad_cohort AS cohort
      JOIN scoped_payments AS payment
        ON payment.contact_id = cohort.id
        AND payment.status = 'paid'
        AND payment.payment_purpose = 'joining'
    ),
    marketing_spend AS (
      SELECT COALESCE(SUM(expense.amount), 0)::NUMERIC AS ad_spend
      FROM scoped_expenses AS expense
      JOIN public.expense_categories AS category
        ON category.id = expense.category_id
        AND category.account_id = p_account_id
      CROSS JOIN ranges AS range
      WHERE p_staff_user_id IS NULL
        AND expense.occurred_on >= range.report_start
        AND expense.occurred_on <= range.report_end
        AND LOWER(BTRIM(category.name)) = 'marketing'
    ),
    expense_totals AS (
      SELECT
        COALESCE(SUM(expense.amount) FILTER (
          WHERE expense.occurred_on >= range.month_start
            AND expense.occurred_on < range.next_month_start
        ), 0)::NUMERIC AS current_value,
        COALESCE(SUM(expense.amount) FILTER (
          WHERE expense.occurred_on >= range.previous_month_start
            AND expense.occurred_on < range.month_start
        ), 0)::NUMERIC AS previous_value
      FROM ranges AS range
      LEFT JOIN scoped_expenses AS expense ON TRUE
    ),
    source_options AS (
      SELECT COALESCE(
        JSONB_AGG(
          JSONB_BUILD_OBJECT('key', option.key, 'label', option.label)
          ORDER BY option.sort_order
        ),
        '[]'::JSONB
      ) AS value
      FROM public.lead_field_options AS option
      WHERE option.account_id = p_account_id
        AND option.field = 'source'
    )
    SELECT JSONB_BUILD_OBJECT(
      'report', JSONB_BUILD_OBJECT(
        'period', JSONB_BUILD_OBJECT(
          'start', range.report_start,
          'end', range.report_end,
          'days', range.span_days
        ),
        'metrics', JSONB_BUILD_OBJECT(
          'revenue', JSONB_BUILD_OBJECT(
            'current', revenue.current_value,
            'previous', revenue.previous_value
          ),
          'newMembers', JSONB_BUILD_OBJECT(
            'current', members.current_value,
            'previous', members.previous_value,
            'activeTotal', active.total
          ),
          'averageSalePrice', average_sale.value,
          'visits', JSONB_BUILD_OBJECT(
            'current', visits.current_value,
            'previous', visits.previous_value
          ),
          'conversion', JSONB_BUILD_OBJECT(
            'current', conversion.current_value,
            'previous', conversion.previous_value,
            'acquired', conversion.current_acquired,
            'converted', conversion.current_converted
          )
        ),
        'attention', JSONB_BUILD_OBJECT(
          'renewalsDue', attention_rows.renewals_due,
          'outstandingDues', attention_rows.outstanding_dues,
          'outstandingAmount', attention_rows.outstanding_amount,
          'inactiveMembers', attention_rows.inactive_members,
          'churnRisk', attention_rows.churn_risk,
          'trialFollowups', attention_rows.trial_followups,
          'failedMandates', attention_rows.failed_mandates
        ),
        'trend', COALESCE((
          SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
            'date', day.day,
            'revenue', day.revenue,
            'visits', day.visits,
            'newMembers', day.new_members,
            'acquired', day.acquired,
            'converted', day.converted
          ) ORDER BY day.day)
          FROM daily AS day
        ), '[]'::JSONB),
        'plans', COALESCE((
          SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
            'id', plan.id,
            'name', plan.name,
            'activeMembers', plan.active_members,
            'newMembers', plan.new_members,
            'revenue', plan.revenue,
            'visits', plan.visits,
            'billingOptions', COALESCE(options.billing_options, '[]'::JSONB)
          ) ORDER BY plan.revenue DESC, plan.active_members DESC, plan.name)
          FROM plan_breakdown AS plan
          LEFT JOIN plan_options AS options ON options.plan_id = plan.id
        ), '[]'::JSONB),
        'sources', COALESCE((
          SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
            'source', source.source,
            'leads', source.leads,
            'members', source.members,
            'revenue', source.revenue,
            'conversionRate', source.conversion_rate
          ) ORDER BY source.members DESC, source.leads DESC, source.source)
          FROM source_breakdown AS source
        ), '[]'::JSONB),
        'collectionMethods', COALESCE((
          SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
            'method', method.method,
            'payments', method.payments,
            'amount', method.amount
          ) ORDER BY method.amount DESC, method.method)
          FROM collection_method_breakdown AS method
        ), '[]'::JSONB),
        'collectionSources', COALESCE((
          SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
            'source', source.source,
            'payments', source.payments,
            'amount', source.amount
          ) ORDER BY source.amount DESC, source.source)
          FROM collection_source_breakdown AS source
        ), '[]'::JSONB)
      ),
      'sourceOptions', options.value,
      'adPerformance', CASE WHEN p_staff_user_id IS NULL THEN
        JSONB_BUILD_OBJECT(
          'adSpend', spend.ad_spend,
          'leads', ad_stats.leads,
          'convertedMembers', ad_stats.converted_members,
          'joiningRevenue', ad_revenue.joining_revenue,
          'conversionRate', CASE WHEN ad_stats.leads = 0 THEN NULL
            ELSE ROUND(
              ad_stats.converted_members::NUMERIC * 100 / ad_stats.leads,
              1
            )
          END,
          'returnOnAdSpend', CASE WHEN spend.ad_spend = 0 THEN NULL
            ELSE ROUND(ad_revenue.joining_revenue / spend.ad_spend, 2)
          END
        )
      ELSE NULL END,
      'expenseTotals', CASE WHEN p_staff_user_id IS NULL THEN
        JSONB_BUILD_OBJECT(
          'current', expenses.current_value,
          'previous', expenses.previous_value
        )
      ELSE NULL END
    )
    FROM ranges AS range
    CROSS JOIN revenue_metrics AS revenue
    CROSS JOIN member_metrics AS members
    CROSS JOIN average_sale_price AS average_sale
    CROSS JOIN visit_metrics AS visits
    CROSS JOIN conversion_metrics AS conversion
    CROSS JOIN active_members AS active
    CROSS JOIN attention AS attention_rows
    CROSS JOIN ad_cohort_stats AS ad_stats
    CROSS JOIN ad_cohort_revenue AS ad_revenue
    CROSS JOIN marketing_spend AS spend
    CROSS JOIN expense_totals AS expenses
    CROSS JOIN source_options AS options
  );
END;
$$;

ALTER FUNCTION public.selected_branch_performance_snapshot(
  UUID, DATE, DATE, TEXT, UUID
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.selected_branch_performance_snapshot(
  UUID, DATE, DATE, TEXT, UUID
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.selected_branch_performance_snapshot(
  UUID, DATE, DATE, TEXT, UUID
) TO authenticated;

COMMENT ON FUNCTION public.selected_branch_performance_snapshot(
  UUID, DATE, DATE, TEXT, UUID
) IS 'One RLS-preserving selected-branch Finance Performance snapshot with shared report, ad, and expense computation.';
