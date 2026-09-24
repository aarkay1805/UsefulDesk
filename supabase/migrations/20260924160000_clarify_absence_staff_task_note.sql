-- Ambiguous provider outcomes count toward the cap; keep the staff task note accurate.
CREATE OR REPLACE FUNCTION public.create_attendance_absence_follow_up(p_job_id UUID)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_job public.lifecycle_reminder_jobs%ROWTYPE;
  v_owner UUID;
  v_timezone TEXT;
  v_today DATE;
  v_enabled BOOLEAN;
  v_generation UUID;
  v_sent_at TIMESTAMPTZ;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_job FROM public.lifecycle_reminder_jobs
  WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND OR v_job.kind <> 'attendance_streak'
     OR v_job.milestone_key NOT LIKE '%:n-2'
     OR v_job.state NOT IN ('accepted', 'delivered', 'ambiguous')
     OR v_job.provider_attempt_count = 0 THEN
    RETURN 'not_eligible';
  END IF;
  IF v_job.escalated_at IS NOT NULL THEN
    RETURN COALESCE(v_job.escalation_state, 'already_processed');
  END IF;

  SELECT attendance_streak_enabled, attendance_streak_generation
  INTO v_enabled, v_generation
  FROM public.renewal_reminder_settings
  WHERE account_id = v_job.account_id;
  SELECT owner_user_id, timezone INTO v_owner, v_timezone
  FROM public.accounts WHERE id = v_job.account_id;
  v_sent_at := COALESCE(v_job.accepted_at, v_job.updated_at);
  v_today := (clock_timestamp() AT TIME ZONE COALESCE(v_timezone, 'UTC'))::date;
  IF NOT COALESCE(v_enabled, FALSE)
     OR v_generation IS DISTINCT FROM v_job.activation_generation
     OR NOT EXISTS (
       SELECT 1 FROM public.memberships member
       WHERE member.id = v_job.membership_id
         AND member.account_id = v_job.account_id
         AND member.contact_id = v_job.contact_id
         AND member.status = 'active'
         AND member.end_date >= v_today
     ) OR EXISTS (
       SELECT 1 FROM public.attendance visit
       WHERE visit.account_id = v_job.account_id
         AND visit.contact_id = v_job.contact_id
         AND visit.checked_in_at > v_sent_at
     ) THEN
    UPDATE public.lifecycle_reminder_jobs
    SET escalation_state = 'stopped', escalated_at = NOW()
    WHERE id = v_job.id;
    RETURN 'stopped';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.messages message
    JOIN public.conversations conversation
      ON conversation.id = message.conversation_id
    WHERE conversation.account_id = v_job.account_id
      AND conversation.contact_id = v_job.contact_id
      AND message.sender_type = 'customer'
      AND message.created_at > v_sent_at
  ) THEN
    UPDATE public.lifecycle_reminder_jobs
    SET escalation_state = 'replied', escalated_at = NOW()
    WHERE id = v_job.id;
    RETURN 'replied';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.follow_ups follow_up
    WHERE follow_up.account_id = v_job.account_id
      AND follow_up.contact_id = v_job.contact_id
      AND follow_up.status = 'open'
  ) THEN
    UPDATE public.lifecycle_reminder_jobs
    SET escalation_state = 'existing', escalated_at = NOW()
    WHERE id = v_job.id;
    RETURN 'existing';
  END IF;
  IF v_owner IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.account_memberships member
    WHERE member.account_id = v_job.account_id
      AND member.user_id = v_owner
  ) THEN
    UPDATE public.lifecycle_reminder_jobs
    SET escalation_state = 'owner_unavailable'
    WHERE id = v_job.id;
    RETURN 'owner_unavailable';
  END IF;

  INSERT INTO public.follow_ups (
    account_id, contact_id, membership_id, assigned_to, created_by,
    reason, task_type, due_date, note, source_lifecycle_job_id
  ) VALUES (
    v_job.account_id, v_job.contact_id, v_job.membership_id, v_owner, v_owner,
    'inactive', 'todo', v_today + 1,
    'Member remains absent after two reminder attempts. Check message history, then reach out personally if appropriate.',
    v_job.id
  );
  UPDATE public.lifecycle_reminder_jobs
  SET escalation_state = 'created', escalated_at = NOW()
  WHERE id = v_job.id;
  RETURN 'created';
EXCEPTION WHEN unique_violation THEN
  UPDATE public.lifecycle_reminder_jobs
  SET escalation_state = 'existing', escalated_at = NOW()
  WHERE id = p_job_id;
  RETURN 'existing';
END;
$$;

REVOKE ALL ON FUNCTION public.create_attendance_absence_follow_up(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_attendance_absence_follow_up(UUID) TO service_role;
