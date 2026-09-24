-- Link the generated staff action to the second absence reminder so a later
-- check-in can close only this automation's task.
ALTER TABLE public.follow_ups
  ADD COLUMN IF NOT EXISTS source_lifecycle_job_id UUID
    REFERENCES public.lifecycle_reminder_jobs(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS follow_ups_source_lifecycle_job_id_key
  ON public.follow_ups(source_lifecycle_job_id)
  WHERE source_lifecycle_job_id IS NOT NULL;

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
    'Member has missed visits despite two check-in messages. Review their attendance and reach out personally if appropriate.',
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

CREATE OR REPLACE FUNCTION public.sweep_attendance_absence_follow_ups(p_account_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_job RECORD;
  v_result TEXT;
  v_created INTEGER := 0;
  v_failed INTEGER := 0;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;
  FOR v_job IN
    SELECT id FROM public.lifecycle_reminder_jobs
    WHERE account_id = p_account_id
      AND kind = 'attendance_streak'
      AND milestone_key LIKE '%:n-2'
      AND state IN ('accepted', 'delivered', 'ambiguous')
      AND provider_attempt_count > 0
      AND escalated_at IS NULL
    ORDER BY created_at
    LIMIT 100
  LOOP
    BEGIN
      v_result := public.create_attendance_absence_follow_up(v_job.id);
      IF v_result = 'created' THEN v_created := v_created + 1; END IF;
    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed + 1;
    END;
  END LOOP;
  RETURN jsonb_build_object('created', v_created, 'failed', v_failed);
END;
$$;

CREATE OR REPLACE FUNCTION public.close_attendance_absence_follow_up_on_checkin()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  WITH closed AS (
    UPDATE public.follow_ups follow_up
    SET status = 'cancelled'
    FROM public.lifecycle_reminder_jobs job
    WHERE follow_up.source_lifecycle_job_id = job.id
      AND follow_up.account_id = NEW.account_id
      AND follow_up.contact_id = NEW.contact_id
      AND follow_up.status = 'open'
      AND NEW.checked_in_at > COALESCE(job.accepted_at, job.updated_at)
    RETURNING follow_up.source_lifecycle_job_id
  )
  UPDATE public.lifecycle_reminder_jobs job
  SET escalation_state = 'stopped'
  WHERE job.id IN (SELECT source_lifecycle_job_id FROM closed);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_close_attendance_absence_follow_up_on_checkin
  ON public.attendance;
CREATE TRIGGER trg_close_attendance_absence_follow_up_on_checkin
  AFTER INSERT OR UPDATE OF checked_in_at ON public.attendance
  FOR EACH ROW EXECUTE FUNCTION public.close_attendance_absence_follow_up_on_checkin();

REVOKE ALL ON FUNCTION public.create_attendance_absence_follow_up(UUID),
  public.sweep_attendance_absence_follow_ups(UUID),
  public.close_attendance_absence_follow_up_on_checkin()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_attendance_absence_follow_up(UUID),
  public.sweep_attendance_absence_follow_ups(UUID) TO service_role;
