-- If the longer-absence rule is on, stop creating daily missed-visit jobs
-- from day six of the same streak. The worker also rechecks this before send.
CREATE OR REPLACE FUNCTION public.queue_attendance_absence_reminders(p_account_id UUID)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_count INTEGER;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;
  WITH config AS (
    SELECT account.id AS account_id, account.timezone,
      setting.attendance_absence_activated_at AS activated_at,
      setting.attendance_absence_generation AS generation,
      setting.attendance_streak_enabled AS streak_enabled,
      setting.invoice_collection_send_window_end AS send_hour,
      (clock_timestamp() AT TIME ZONE account.timezone)::date AS today
    FROM public.accounts account
    JOIN public.renewal_reminder_settings setting ON setting.account_id = account.id
    WHERE account.id = p_account_id AND setting.attendance_absence_enabled
      AND setting.attendance_absence_activated_at IS NOT NULL
  ), candidates AS (
    SELECT config.*, day.visit_on, member.id AS membership_id,
      member.contact_id, contact.assigned_arrival_time,
      CASE WHEN contact.assigned_arrival_time IS NOT NULL THEN
        ((day.visit_on + contact.assigned_arrival_time + INTERVAL '1 hour') AT TIME ZONE config.timezone)
      ELSE
        ((day.visit_on::timestamp + make_interval(hours => config.send_hour) + INTERVAL '30 minutes') AT TIME ZONE config.timezone)
      END AS due_at
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
    ) last_visit ON config.streak_enabled
    WHERE NOT EXISTS (
      SELECT 1 FROM public.attendance visit
      WHERE visit.account_id = config.account_id
        AND visit.contact_id = member.contact_id
        AND visit.checked_in_at >= (day.visit_on::timestamp AT TIME ZONE config.timezone)
        AND visit.checked_in_at < ((day.visit_on + 1)::timestamp AT TIME ZONE config.timezone)
    )
      AND (
        NOT config.streak_enabled OR
        day.visit_on < GREATEST(member.start_date, COALESCE(last_visit.last_visit_on + 1, member.start_date)) + 5
      )
  ), inserted AS (
    INSERT INTO public.lifecycle_reminder_jobs (
      account_id, contact_id, membership_id, kind, subject_cycle_id,
      milestone_key, business_key, effective_due_on, coordination_on,
      activation_generation, next_attempt_at, scheduled_for_at
    )
    SELECT account_id, contact_id, membership_id, 'attendance_absence',
      membership_id::text, 'missed-' || visit_on::text,
      'attendance_absence:none:' || membership_id::text || ':missed-' || visit_on::text,
      visit_on, visit_on, generation, due_at, due_at
    FROM candidates
    WHERE due_at >= activated_at AND due_at <= clock_timestamp()
      AND due_at >= clock_timestamp() - INTERVAL '2 hours'
    ON CONFLICT (account_id, business_key) DO NOTHING
    RETURNING id
  ) SELECT count(*) INTO v_count FROM inserted;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.queue_attendance_absence_reminders(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.queue_attendance_absence_reminders(UUID)
  TO service_role;
