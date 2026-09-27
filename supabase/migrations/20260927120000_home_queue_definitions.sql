-- Home queue definitions: every count and preview names an exact population.
--
-- The 2026-09-27 dashboard benchmark found that three Home sections promised
-- more than their SQL proved. This replaces the selected-branch snapshot in
-- place (same signature, same JSONB envelope, same per-section nullable
-- error contract) with corrected populations:
--
-- * Not contacted yet — an enquiry is a contact with no membership AND no
--   service purchase (the contact-backed directory's own definition), still in
--   the New stage, with no recorded contact attempt. A contact attempt is a
--   staff WhatsApp message that WhatsApp accepted (sender_type 'agent', not
--   failed or still sending) or a completed follow-up with any outcome.
--   Automated messages ('bot') never count. An offline call is recorded by
--   moving the enquiry out of New (for example to Contacted) or by marking a
--   follow-up done with its outcome. Fresh enquiries appear immediately:
--   the former 24-hour gate hid the most recoverable interest for a day.
-- * Expiring memberships — eligibility is unchanged; each preview row now
--   carries the contact's one open follow-up (due date and owner), so Home
--   shows existing work instead of inviting a competing task.
-- * Needs attention — trials use the Trials page window (ending within
--   TRIAL_SOON_DAYS = 7, or ended without joining) and retire once a
--   follow-up is marked done as Not interested after the trial started.
--   AutoPay separates a setup that failed from AutoPay stopped by the
--   provider after failed charges; neither claims a debit happened, and each
--   retires when setup is repaired, a later payment is recorded, or the
--   membership stops being active. May leave stays the staff-saved flag on
--   an active membership, exactly the All members Active + May leave filter.
--
-- Expand step. The deployed app still parses the previous shape, so this
-- version also returns the fields it reads — uncontacted `waitingDays` and
-- attention `churnRisk` / `trialFollowups` / `failedMandates` — computed from
-- the corrected populations. Either app version works against this function.
-- public.dashboard_action_attention is no longer called but stays until the
-- new app is live everywhere. A later contract migration removes the
-- compatibility fields and that helper; it is not part of this step.
--
-- Rollback: re-apply dashboard_action_snapshot from
-- 20260828200000_avoid_dashboard_timezone_catalog_scans.sql. Nothing else
-- changes, so that restores the previous behaviour exactly.

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

  -- Today at a glance: unchanged.
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

  -- Follow-ups: unchanged. Whether the preview should show only due work is
  -- an open owner-validation question, so the all-open queue stays.
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

  -- Expiring memberships: the renewal-chase population is unchanged; each
  -- preview row carries the contact's open follow-up. The database allows one
  -- open follow-up per contact, so the lateral read returns at most one row.
  BEGIN
    WITH eligible AS MATERIALIZED (
      SELECT
        membership.id,
        membership.account_id,
        membership.contact_id,
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
    ),
    hydrated AS (
      SELECT
        preview.*,
        open_follow_up.due_date AS follow_up_due_date,
        NULLIF(pg_catalog.btrim(follow_up_owner.full_name), '')
          AS follow_up_owner_name
      FROM preview
      LEFT JOIN LATERAL (
        SELECT follow_up.due_date, follow_up.assigned_to
        FROM public.follow_ups AS follow_up
        WHERE follow_up.account_id = preview.account_id
          AND follow_up.contact_id = preview.contact_id
          AND follow_up.status = 'open'
        ORDER BY follow_up.due_date, follow_up.id
        LIMIT 1
      ) AS open_follow_up ON TRUE
      LEFT JOIN public.profiles AS follow_up_owner
        ON follow_up_owner.account_id = preview.account_id
       AND follow_up_owner.user_id = open_follow_up.assigned_to
    )
    SELECT pg_catalog.jsonb_build_object(
      'rows', COALESCE(
        pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'id', hydrated.id,
            'end_date', hydrated.end_date,
            'contact', pg_catalog.jsonb_build_object(
              'name', hydrated.contact_name,
              'phone', hydrated.contact_phone,
              'avatar_url', hydrated.contact_avatar_url
            ),
            'plan', CASE
              WHEN hydrated.plan_name IS NULL AND hydrated.plan_type IS NULL
                THEN NULL
              ELSE pg_catalog.jsonb_build_object(
                'name', hydrated.plan_name,
                'plan_type', hydrated.plan_type
              )
            END,
            'followUp', CASE
              WHEN hydrated.follow_up_due_date IS NULL THEN NULL
              ELSE pg_catalog.jsonb_build_object(
                'dueDate', hydrated.follow_up_due_date,
                'ownerName', hydrated.follow_up_owner_name
              )
            END
          ) ORDER BY hydrated.end_date, hydrated.id
        ),
        '[]'::JSONB
      ),
      'total', COALESCE(MAX(hydrated.total), 0)
    )
    INTO v_expiring_memberships
    FROM hydrated;
  EXCEPTION WHEN OTHERS THEN
    v_expiring_memberships := NULL;
    v_errors := pg_catalog.array_append(v_errors, 'expiringMemberships');
  END;

  -- Not contacted yet: New-stage enquiries with no recorded contact attempt,
  -- newest first so this morning's enquiry is never hidden behind a backlog.
  -- The preview line is the enquirer's own latest message, not an automated
  -- reply that may have landed after it.
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
        AND NOT EXISTS (
          SELECT 1
          FROM public.memberships AS membership
          WHERE membership.account_id = contact.account_id
            AND membership.contact_id = contact.id
        )
        AND NOT EXISTS (
          SELECT 1
          FROM public.member_services AS service
          WHERE service.contact_id = contact.id
        )
        AND NOT EXISTS (
          SELECT 1
          FROM public.follow_ups AS follow_up
          WHERE follow_up.account_id = contact.account_id
            AND follow_up.contact_id = contact.id
            AND follow_up.status = 'done'
        )
        AND NOT EXISTS (
          SELECT 1
          FROM public.conversations AS conversation
          JOIN public.messages AS message
            ON message.conversation_id = conversation.id
          WHERE conversation.account_id = contact.account_id
            AND conversation.contact_id = contact.id
            AND message.sender_type = 'agent'
            AND message.status IN ('sent', 'delivered', 'read')
        )
    ),
    preview AS (
      SELECT *
      FROM eligible
      ORDER BY created_at DESC, id DESC
      LIMIT p_limit
    ),
    hydrated AS (
      SELECT
        preview.*,
        inbound.content_text,
        inbound.content_type
      FROM preview
      LEFT JOIN LATERAL (
        SELECT message.content_text, message.content_type
        FROM public.conversations AS conversation
        JOIN public.messages AS message
          ON message.conversation_id = conversation.id
        WHERE conversation.contact_id = preview.id
          AND message.sender_type = 'customer'
        ORDER BY message.created_at DESC, message.id DESC
        LIMIT 1
      ) AS inbound ON TRUE
    )
    SELECT pg_catalog.jsonb_build_object(
      'rows', COALESCE(
        pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'id', hydrated.id,
            'name', hydrated.name,
            'avatarUrl', hydrated.avatar_url,
            'messagePreview', pg_catalog.left(
              CASE
                WHEN hydrated.content_type IS NULL THEN 'No message yet'
                ELSE COALESCE(
                  NULLIF(pg_catalog.btrim(hydrated.content_text), ''),
                  CASE hydrated.content_type
                    WHEN 'image' THEN 'Sent a photo'
                    WHEN 'video' THEN 'Sent a video'
                    WHEN 'audio' THEN 'Sent a voice message'
                    WHEN 'document' THEN 'Sent a document'
                    WHEN 'location' THEN 'Sent a location'
                    ELSE 'Sent a message'
                  END
                )
              END,
              160
            ),
            'waitingMinutes', GREATEST(
              0,
              pg_catalog.floor(
                EXTRACT(EPOCH FROM (p_now - hydrated.created_at)) / 60
              )::BIGINT
            ),
            -- Compatibility for the previous app version, which reads whole
            -- days and never expected less than one.
            'waitingDays', GREATEST(
              1,
              pg_catalog.floor(
                EXTRACT(EPOCH FROM (p_now - hydrated.created_at)) / 86400
              )::BIGINT
            )
          ) ORDER BY hydrated.created_at DESC, hydrated.id DESC
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

  -- Needs attention: the exceptions no other Home queue owns.
  BEGIN
    WITH may_leave AS (
      SELECT COUNT(*)::BIGINT AS total
      FROM public.memberships AS membership
      JOIN public.contacts AS contact ON contact.id = membership.contact_id
      WHERE membership.status = 'active'
        AND membership.is_trial = FALSE
        AND membership.end_date >= p_today
        AND contact.churn_risk = TRUE
    ),
    trials AS (
      SELECT COUNT(*)::BIGINT AS total
      FROM public.memberships AS membership
      WHERE membership.is_trial = TRUE
        AND membership.status <> 'cancelled'
        AND membership.converted_at IS NULL
        AND membership.end_date <= p_today + 7
        AND NOT EXISTS (
          SELECT 1
          FROM public.follow_ups AS follow_up
          WHERE follow_up.account_id = membership.account_id
            AND follow_up.contact_id = membership.contact_id
            AND follow_up.status = 'done'
            AND follow_up.outcome = 'not_interested'
            AND follow_up.completed_at >= (
              membership.start_date::TIMESTAMP AT TIME ZONE p_time_zone
            )
        )
    ),
    latest_mandates AS (
      SELECT DISTINCT ON (mandate.membership_id)
        mandate.membership_id,
        mandate.status,
        mandate.setup_error,
        mandate.updated_at
      FROM public.payment_mandates AS mandate
      ORDER BY mandate.membership_id, mandate.created_at DESC, mandate.id DESC
    ),
    auto_pay AS MATERIALIZED (
      SELECT
        membership.id,
        contact.name,
        contact.avatar_url,
        CASE
          WHEN latest.setup_error IS NOT NULL THEN 'setup_failed'
          ELSE 'stopped'
        END AS problem,
        latest.updated_at AS failed_at,
        COUNT(*) OVER ()::BIGINT AS total
      FROM latest_mandates AS latest
      JOIN public.memberships AS membership
        ON membership.id = latest.membership_id
      JOIN public.contacts AS contact ON contact.id = membership.contact_id
      WHERE latest.status = 'failed'
        AND membership.status = 'active'
        AND membership.is_trial = FALSE
        AND NOT EXISTS (
          SELECT 1
          FROM public.payments AS payment
          WHERE payment.membership_id = membership.id
            AND payment.status = 'paid'
            AND payment.paid_at > latest.updated_at
        )
    ),
    auto_pay_preview AS (
      SELECT *
      FROM auto_pay
      ORDER BY failed_at DESC, id
      LIMIT p_limit
    )
    SELECT pg_catalog.jsonb_build_object(
      'mayLeave', may_leave.total,
      'trials', trials.total,
      -- Compatibility for the previous app version's three counts.
      'churnRisk', may_leave.total,
      'trialFollowups', trials.total,
      'failedMandates', COALESCE((SELECT MAX(auto_pay.total) FROM auto_pay), 0),
      'autoPay', pg_catalog.jsonb_build_object(
        'total', COALESCE((SELECT MAX(auto_pay.total) FROM auto_pay), 0),
        'rows', COALESCE(
          (
            SELECT pg_catalog.jsonb_agg(
              pg_catalog.jsonb_build_object(
                'membershipId', auto_pay_preview.id,
                'name', auto_pay_preview.name,
                'avatarUrl', auto_pay_preview.avatar_url,
                'problem', auto_pay_preview.problem
              ) ORDER BY auto_pay_preview.failed_at DESC, auto_pay_preview.id
            )
            FROM auto_pay_preview
          ),
          '[]'::JSONB
        )
      )
    )
    INTO v_attention
    FROM may_leave
    CROSS JOIN trials;
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
