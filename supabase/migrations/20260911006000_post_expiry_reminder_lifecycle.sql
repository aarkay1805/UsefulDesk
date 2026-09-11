-- Opt-in expiry follow-up. This extends the shared durable queue; it neither
-- enables existing schedules nor backfills a historical membership/service.

ALTER TABLE public.renewal_reminder_settings
  ADD COLUMN IF NOT EXISTS membership_post_expiry_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS membership_post_expiry_activated_on DATE,
  ADD COLUMN IF NOT EXISTS membership_post_expiry_activated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS membership_post_expiry_generation UUID NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS membership_post_expiry_catch_up_days INTEGER NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS service_post_expiry_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS service_post_expiry_activated_on DATE,
  ADD COLUMN IF NOT EXISTS service_post_expiry_activated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS service_post_expiry_generation UUID NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS service_post_expiry_catch_up_days INTEGER NOT NULL DEFAULT 2;

ALTER TABLE public.renewal_reminder_settings
  DROP CONSTRAINT IF EXISTS renewal_reminder_post_expiry_window_check;
ALTER TABLE public.renewal_reminder_settings
  ADD CONSTRAINT renewal_reminder_post_expiry_window_check CHECK (
    membership_post_expiry_catch_up_days BETWEEN 0 AND 14
    AND service_post_expiry_catch_up_days BETWEEN 0 AND 14
  );

ALTER TABLE public.lifecycle_reminder_jobs
  ADD COLUMN IF NOT EXISTS membership_id UUID REFERENCES public.memberships(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS member_service_id UUID REFERENCES public.member_services(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS escalation_state TEXT CHECK (escalation_state IN ('created', 'existing', 'owner_unavailable', 'replied')),
  ADD COLUMN IF NOT EXISTS escalated_at TIMESTAMPTZ;

ALTER TABLE public.lifecycle_reminder_jobs
  DROP CONSTRAINT IF EXISTS lifecycle_reminder_jobs_kind_check;
ALTER TABLE public.lifecycle_reminder_jobs
  ADD CONSTRAINT lifecycle_reminder_jobs_kind_check CHECK (kind IN (
    'invoice_due', 'invoice_overdue', 'installment_overdue', 'payment_confirmation',
    'membership_post_expiry', 'service_post_expiry'
  ));

CREATE INDEX IF NOT EXISTS lifecycle_reminder_jobs_membership_cycle_idx
  ON public.lifecycle_reminder_jobs(account_id, membership_id, effective_due_on)
  WHERE membership_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS lifecycle_reminder_jobs_service_cycle_idx
  ON public.lifecycle_reminder_jobs(account_id, member_service_id, effective_due_on)
  WHERE member_service_id IS NOT NULL;

-- Activation fields are system-managed exactly like invoice collection. A
-- generation change supersedes old queued work without deleting its history.
CREATE OR REPLACE FUNCTION public.set_invoice_collection_activation()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_timezone TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.invoice_collection_enabled = OLD.invoice_collection_enabled
    AND (NEW.invoice_collection_activated_on IS DISTINCT FROM OLD.invoice_collection_activated_on
      OR NEW.invoice_collection_activated_at IS DISTINCT FROM OLD.invoice_collection_activated_at
      OR NEW.invoice_collection_generation IS DISTINCT FROM OLD.invoice_collection_generation
      OR NEW.membership_post_expiry_activated_on IS DISTINCT FROM OLD.membership_post_expiry_activated_on
      OR NEW.membership_post_expiry_activated_at IS DISTINCT FROM OLD.membership_post_expiry_activated_at
      OR NEW.membership_post_expiry_generation IS DISTINCT FROM OLD.membership_post_expiry_generation
      OR NEW.service_post_expiry_activated_on IS DISTINCT FROM OLD.service_post_expiry_activated_on
      OR NEW.service_post_expiry_activated_at IS DISTINCT FROM OLD.service_post_expiry_activated_at
      OR NEW.service_post_expiry_generation IS DISTINCT FROM OLD.service_post_expiry_generation) THEN
    RAISE EXCEPTION 'Reminder activation fields are system managed';
  END IF;
  SELECT timezone INTO v_timezone FROM public.accounts WHERE id = NEW.account_id;
  IF NEW.invoice_collection_enabled AND NOT COALESCE(OLD.invoice_collection_enabled, FALSE) THEN
    NEW.invoice_collection_activated_on := (NOW() AT TIME ZONE COALESCE(v_timezone, 'UTC'))::DATE;
    NEW.invoice_collection_activated_at := NOW(); NEW.invoice_collection_generation := gen_random_uuid();
  END IF;
  IF NEW.membership_post_expiry_enabled AND NOT COALESCE(OLD.membership_post_expiry_enabled, FALSE) THEN
    NEW.membership_post_expiry_activated_on := (NOW() AT TIME ZONE COALESCE(v_timezone, 'UTC'))::DATE;
    NEW.membership_post_expiry_activated_at := NOW(); NEW.membership_post_expiry_generation := gen_random_uuid();
  END IF;
  IF NEW.service_post_expiry_enabled AND NOT COALESCE(OLD.service_post_expiry_enabled, FALSE) THEN
    NEW.service_post_expiry_activated_on := (NOW() AT TIME ZONE COALESCE(v_timezone, 'UTC'))::DATE;
    NEW.service_post_expiry_activated_at := NOW(); NEW.service_post_expiry_generation := gen_random_uuid();
  END IF;
  RETURN NEW;
END; $$;

-- This is a service-only, idempotent escalation. The unique partial index on
-- follow_ups remains the authority: an existing open task is returned without
-- changing its author, assignment, note, or promised action.
CREATE OR REPLACE FUNCTION public.escalate_post_expiry_reminder(p_job_id UUID)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_job public.lifecycle_reminder_jobs%ROWTYPE; v_owner UUID; v_existing UUID;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_job FROM public.lifecycle_reminder_jobs
  WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND OR v_job.kind NOT IN ('membership_post_expiry', 'service_post_expiry')
     OR v_job.milestone_key <> 'expired-7' OR v_job.state NOT IN ('accepted', 'delivered') THEN
    RETURN 'not_eligible';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.messages msg JOIN public.conversations c ON c.id = msg.conversation_id
    WHERE c.account_id = v_job.account_id AND c.contact_id = v_job.contact_id
      AND msg.sender_type = 'customer' AND msg.created_at >= v_job.created_at
  ) THEN
    UPDATE public.lifecycle_reminder_jobs SET escalation_state='replied', escalated_at=NOW() WHERE id=v_job.id;
    RETURN 'replied';
  END IF;
  SELECT id INTO v_existing FROM public.follow_ups
  WHERE account_id = v_job.account_id AND contact_id = v_job.contact_id AND status = 'open';
  IF v_existing IS NOT NULL THEN
    UPDATE public.lifecycle_reminder_jobs SET escalation_state='existing', escalated_at=NOW() WHERE id=v_job.id;
    RETURN 'existing';
  END IF;
  SELECT owner_user_id INTO v_owner FROM public.accounts WHERE id = v_job.account_id;
  IF v_owner IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.account_memberships am
    WHERE am.account_id = v_job.account_id AND am.user_id = v_owner
  ) THEN
    UPDATE public.lifecycle_reminder_jobs SET escalation_state='owner_unavailable', escalated_at=NOW() WHERE id=v_job.id;
    RETURN 'owner_unavailable';
  END IF;
  INSERT INTO public.follow_ups(account_id, contact_id, membership_id, assigned_to, created_by, reason, due_date, note)
  VALUES (v_job.account_id, v_job.contact_id, v_job.membership_id, v_owner, v_owner,
    'renewal', (NOW() AT TIME ZONE (SELECT timezone FROM public.accounts WHERE id = v_job.account_id))::DATE,
    'Post-expiry renewal follow-up after the unanswered day-7 reminder.');
  UPDATE public.lifecycle_reminder_jobs SET escalation_state='created', escalated_at=NOW() WHERE id=v_job.id;
  RETURN 'created';
EXCEPTION WHEN unique_violation THEN
  UPDATE public.lifecycle_reminder_jobs SET escalation_state='existing', escalated_at=NOW() WHERE id=p_job_id;
  RETURN 'existing';
END; $$;

REVOKE ALL ON FUNCTION public.escalate_post_expiry_reminder(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.escalate_post_expiry_reminder(UUID) TO service_role;
