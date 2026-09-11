-- An accepted WhatsApp request and a staff follow-up are separate effects.
-- Revalidate the current cycle inside the follow-up transaction so a delayed
-- escalation cannot reopen a chase after renewal, cancellation, a reply, or
-- schedule disablement.

ALTER TABLE public.lifecycle_reminder_jobs
  DROP CONSTRAINT IF EXISTS lifecycle_reminder_jobs_escalation_state_check;
ALTER TABLE public.lifecycle_reminder_jobs
  ADD CONSTRAINT lifecycle_reminder_jobs_escalation_state_check CHECK (
    escalation_state IN ('created', 'existing', 'owner_unavailable', 'replied', 'stopped')
  );

CREATE OR REPLACE FUNCTION public.escalate_post_expiry_reminder(p_job_id UUID)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_job public.lifecycle_reminder_jobs%ROWTYPE;
  v_owner UUID;
  v_existing UUID;
  v_timezone TEXT;
  v_enabled BOOLEAN;
  v_activated_on DATE;
  v_generation UUID;
  v_today DATE;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_job FROM public.lifecycle_reminder_jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND OR v_job.kind NOT IN ('membership_post_expiry', 'service_post_expiry')
     OR v_job.milestone_key <> 'expired-7' OR v_job.state NOT IN ('accepted', 'delivered') THEN
    RETURN 'not_eligible';
  END IF;
  -- This outcome is terminal even if a previously created follow-up was later
  -- completed: retrying this job must never create a second follow-up.
  IF v_job.escalated_at IS NOT NULL THEN
    RETURN COALESCE(v_job.escalation_state, 'already_processed');
  END IF;

  SELECT owner_user_id, timezone INTO v_owner, v_timezone
  FROM public.accounts WHERE id = v_job.account_id;
  v_today := (NOW() AT TIME ZONE COALESCE(v_timezone, 'UTC'))::DATE;

  IF v_job.kind = 'membership_post_expiry' THEN
    SELECT membership_post_expiry_enabled, membership_post_expiry_activated_on,
      membership_post_expiry_generation
    INTO v_enabled, v_activated_on, v_generation
    FROM public.renewal_reminder_settings WHERE account_id = v_job.account_id;
  ELSE
    SELECT service_post_expiry_enabled, service_post_expiry_activated_on,
      service_post_expiry_generation
    INTO v_enabled, v_activated_on, v_generation
    FROM public.renewal_reminder_settings WHERE account_id = v_job.account_id;
  END IF;
  IF NOT COALESCE(v_enabled, FALSE) OR v_activated_on IS NULL
     OR v_generation IS DISTINCT FROM v_job.activation_generation
     OR v_job.effective_due_on < v_activated_on THEN
    UPDATE public.lifecycle_reminder_jobs
    SET escalation_state = 'stopped', escalated_at = NOW() WHERE id = v_job.id;
    RETURN 'stopped';
  END IF;

  IF v_job.kind = 'membership_post_expiry' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.memberships membership
      LEFT JOIN public.membership_plans plan ON plan.id = membership.plan_id
      WHERE membership.id = v_job.membership_id
        AND membership.account_id = v_job.account_id
        AND membership.contact_id = v_job.contact_id
        AND membership.end_date = v_job.effective_due_on
        AND membership.end_date < v_today
        AND membership.status = 'active'
        AND membership.collection_mode = 'manual'
        AND (plan.id IS NULL OR plan.plan_type = 'recurring')
    ) THEN
      UPDATE public.lifecycle_reminder_jobs
      SET escalation_state = 'stopped', escalated_at = NOW() WHERE id = v_job.id;
      RETURN 'stopped';
    END IF;
  ELSIF NOT EXISTS (
    SELECT 1 FROM public.service_renewal_queue service
    WHERE service.id = v_job.member_service_id
      AND service.account_id = v_job.account_id
      AND service.contact_id = v_job.contact_id
      AND service.end_date = v_job.effective_due_on
      AND service.end_date < v_today
      AND service.status = 'active'
      AND service.item_is_active AND service.option_is_active
      AND service.current_renewal_price IS NOT NULL
  ) THEN
    UPDATE public.lifecycle_reminder_jobs
    SET escalation_state = 'stopped', escalated_at = NOW() WHERE id = v_job.id;
    RETURN 'stopped';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.messages message
    JOIN public.conversations conversation ON conversation.id = message.conversation_id
    WHERE conversation.account_id = v_job.account_id
      AND conversation.contact_id = v_job.contact_id
      AND message.sender_type = 'customer'
      AND message.created_at >= (v_job.effective_due_on::TIMESTAMP AT TIME ZONE COALESCE(v_timezone, 'UTC'))
  ) THEN
    UPDATE public.lifecycle_reminder_jobs
    SET escalation_state = 'replied', escalated_at = NOW() WHERE id = v_job.id;
    RETURN 'replied';
  END IF;

  SELECT id INTO v_existing FROM public.follow_ups
  WHERE account_id = v_job.account_id AND contact_id = v_job.contact_id AND status = 'open';
  IF v_existing IS NOT NULL THEN
    UPDATE public.lifecycle_reminder_jobs
    SET escalation_state = 'existing', escalated_at = NOW() WHERE id = v_job.id;
    RETURN 'existing';
  END IF;
  IF v_owner IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.account_memberships membership
    WHERE membership.account_id = v_job.account_id AND membership.user_id = v_owner
  ) THEN
    -- Remain retryable and visible until branch ownership is repaired.
    UPDATE public.lifecycle_reminder_jobs SET escalation_state = 'owner_unavailable' WHERE id = v_job.id;
    RETURN 'owner_unavailable';
  END IF;

  INSERT INTO public.follow_ups(account_id, contact_id, membership_id, assigned_to, created_by, reason, due_date, note)
  VALUES (v_job.account_id, v_job.contact_id, v_job.membership_id, v_owner, v_owner,
    'renewal', v_today, 'Post-expiry renewal follow-up after the unanswered day-7 reminder.');
  UPDATE public.lifecycle_reminder_jobs
  SET escalation_state = 'created', escalated_at = NOW() WHERE id = v_job.id;
  RETURN 'created';
EXCEPTION WHEN unique_violation THEN
  UPDATE public.lifecycle_reminder_jobs
  SET escalation_state = 'existing', escalated_at = NOW() WHERE id = p_job_id;
  RETURN 'existing';
END; $$;

REVOKE ALL ON FUNCTION public.escalate_post_expiry_reminder(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.escalate_post_expiry_reminder(UUID) TO service_role;
