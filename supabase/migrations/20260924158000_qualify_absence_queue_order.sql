-- Qualify DISTINCT ON and ordering against the source CTE so the INSERT
-- target columns cannot make the live query ambiguous.
CREATE OR REPLACE FUNCTION public.queue_attendance_streak_reminders(p_account_id UUID)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_count INTEGER;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;
  WITH config AS (
    SELECT account.id AS account_id, account.timezone,
      setting.attendance_streak_activated_at AS activated_at,
      setting.attendance_streak_generation AS generation,
      setting.invoice_collection_send_window_end AS send_hour,
      (clock_timestamp() AT TIME ZONE account.timezone)::date AS today
    FROM public.accounts account
    JOIN public.renewal_reminder_settings setting ON setting.account_id = account.id
    WHERE account.id = p_account_id AND setting.attendance_streak_enabled
      AND setting.attendance_streak_activated_at IS NOT NULL
  ), candidates AS (
    SELECT config.account_id, config.timezone, config.activated_at, config.generation,
      day.visit_on, member.id AS membership_id, member.contact_id,
      last_visit.last_visit_on,
      GREATEST(member.start_date, COALESCE(last_visit.last_visit_on + 1, member.start_date)) AS streak_start,
      COALESCE(
        ((day.visit_on + contact.assigned_arrival_time + INTERVAL '1 hour') AT TIME ZONE config.timezone),
        ((day.visit_on::timestamp + make_interval(hours => config.send_hour) + INTERVAL '30 minutes') AT TIME ZONE config.timezone)
      ) AS due_at
    FROM config
    CROSS JOIN LATERAL (VALUES (config.today), (config.today - 1)) day(visit_on)
    JOIN public.memberships member ON member.account_id = config.account_id
      AND member.status = 'active' AND member.start_date <= day.visit_on
      AND member.end_date >= day.visit_on
    JOIN public.contacts contact ON contact.id = member.contact_id
      AND contact.account_id = config.account_id
      AND NULLIF(btrim(contact.phone), '') IS NOT NULL
    LEFT JOIN LATERAL (
      SELECT (visit.checked_in_at AT TIME ZONE config.timezone)::date AS last_visit_on
      FROM public.attendance visit
      WHERE visit.account_id = config.account_id
        AND visit.contact_id = member.contact_id
        AND visit.checked_in_at < ((day.visit_on + 1)::timestamp AT TIME ZONE config.timezone)
      ORDER BY visit.checked_in_at DESC
      LIMIT 1
    ) last_visit ON TRUE
  ), eligible AS (
    SELECT candidate.*,
      (
        SELECT MAX((COALESCE(job.accepted_at, job.updated_at) AT TIME ZONE account.timezone)::date)
        FROM public.lifecycle_reminder_jobs job
        JOIN public.accounts account ON account.id = candidate.account_id
        WHERE job.account_id = candidate.account_id
          AND job.contact_id = candidate.contact_id
          AND job.kind = 'attendance_streak'
          AND (job.state IN ('accepted', 'delivered', 'ambiguous') OR job.provider_attempt_count > 0)
      ) AS last_send_on,
      (
        SELECT COUNT(*)::integer FROM public.lifecycle_reminder_jobs job
        WHERE job.account_id = candidate.account_id
          AND job.contact_id = candidate.contact_id
          AND job.kind = 'attendance_streak'
          AND job.provider_attempt_count > 0
          AND (candidate.last_visit_on IS NULL OR job.effective_due_on > candidate.last_visit_on)
      ) AS prior_attempts
    FROM candidates candidate
    WHERE NOT EXISTS (
      SELECT 1 FROM public.lifecycle_reminder_jobs job
      WHERE job.account_id = candidate.account_id
        AND job.contact_id = candidate.contact_id
        AND job.kind = 'attendance_streak'
        AND job.milestone_key LIKE 'since-' || candidate.streak_start::text || '%'
        AND job.state IN ('queued', 'leased', 'attempting', 'blocked', 'deferred')
    )
  ), inserted AS (
    INSERT INTO public.lifecycle_reminder_jobs (
      account_id, contact_id, membership_id, kind, subject_cycle_id,
      milestone_key, business_key, effective_due_on, coordination_on,
      activation_generation, next_attempt_at, scheduled_for_at
    )
    SELECT DISTINCT ON (eligible.account_id, eligible.contact_id, eligible.visit_on)
      account_id, contact_id, membership_id, 'attendance_streak',
      membership_id::text,
      'since-' || streak_start::text || ':on-' || visit_on::text || ':n-' || (prior_attempts + 1)::text,
      'attendance_streak:none:' || membership_id::text || ':since-' || streak_start::text || ':on-' || visit_on::text || ':n-' || (prior_attempts + 1)::text,
      visit_on, visit_on, generation, due_at, due_at
    FROM eligible
    WHERE visit_on >= streak_start + 5
      AND prior_attempts < 2
      AND (last_send_on IS NULL OR (due_at AT TIME ZONE timezone)::date >= last_send_on + 6)
      AND due_at >= activated_at AND due_at <= clock_timestamp()
      AND due_at >= clock_timestamp() - INTERVAL '2 hours'
    ORDER BY eligible.account_id, eligible.contact_id, eligible.visit_on, eligible.streak_start, eligible.membership_id
    ON CONFLICT (account_id, business_key) DO NOTHING
    RETURNING id
  ) SELECT count(*) INTO v_count FROM inserted;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.queue_attendance_streak_reminders(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.queue_attendance_streak_reminders(UUID) TO service_role;
