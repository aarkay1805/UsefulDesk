-- Step 6: opt-in retention lifecycle. All message schedules remain off until
-- an admin explicitly enables them. Planned freeze returns are staff-authored
-- dates; frozen_at is never repurposed as a promise to return.

ALTER TABLE public.renewal_reminder_settings
  ADD COLUMN IF NOT EXISTS session_pack_reminders_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS session_pack_reminders_activated_on DATE,
  ADD COLUMN IF NOT EXISTS session_pack_reminders_activated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS session_pack_reminders_generation UUID NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS freeze_return_reminders_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS freeze_return_reminders_activated_on DATE,
  ADD COLUMN IF NOT EXISTS freeze_return_reminders_activated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS freeze_return_reminders_generation UUID NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS membership_win_back_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS membership_win_back_activated_on DATE,
  ADD COLUMN IF NOT EXISTS membership_win_back_activated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS membership_win_back_generation UUID NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS service_win_back_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS service_win_back_activated_on DATE,
  ADD COLUMN IF NOT EXISTS service_win_back_activated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS service_win_back_generation UUID NOT NULL DEFAULT gen_random_uuid();

ALTER TABLE public.memberships
  ADD COLUMN IF NOT EXISTS planned_return_on DATE,
  ADD COLUMN IF NOT EXISTS planned_return_owner_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.enforce_membership_planned_return()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  -- Lifecycle RPCs already own unfreeze/cancel transitions. Clearing this
  -- optional plan as soon as a row is no longer frozen keeps those canonical
  -- flows compatible and prevents stale return tasks.
  IF NEW.status <> 'frozen' THEN
    NEW.planned_return_on := NULL;
    NEW.planned_return_owner_id := NULL;
    RETURN NEW;
  END IF;
  IF NEW.planned_return_owner_id IS NOT NULL AND NEW.planned_return_on IS NULL THEN
    RAISE EXCEPTION 'A planned return owner requires a planned return date' USING ERRCODE = '23514';
  END IF;
  IF NEW.planned_return_on IS NOT NULL
     AND NEW.frozen_at IS NOT NULL
     AND NEW.planned_return_on < NEW.frozen_at THEN
    RAISE EXCEPTION 'Planned return date cannot precede the freeze date' USING ERRCODE = '23514';
  END IF;
  IF NEW.planned_return_owner_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.account_memberships membership
    WHERE membership.account_id = NEW.account_id
      AND membership.user_id = NEW.planned_return_owner_id
  ) THEN
    RAISE EXCEPTION 'Planned return owner is not a member of this branch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_memberships_planned_return ON public.memberships;
CREATE TRIGGER trg_memberships_planned_return
  BEFORE INSERT OR UPDATE OF status, frozen_at, planned_return_on, planned_return_owner_id
  ON public.memberships FOR EACH ROW EXECUTE FUNCTION public.enforce_membership_planned_return();

ALTER TABLE public.lifecycle_reminder_jobs
  DROP CONSTRAINT IF EXISTS lifecycle_reminder_jobs_kind_check;
ALTER TABLE public.lifecycle_reminder_jobs
  ADD CONSTRAINT lifecycle_reminder_jobs_kind_check CHECK (kind IN (
    'invoice_due', 'invoice_overdue', 'installment_overdue',
    'membership_post_expiry', 'service_post_expiry', 'promise_to_pay',
    'payment_link_follow_up', 'payment_confirmation', 'autopay_recovery',
    'session_pack_low', 'session_pack_exhausted', 'freeze_return',
    'membership_win_back', 'service_win_back'
  ));
CREATE INDEX IF NOT EXISTS lifecycle_reminder_jobs_retention_cycle_idx
  ON public.lifecycle_reminder_jobs(account_id, membership_id, member_service_id, effective_due_on, kind);

CREATE OR REPLACE FUNCTION public.set_step6_reminder_activation()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_timezone TEXT;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.session_pack_reminders_enabled = OLD.session_pack_reminders_enabled
       AND (NEW.session_pack_reminders_activated_on IS DISTINCT FROM OLD.session_pack_reminders_activated_on
         OR NEW.session_pack_reminders_activated_at IS DISTINCT FROM OLD.session_pack_reminders_activated_at
         OR NEW.session_pack_reminders_generation IS DISTINCT FROM OLD.session_pack_reminders_generation)
    THEN RAISE EXCEPTION 'Session pack activation fields are system managed'; END IF;
    IF NEW.freeze_return_reminders_enabled = OLD.freeze_return_reminders_enabled
       AND (NEW.freeze_return_reminders_activated_on IS DISTINCT FROM OLD.freeze_return_reminders_activated_on
         OR NEW.freeze_return_reminders_activated_at IS DISTINCT FROM OLD.freeze_return_reminders_activated_at
         OR NEW.freeze_return_reminders_generation IS DISTINCT FROM OLD.freeze_return_reminders_generation)
    THEN RAISE EXCEPTION 'Freeze return activation fields are system managed'; END IF;
    IF NEW.membership_win_back_enabled = OLD.membership_win_back_enabled
       AND (NEW.membership_win_back_activated_on IS DISTINCT FROM OLD.membership_win_back_activated_on
         OR NEW.membership_win_back_activated_at IS DISTINCT FROM OLD.membership_win_back_activated_at
         OR NEW.membership_win_back_generation IS DISTINCT FROM OLD.membership_win_back_generation)
    THEN RAISE EXCEPTION 'Membership win-back activation fields are system managed'; END IF;
    IF NEW.service_win_back_enabled = OLD.service_win_back_enabled
       AND (NEW.service_win_back_activated_on IS DISTINCT FROM OLD.service_win_back_activated_on
         OR NEW.service_win_back_activated_at IS DISTINCT FROM OLD.service_win_back_activated_at
         OR NEW.service_win_back_generation IS DISTINCT FROM OLD.service_win_back_generation)
    THEN RAISE EXCEPTION 'Service win-back activation fields are system managed'; END IF;
  END IF;
  SELECT timezone INTO v_timezone FROM public.accounts WHERE id = NEW.account_id;
  IF NEW.session_pack_reminders_enabled AND NOT COALESCE(OLD.session_pack_reminders_enabled, FALSE) THEN
    NEW.session_pack_reminders_activated_on := (clock_timestamp() AT TIME ZONE COALESCE(v_timezone, 'UTC'))::DATE;
    NEW.session_pack_reminders_activated_at := clock_timestamp(); NEW.session_pack_reminders_generation := gen_random_uuid();
  END IF;
  IF NEW.freeze_return_reminders_enabled AND NOT COALESCE(OLD.freeze_return_reminders_enabled, FALSE) THEN
    NEW.freeze_return_reminders_activated_on := (clock_timestamp() AT TIME ZONE COALESCE(v_timezone, 'UTC'))::DATE;
    NEW.freeze_return_reminders_activated_at := clock_timestamp(); NEW.freeze_return_reminders_generation := gen_random_uuid();
  END IF;
  IF NEW.membership_win_back_enabled AND NOT COALESCE(OLD.membership_win_back_enabled, FALSE) THEN
    NEW.membership_win_back_activated_on := (clock_timestamp() AT TIME ZONE COALESCE(v_timezone, 'UTC'))::DATE;
    NEW.membership_win_back_activated_at := clock_timestamp(); NEW.membership_win_back_generation := gen_random_uuid();
  END IF;
  IF NEW.service_win_back_enabled AND NOT COALESCE(OLD.service_win_back_enabled, FALSE) THEN
    NEW.service_win_back_activated_on := (clock_timestamp() AT TIME ZONE COALESCE(v_timezone, 'UTC'))::DATE;
    NEW.service_win_back_activated_at := clock_timestamp(); NEW.service_win_back_generation := gen_random_uuid();
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_step6_reminder_activation ON public.renewal_reminder_settings;
CREATE TRIGGER trg_step6_reminder_activation
  BEFORE INSERT OR UPDATE ON public.renewal_reminder_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_step6_reminder_activation();

-- This is a staff action only. It preserves the one-open-follow-up invariant,
-- does not edit an authored task, and makes no membership/ledger mutation.
CREATE OR REPLACE FUNCTION public.create_freeze_return_follow_up(p_job_id UUID)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_job public.lifecycle_reminder_jobs%ROWTYPE; v_owner UUID; v_today DATE;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_job FROM public.lifecycle_reminder_jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND OR v_job.kind <> 'freeze_return' OR v_job.milestone_key <> 'return-day-follow-up' THEN RETURN 'not_eligible'; END IF;
  SELECT (clock_timestamp() AT TIME ZONE COALESCE(timezone, 'UTC'))::DATE INTO v_today FROM public.accounts WHERE id = v_job.account_id;
  SELECT COALESCE(membership.planned_return_owner_id, account.owner_user_id)
    INTO v_owner
  FROM public.memberships membership JOIN public.accounts account ON account.id = membership.account_id
  WHERE membership.id = v_job.membership_id AND membership.account_id = v_job.account_id
    AND membership.contact_id = v_job.contact_id AND membership.status = 'frozen'
    AND membership.planned_return_on = v_job.effective_due_on;
  IF v_owner IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.account_memberships member
    WHERE member.account_id = v_job.account_id AND member.user_id = v_owner
  ) THEN RETURN 'owner_unavailable'; END IF;
  IF EXISTS (SELECT 1 FROM public.follow_ups WHERE account_id=v_job.account_id AND contact_id=v_job.contact_id AND status='open') THEN RETURN 'existing'; END IF;
  INSERT INTO public.follow_ups(account_id, contact_id, membership_id, assigned_to, created_by, reason, task_type, due_date, note)
  VALUES(v_job.account_id, v_job.contact_id, v_job.membership_id, v_owner, v_owner, 'other', 'todo', v_today,
    'Planned membership return is today. Confirm the member’s next step; this does not resume the membership automatically.');
  RETURN 'created';
EXCEPTION WHEN unique_violation THEN RETURN 'existing';
END;
$$;
REVOKE ALL ON FUNCTION public.enforce_membership_planned_return(), public.set_step6_reminder_activation(), public.create_freeze_return_follow_up(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_freeze_return_follow_up(UUID) TO service_role;
