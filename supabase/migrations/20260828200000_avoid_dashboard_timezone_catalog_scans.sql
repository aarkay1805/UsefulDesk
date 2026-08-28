-- Avoid repeated scans of the computed timezone catalog view in hot RPCs.
--
-- PostgreSQL's direct timezone() resolver rejects invalid names without
-- materializing the computed timezone catalog view. The functions remain
-- SECURITY INVOKER so selected-branch RLS stays authoritative.

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
  IF p_time_zone IS NULL THEN
    RAISE EXCEPTION 'Dashboard action timezone is invalid'
      USING ERRCODE = '22023';
  END IF;
  BEGIN
    PERFORM pg_catalog.timezone(p_time_zone, p_now);
  EXCEPTION WHEN invalid_parameter_value THEN
    RAISE EXCEPTION 'Dashboard action timezone is invalid'
      USING ERRCODE = '22023';
  END;
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

CREATE OR REPLACE FUNCTION public.dashboard_conversation_series(
  p_range_days INTEGER,
  p_time_zone TEXT,
  p_today DATE
)
RETURNS TABLE (
  day DATE,
  incoming BIGINT,
  outgoing BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF p_range_days IS NULL OR p_range_days NOT IN (7, 30, 90) THEN
    RAISE EXCEPTION 'Dashboard insight range must be 7, 30, or 90'
      USING ERRCODE = '22023';
  END IF;
  IF p_today IS NULL THEN
    RAISE EXCEPTION 'Dashboard insight end date is required'
      USING ERRCODE = '22004';
  END IF;
  IF p_time_zone IS NULL THEN
    RAISE EXCEPTION 'Unknown dashboard insight time zone'
      USING ERRCODE = '22023';
  END IF;
  BEGIN
    PERFORM pg_catalog.timezone(p_time_zone, p_today::TIMESTAMP);
  EXCEPTION WHEN invalid_parameter_value THEN
    RAISE EXCEPTION 'Unknown dashboard insight time zone'
      USING ERRCODE = '22023';
  END;

  RETURN QUERY
  WITH days AS (
    SELECT
      p_today - (p_range_days - 1) + offset_value AS local_day
    FROM pg_catalog.generate_series(0, p_range_days - 1) AS offsets(offset_value)
  ),
  counts AS (
    SELECT
      (message.created_at AT TIME ZONE p_time_zone)::DATE AS local_day,
      count(*) FILTER (WHERE message.sender_type = 'customer') AS incoming,
      count(*) FILTER (WHERE message.sender_type <> 'customer') AS outgoing
    FROM public.messages AS message
    WHERE message.created_at >= (
      (p_today - (p_range_days - 1))::TIMESTAMP AT TIME ZONE p_time_zone
    )
      AND message.created_at < (
        (p_today + 1)::TIMESTAMP AT TIME ZONE p_time_zone
      )
    GROUP BY 1
  )
  SELECT
    days.local_day,
    COALESCE(counts.incoming, 0)::BIGINT,
    COALESCE(counts.outgoing, 0)::BIGINT
  FROM days
  LEFT JOIN counts USING (local_day)
  ORDER BY days.local_day;
END;
$$;

ALTER FUNCTION public.dashboard_conversation_series(INTEGER, TEXT, DATE)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.dashboard_conversation_series(INTEGER, TEXT, DATE)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dashboard_conversation_series(INTEGER, TEXT, DATE)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.dashboard_lead_rating_inputs(
  p_range_days INTEGER,
  p_time_zone TEXT,
  p_today DATE
)
RETURNS TABLE (
  source TEXT,
  cohort_size BIGINT,
  member_conversion_successes BIGINT,
  trial_booking_successes BIGINT,
  human_response_successes BIGINT,
  human_response_sample BIGINT,
  follow_up_successes BIGINT,
  follow_up_sample BIGINT,
  positive_outcome_successes BIGINT,
  positive_outcome_sample BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF p_range_days IS NULL OR p_range_days NOT IN (7, 30, 90) THEN
    RAISE EXCEPTION 'Dashboard insight range must be 7, 30, or 90'
      USING ERRCODE = '22023';
  END IF;
  IF p_today IS NULL THEN
    RAISE EXCEPTION 'Dashboard insight end date is required'
      USING ERRCODE = '22004';
  END IF;
  IF p_time_zone IS NULL THEN
    RAISE EXCEPTION 'Unknown dashboard insight time zone'
      USING ERRCODE = '22023';
  END IF;
  BEGIN
    PERFORM pg_catalog.timezone(p_time_zone, p_today::TIMESTAMP);
  EXCEPTION WHEN invalid_parameter_value THEN
    RAISE EXCEPTION 'Unknown dashboard insight time zone'
      USING ERRCODE = '22023';
  END;

  RETURN QUERY
  WITH bounds AS (
    SELECT
      (p_today - (p_range_days - 1))::TIMESTAMP
        AT TIME ZONE p_time_zone AS start_at,
      (p_today + 1)::TIMESTAMP
        AT TIME ZONE p_time_zone AS end_at
  ),
  cohort AS (
    SELECT
      contact.id,
      COALESCE(NULLIF(TRIM(contact.source), ''), 'unknown') AS source,
      contact.lead_status,
      contact.created_at
    FROM public.contacts AS contact
    CROSS JOIN bounds
    WHERE contact.created_at >= bounds.start_at
      AND contact.created_at < bounds.end_at
  ),
  cohort_memberships AS (
    SELECT
      membership.contact_id,
      membership.is_trial,
      membership.converted_at,
      membership.created_at
    FROM public.memberships AS membership
    JOIN cohort ON cohort.id = membership.contact_id
    CROSS JOIN bounds
    WHERE membership.created_at >= bounds.start_at
  ),
  cohort_follow_ups AS (
    SELECT
      follow_up.contact_id,
      bool_or(
        follow_up.status = 'done'
        AND follow_up.outcome = 'trial_booked'
      ) AS has_trial_outcome,
      count(*) FILTER (
        WHERE follow_up.status <> 'cancelled'
          AND follow_up.due_date <= p_today
      ) AS follow_up_sample,
      count(*) FILTER (
        WHERE follow_up.status = 'done'
          AND follow_up.due_date <= p_today
          AND follow_up.completed_at < (
            (follow_up.due_date + 1)::TIMESTAMP AT TIME ZONE p_time_zone
          )
      ) AS follow_up_successes,
      count(*) FILTER (
        WHERE follow_up.status = 'done'
          AND follow_up.outcome IS NOT NULL
      ) AS positive_outcome_sample,
      count(*) FILTER (
        WHERE follow_up.status = 'done'
          AND follow_up.outcome IN (
            'renewed', 'paid', 'promised', 'contacted', 'trial_booked'
          )
      ) AS positive_outcome_successes
    FROM public.follow_ups AS follow_up
    JOIN cohort ON cohort.id = follow_up.contact_id
    CROSS JOIN bounds
    WHERE follow_up.created_at >= bounds.start_at
    GROUP BY follow_up.contact_id
  ),
  eligible_messages AS (
    SELECT
      cohort.id AS contact_id,
      message.id,
      message.sender_type,
      message.created_at
    FROM cohort
    JOIN public.conversations AS conversation
      ON conversation.contact_id = cohort.id
    JOIN public.messages AS message
      ON message.conversation_id = conversation.id
    CROSS JOIN bounds
    WHERE conversation.created_at >= bounds.start_at
      AND message.created_at >= bounds.start_at
      AND message.created_at >= cohort.created_at
  ),
  first_inbound AS (
    SELECT DISTINCT ON (message.contact_id)
      message.contact_id,
      message.id,
      message.created_at
    FROM eligible_messages AS message
    WHERE message.sender_type = 'customer'
    ORDER BY message.contact_id, message.created_at, message.id
  ),
  first_human_response AS (
    SELECT
      inbound.contact_id,
      response.created_at
    FROM first_inbound AS inbound
    LEFT JOIN LATERAL (
      SELECT message.created_at
      FROM eligible_messages AS message
      WHERE message.contact_id = inbound.contact_id
        AND message.sender_type = 'agent'
        AND (
          message.created_at > inbound.created_at
          OR (
            message.created_at = inbound.created_at
            AND message.id > inbound.id
          )
        )
      ORDER BY message.created_at, message.id
      LIMIT 1
    ) AS response ON TRUE
  ),
  contact_facts AS (
    SELECT
      cohort.id,
      cohort.source,
      (
        membership.contact_id IS NOT NULL
        AND NOT membership.is_trial
        AND COALESCE(membership.converted_at, membership.created_at)
          >= cohort.created_at
        AND COALESCE(membership.converted_at, membership.created_at)
          <= statement_timestamp()
      ) AS converted,
      (
        cohort.lead_status = 'trial_booked'
        OR COALESCE(follow_up.has_trial_outcome, FALSE)
        OR COALESCE(membership.is_trial, FALSE)
        OR membership.converted_at IS NOT NULL
      ) AS trial_booked,
      inbound.contact_id IS NOT NULL AS has_inbound,
      (
        response.created_at IS NOT NULL
        AND response.created_at - inbound.created_at <= INTERVAL '24 hours'
      ) AS responded_in_24h,
      COALESCE(follow_up.follow_up_successes, 0)::BIGINT
        AS follow_up_successes,
      COALESCE(follow_up.follow_up_sample, 0)::BIGINT AS follow_up_sample,
      COALESCE(follow_up.positive_outcome_successes, 0)::BIGINT
        AS positive_outcome_successes,
      COALESCE(follow_up.positive_outcome_sample, 0)::BIGINT
        AS positive_outcome_sample
    FROM cohort
    LEFT JOIN cohort_memberships AS membership
      ON membership.contact_id = cohort.id
    LEFT JOIN cohort_follow_ups AS follow_up
      ON follow_up.contact_id = cohort.id
    LEFT JOIN first_inbound AS inbound
      ON inbound.contact_id = cohort.id
    LEFT JOIN first_human_response AS response
      ON response.contact_id = cohort.id
  )
  SELECT
    contact.source,
    count(*) AS cohort_size,
    count(*) FILTER (WHERE contact.converted) AS member_conversion_successes,
    count(*) FILTER (WHERE contact.trial_booked) AS trial_booking_successes,
    count(*) FILTER (WHERE contact.responded_in_24h)
      AS human_response_successes,
    count(*) FILTER (WHERE contact.has_inbound) AS human_response_sample,
    sum(contact.follow_up_successes)::BIGINT AS follow_up_successes,
    sum(contact.follow_up_sample)::BIGINT AS follow_up_sample,
    sum(contact.positive_outcome_successes)::BIGINT
      AS positive_outcome_successes,
    sum(contact.positive_outcome_sample)::BIGINT AS positive_outcome_sample
  FROM contact_facts AS contact
  GROUP BY contact.source;
END;
$$;

ALTER FUNCTION public.dashboard_lead_rating_inputs(INTEGER, TEXT, DATE)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.dashboard_lead_rating_inputs(INTEGER, TEXT, DATE)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dashboard_lead_rating_inputs(INTEGER, TEXT, DATE)
  TO authenticated;
