-- One bounded dashboard action snapshot for the selected branch.
--
-- The five action sections previously shared one browser boundary but expanded
-- into twelve PostgREST data requests on the server. This SECURITY INVOKER
-- function keeps each section's independent nullable/error contract while
-- executing the selected-branch RLS reads inside one database request.

CREATE OR REPLACE FUNCTION public.dashboard_action_snapshot(
  p_today DATE,
  p_time_zone TEXT,
  p_now TIMESTAMPTZ,
  p_limit INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_gym_metrics JSONB;
  v_follow_ups JSONB;
  v_expiring_memberships JSONB;
  v_uncontacted_leads JSONB;
  v_attention JSONB;
  v_errors TEXT[] := ARRAY[]::TEXT[];
BEGIN
  IF p_today IS NULL OR p_now IS NULL THEN
    RAISE EXCEPTION 'Dashboard action date inputs are required'
      USING ERRCODE = '22004';
  END IF;
  IF p_time_zone IS NULL OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_timezone_names
    WHERE name = p_time_zone
  ) THEN
    RAISE EXCEPTION 'Dashboard action timezone is invalid'
      USING ERRCODE = '22023';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 8 THEN
    RAISE EXCEPTION 'Dashboard action preview limit must be between 1 and 8'
      USING ERRCODE = '22023';
  END IF;

  BEGIN
    WITH risk AS (
      SELECT
        COUNT(*) FILTER (
          WHERE activity.last_visit_at IS NOT NULL
            AND p_today - (
              activity.last_visit_at AT TIME ZONE p_time_zone
            )::DATE >= 10
        )::BIGINT AS missed_visit_risk,
        COUNT(*) FILTER (
          WHERE activity.last_visit_at IS NULL
        )::BIGINT AS never_visited_risk
      FROM public.member_activity AS activity
      WHERE activity.is_trial = FALSE
        AND activity.status = 'active'
        AND activity.end_date >= p_today
    ),
    expiring AS (
      SELECT COUNT(*)::BIGINT AS expiring_7
      FROM public.memberships AS membership
      LEFT JOIN public.membership_plans AS plan
        ON plan.id = membership.plan_id
      WHERE membership.is_trial = FALSE
        AND membership.status = 'active'
        AND membership.end_date >= p_today
        AND membership.end_date <= p_today + 7
        AND (
          membership.plan_id IS NULL
          OR plan.plan_type = 'recurring'
        )
    ),
    dues AS (
      SELECT
        COUNT(*)::BIGINT AS fees_due_count,
        COALESCE(SUM(due.balance), 0)::NUMERIC AS fees_due_amount
      FROM public.membership_dues AS due
      WHERE due.balance >= 0.5
    ),
    collections AS (
      SELECT
        COALESCE(SUM(payment.amount) FILTER (
          WHERE (payment.paid_at AT TIME ZONE p_time_zone)::DATE = p_today
        ), 0)::NUMERIC AS collected_today,
        (
          COALESCE(SUM(payment.amount) FILTER (
            WHERE (payment.paid_at AT TIME ZONE p_time_zone)::DATE >= p_today - 7
              AND (payment.paid_at AT TIME ZONE p_time_zone)::DATE < p_today
          ), 0) / 7
        )::NUMERIC AS collection_daily_average_7d
      FROM public.payments AS payment
      WHERE payment.status = 'paid'
        AND payment.paid_at >= (
          (p_today - 7)::TIMESTAMP AT TIME ZONE p_time_zone
        )
    )
    SELECT pg_catalog.jsonb_build_object(
      'expiring7', expiring.expiring_7,
      'feesDueCount', dues.fees_due_count,
      'feesDueAmount', dues.fees_due_amount,
      'collectedToday', collections.collected_today,
      'collectionDailyAverage7d', collections.collection_daily_average_7d,
      'missedVisitRisk', risk.missed_visit_risk,
      'neverVisitedRisk', risk.never_visited_risk
    )
    INTO v_gym_metrics
    FROM risk
    CROSS JOIN expiring
    CROSS JOIN dues
    CROSS JOIN collections;
  EXCEPTION WHEN OTHERS THEN
    v_gym_metrics := NULL;
    v_errors := pg_catalog.array_append(v_errors, 'gymMetrics');
  END;

  BEGIN
    WITH ranked AS MATERIALIZED (
      SELECT
        follow_up.account_id,
        follow_up.id,
        follow_up.contact_id,
        follow_up.membership_id,
        follow_up.task_type,
        follow_up.reason,
        follow_up.due_date,
        follow_up.remind_at,
        follow_up.assigned_to,
        follow_up.note,
        contact.name AS contact_name,
        contact.phone AS contact_phone,
        contact.avatar_url AS contact_avatar_url,
        pg_catalog.row_number() OVER (
          ORDER BY follow_up.due_date, follow_up.remind_at NULLS LAST, follow_up.id
        ) AS all_rank,
        pg_catalog.row_number() OVER (
          PARTITION BY (follow_up.membership_id IS NOT NULL)
          ORDER BY follow_up.due_date, follow_up.remind_at NULLS LAST, follow_up.id
        ) AS scope_rank
      FROM public.follow_ups AS follow_up
      JOIN public.contacts AS contact ON contact.id = follow_up.contact_id
      WHERE follow_up.status = 'open'
    ),
    assignees AS (
      SELECT DISTINCT ranked.account_id, ranked.assigned_to
      FROM ranked
      WHERE ranked.scope_rank <= p_limit
        AND ranked.assigned_to IS NOT NULL
    ),
    staff AS (
      SELECT profile.user_id, profile.full_name, profile.avatar_url
      FROM assignees
      JOIN public.profiles AS profile
        ON profile.account_id = assignees.account_id
       AND profile.user_id = assignees.assigned_to
      ORDER BY profile.full_name, profile.user_id
      LIMIT p_limit * 2
    )
    SELECT pg_catalog.jsonb_build_object(
      'counts', pg_catalog.jsonb_build_object(
        'all', COUNT(*)::BIGINT,
        'lead', COUNT(*) FILTER (
          WHERE ranked.membership_id IS NULL
        )::BIGINT,
        'member', COUNT(*) FILTER (
          WHERE ranked.membership_id IS NOT NULL
        )::BIGINT
      ),
      'rows', pg_catalog.jsonb_build_object(
        'all', COALESCE(
          pg_catalog.jsonb_agg(
            pg_catalog.jsonb_build_object(
              'id', ranked.id,
              'contact_id', ranked.contact_id,
              'membership_id', ranked.membership_id,
              'task_type', ranked.task_type,
              'reason', ranked.reason,
              'due_date', ranked.due_date,
              'remind_at', ranked.remind_at,
              'assigned_to', ranked.assigned_to,
              'note', ranked.note,
              'contact', pg_catalog.jsonb_build_object(
                'name', ranked.contact_name,
                'phone', ranked.contact_phone,
                'avatar_url', ranked.contact_avatar_url
              )
            ) ORDER BY ranked.due_date, ranked.remind_at NULLS LAST, ranked.id
          ) FILTER (WHERE ranked.all_rank <= p_limit),
          '[]'::JSONB
        ),
        'lead', COALESCE(
          pg_catalog.jsonb_agg(
            pg_catalog.jsonb_build_object(
              'id', ranked.id,
              'contact_id', ranked.contact_id,
              'membership_id', ranked.membership_id,
              'task_type', ranked.task_type,
              'reason', ranked.reason,
              'due_date', ranked.due_date,
              'remind_at', ranked.remind_at,
              'assigned_to', ranked.assigned_to,
              'note', ranked.note,
              'contact', pg_catalog.jsonb_build_object(
                'name', ranked.contact_name,
                'phone', ranked.contact_phone,
                'avatar_url', ranked.contact_avatar_url
              )
            ) ORDER BY ranked.due_date, ranked.remind_at NULLS LAST, ranked.id
          ) FILTER (
            WHERE ranked.membership_id IS NULL
              AND ranked.scope_rank <= p_limit
          ),
          '[]'::JSONB
        ),
        'member', COALESCE(
          pg_catalog.jsonb_agg(
            pg_catalog.jsonb_build_object(
              'id', ranked.id,
              'contact_id', ranked.contact_id,
              'membership_id', ranked.membership_id,
              'task_type', ranked.task_type,
              'reason', ranked.reason,
              'due_date', ranked.due_date,
              'remind_at', ranked.remind_at,
              'assigned_to', ranked.assigned_to,
              'note', ranked.note,
              'contact', pg_catalog.jsonb_build_object(
                'name', ranked.contact_name,
                'phone', ranked.contact_phone,
                'avatar_url', ranked.contact_avatar_url
              )
            ) ORDER BY ranked.due_date, ranked.remind_at NULLS LAST, ranked.id
          ) FILTER (
            WHERE ranked.membership_id IS NOT NULL
              AND ranked.scope_rank <= p_limit
          ),
          '[]'::JSONB
        )
      ),
      'staff', (
        SELECT COALESCE(
          pg_catalog.jsonb_agg(
            pg_catalog.jsonb_build_object(
              'user_id', staff.user_id,
              'full_name', staff.full_name,
              'avatar_url', staff.avatar_url
            ) ORDER BY staff.full_name, staff.user_id
          ),
          '[]'::JSONB
        )
        FROM staff
      )
    )
    INTO v_follow_ups
    FROM ranked;
  EXCEPTION WHEN OTHERS THEN
    v_follow_ups := NULL;
    v_errors := pg_catalog.array_append(v_errors, 'followUps');
  END;

  BEGIN
    WITH eligible AS MATERIALIZED (
      SELECT
        membership.id,
        membership.end_date,
        contact.name AS contact_name,
        contact.phone AS contact_phone,
        contact.avatar_url AS contact_avatar_url,
        plan.name AS plan_name,
        plan.plan_type,
        COUNT(*) OVER ()::BIGINT AS total
      FROM public.memberships AS membership
      JOIN public.contacts AS contact ON contact.id = membership.contact_id
      LEFT JOIN public.membership_plans AS plan ON plan.id = membership.plan_id
      WHERE membership.is_trial = FALSE
        AND membership.status = 'active'
        AND membership.end_date >= p_today
        AND membership.end_date <= p_today + 7
        AND (
          membership.plan_id IS NULL
          OR plan.plan_type = 'recurring'
        )
    ),
    preview AS (
      SELECT *
      FROM eligible
      ORDER BY end_date, id
      LIMIT p_limit
    )
    SELECT pg_catalog.jsonb_build_object(
      'rows', COALESCE(
        pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'id', preview.id,
            'end_date', preview.end_date,
            'contact', pg_catalog.jsonb_build_object(
              'name', preview.contact_name,
              'phone', preview.contact_phone,
              'avatar_url', preview.contact_avatar_url
            ),
            'plan', CASE
              WHEN preview.plan_name IS NULL AND preview.plan_type IS NULL
                THEN NULL
              ELSE pg_catalog.jsonb_build_object(
                'name', preview.plan_name,
                'plan_type', preview.plan_type
              )
            END
          ) ORDER BY preview.end_date, preview.id
        ),
        '[]'::JSONB
      ),
      'total', COALESCE(MAX(preview.total), 0)
    )
    INTO v_expiring_memberships
    FROM preview;
  EXCEPTION WHEN OTHERS THEN
    v_expiring_memberships := NULL;
    v_errors := pg_catalog.array_append(v_errors, 'expiringMemberships');
  END;

  BEGIN
    WITH eligible AS MATERIALIZED (
      SELECT
        contact.id,
        contact.name,
        contact.avatar_url,
        contact.created_at,
        COUNT(*) OVER ()::BIGINT AS total
      FROM public.contacts AS contact
      WHERE contact.lead_status IS NULL
        AND contact.created_at < p_now - INTERVAL '24 hours'
        AND NOT EXISTS (
          SELECT 1
          FROM public.memberships AS membership
          WHERE membership.contact_id = contact.id
        )
    ),
    preview AS (
      SELECT *
      FROM eligible
      ORDER BY created_at, id
      LIMIT p_limit
    ),
    hydrated AS (
      SELECT
        preview.*,
        conversation.last_message_text
      FROM preview
      LEFT JOIN LATERAL (
        SELECT current_conversation.last_message_text
        FROM public.conversations AS current_conversation
        WHERE current_conversation.contact_id = preview.id
        ORDER BY current_conversation.last_message_at DESC NULLS LAST,
                 current_conversation.id
        LIMIT 1
      ) AS conversation ON TRUE
    )
    SELECT pg_catalog.jsonb_build_object(
      'rows', COALESCE(
        pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'id', hydrated.id,
            'name', hydrated.name,
            'avatarUrl', hydrated.avatar_url,
            'messagePreview', pg_catalog.left(
              COALESCE(NULLIF(pg_catalog.btrim(hydrated.last_message_text), ''), 'No message yet'),
              160
            ),
            'waitingDays', GREATEST(
              1,
              pg_catalog.floor(
                EXTRACT(EPOCH FROM (p_now - hydrated.created_at)) / 86400
              )::INTEGER
            )
          ) ORDER BY hydrated.created_at, hydrated.id
        ),
        '[]'::JSONB
      ),
      'total', COALESCE(MAX(hydrated.total), 0)
    )
    INTO v_uncontacted_leads
    FROM hydrated;
  EXCEPTION WHEN OTHERS THEN
    v_uncontacted_leads := NULL;
    v_errors := pg_catalog.array_append(v_errors, 'uncontactedLeads');
  END;

  BEGIN
    SELECT pg_catalog.jsonb_build_object(
      'churnRisk', attention.churn_risk,
      'trialFollowups', attention.trial_followups,
      'failedMandates', attention.failed_mandates
    )
    INTO v_attention
    FROM public.dashboard_action_attention(p_today) AS attention;
  EXCEPTION WHEN OTHERS THEN
    v_attention := NULL;
    v_errors := pg_catalog.array_append(v_errors, 'attention');
  END;

  RETURN pg_catalog.jsonb_build_object(
    'today', p_today,
    'gymMetrics', v_gym_metrics,
    'followUps', v_follow_ups,
    'expiringMemberships', v_expiring_memberships,
    'uncontactedLeads', v_uncontacted_leads,
    'attention', v_attention,
    'errors', pg_catalog.to_jsonb(v_errors)
  );
END;
$$;

ALTER FUNCTION public.dashboard_action_snapshot(DATE, TEXT, TIMESTAMPTZ, INTEGER)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.dashboard_action_snapshot(
  DATE, TEXT, TIMESTAMPTZ, INTEGER
) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.dashboard_action_snapshot(
  DATE, TEXT, TIMESTAMPTZ, INTEGER
) TO authenticated;
