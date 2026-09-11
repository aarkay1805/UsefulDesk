-- Forward-only hardening for retention races. A frozen return task is an
-- independent durable effect, so it must validate the same source/generation
-- identity that the worker used and record a terminal outcome exactly once.

CREATE OR REPLACE FUNCTION public.create_freeze_return_follow_up(p_job_id UUID)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_job public.lifecycle_reminder_jobs%ROWTYPE;
  v_owner UUID;
  v_timezone TEXT;
  v_today DATE;
  v_enabled BOOLEAN;
  v_activated_on DATE;
  v_generation UUID;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_job
  FROM public.lifecycle_reminder_jobs
  WHERE id = p_job_id
  FOR UPDATE;
  IF NOT FOUND OR v_job.kind <> 'freeze_return'
     OR v_job.milestone_key <> 'return-day-follow-up'
     OR v_job.state NOT IN ('leased', 'attempting', 'accepted', 'delivered') THEN
    RETURN 'not_eligible';
  END IF;
  IF v_job.escalated_at IS NOT NULL THEN
    RETURN COALESCE(v_job.escalation_state, 'already_processed');
  END IF;

  SELECT timezone INTO v_timezone FROM public.accounts WHERE id = v_job.account_id;
  v_today := (clock_timestamp() AT TIME ZONE COALESCE(v_timezone, 'UTC'))::DATE;
  IF v_job.effective_due_on > v_today THEN
    RETURN 'not_eligible';
  END IF;

  SELECT freeze_return_reminders_enabled, freeze_return_reminders_activated_on,
    freeze_return_reminders_generation
  INTO v_enabled, v_activated_on, v_generation
  FROM public.renewal_reminder_settings
  WHERE account_id = v_job.account_id;
  IF NOT COALESCE(v_enabled, FALSE) OR v_activated_on IS NULL
     OR v_generation IS DISTINCT FROM v_job.activation_generation
     OR v_job.effective_due_on < v_activated_on THEN
    UPDATE public.lifecycle_reminder_jobs
    SET escalation_state = 'stopped', escalated_at = NOW()
    WHERE id = v_job.id;
    RETURN 'stopped';
  END IF;

  SELECT COALESCE(membership.planned_return_owner_id, account.owner_user_id)
  INTO v_owner
  FROM public.memberships membership
  JOIN public.accounts account ON account.id = membership.account_id
  WHERE membership.id = v_job.membership_id
    AND membership.account_id = v_job.account_id
    AND membership.contact_id = v_job.contact_id
    AND membership.status = 'frozen'
    AND membership.planned_return_on = v_job.effective_due_on
    AND v_job.subject_cycle_id = membership.id::TEXT || ':' || membership.planned_return_on::TEXT || ':' || v_job.activation_generation::TEXT;
  IF v_owner IS NULL THEN
    UPDATE public.lifecycle_reminder_jobs
    SET escalation_state = 'stopped', escalated_at = NOW()
    WHERE id = v_job.id;
    RETURN 'stopped';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.account_memberships member
    WHERE member.account_id = v_job.account_id
      AND member.user_id = v_owner
  ) THEN
    -- Missing ownership may be repaired; do not mark it terminal yet.
    UPDATE public.lifecycle_reminder_jobs
    SET escalation_state = 'owner_unavailable'
    WHERE id = v_job.id;
    RETURN 'owner_unavailable';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.follow_ups
    WHERE account_id = v_job.account_id
      AND contact_id = v_job.contact_id
      AND status = 'open'
  ) THEN
    UPDATE public.lifecycle_reminder_jobs
    SET escalation_state = 'existing', escalated_at = NOW()
    WHERE id = v_job.id;
    RETURN 'existing';
  END IF;

  INSERT INTO public.follow_ups(
    account_id, contact_id, membership_id, assigned_to, created_by,
    reason, task_type, due_date, note
  ) VALUES (
    v_job.account_id, v_job.contact_id, v_job.membership_id, v_owner, v_owner,
    'other', 'todo', v_today,
    'Planned membership return is today. Confirm the member’s next step; this does not resume the membership automatically.'
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

REVOKE ALL ON FUNCTION public.create_freeze_return_follow_up(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_freeze_return_follow_up(UUID) TO service_role;
