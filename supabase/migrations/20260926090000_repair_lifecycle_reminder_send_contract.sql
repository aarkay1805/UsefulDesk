-- Repair three lifecycle reminder queue contracts without changing any rule
-- setting, schedule, or queued job.
--
-- 1. Payment confirmations and AutoPay retry notices are exempt from the
--    per-contact daily budget, so they never reserve a daily claim. The
--    provider-attempt boundary required one anyway, so those jobs could never
--    reach Meta. Only budgeted jobs now need a reserved claim.
-- 2. The attendance migrations rebuilt the daily reservation from an older
--    copy and ranked every unlisted kind (retention, promises, payment links)
--    above debt collection. Priority now lives in one helper: collection
--    before retention, retention before attendance, unknown kinds last.
-- 3. attempt_count stopped being incremented when the claim was repaired, so
--    pre-provider failures retried hourly forever. Each re-queue now counts,
--    and the fifth ends the job as failed/retries_exhausted.

CREATE OR REPLACE FUNCTION public.lifecycle_reminder_uses_daily_budget(
  p_kind TEXT, p_milestone_key TEXT
)
RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  -- Factual transaction events are not chasing messages. An AutoPay job's
  -- milestone_key is its provider event kind ('retry_pending' | 'terminal').
  SELECT NOT (
    p_kind = 'payment_confirmation'
    OR (p_kind = 'autopay_recovery' AND p_milestone_key = 'retry_pending')
  );
$$;

CREATE OR REPLACE FUNCTION public.lifecycle_reminder_priority(
  p_kind TEXT, p_milestone_key TEXT
)
RETURNS INTEGER
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  -- Higher wins the contact's daily slot. Equal priorities do not defer each
  -- other. Unknown kinds rank last so a new kind can never silently outrank
  -- debt collection.
  SELECT CASE
    WHEN p_kind = 'promise_to_pay' AND p_milestone_key = 'promise-broken' THEN 8
    WHEN p_kind IN ('promise_to_pay', 'installment_overdue') THEN 7
    WHEN p_kind IN ('invoice_overdue', 'autopay_recovery') THEN 6
    WHEN p_kind IN ('invoice_due', 'payment_link_follow_up') THEN 5
    WHEN p_kind IN (
      'membership_post_expiry', 'service_post_expiry',
      'session_pack_low', 'session_pack_exhausted', 'freeze_return',
      'membership_win_back', 'service_win_back'
    ) THEN 3
    WHEN p_kind = 'attendance_streak' THEN 2
    WHEN p_kind = 'attendance_absence' THEN 1
    ELSE 0
  END;
$$;

REVOKE ALL ON FUNCTION
  public.lifecycle_reminder_uses_daily_budget(TEXT, TEXT),
  public.lifecycle_reminder_priority(TEXT, TEXT)
FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.reserve_lifecycle_reminder_daily_claim(
  p_job_id UUID, p_worker_id TEXT, p_lease_generation INTEGER, p_send_on DATE
)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_job public.lifecycle_reminder_jobs%ROWTYPE; v_existing_day DATE;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'service role required' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_job FROM public.lifecycle_reminder_jobs
  WHERE id=p_job_id AND lease_owner=p_worker_id AND lease_generation=p_lease_generation
    AND state='leased' AND lease_expires_at>=NOW() FOR UPDATE;
  IF NOT FOUND THEN RETURN 'lost'; END IF;
  SELECT send_on INTO v_existing_day FROM public.lifecycle_reminder_daily_claims WHERE job_id=p_job_id;
  IF v_existing_day IS NOT NULL THEN RETURN CASE WHEN v_existing_day=p_send_on THEN 'reserved' ELSE 'lost' END; END IF;
  -- A due, budgeted, higher-priority job for the same contact takes the slot.
  -- Budget-exempt jobs never hold a slot, so they cannot defer anything.
  IF EXISTS (
    SELECT 1 FROM public.lifecycle_reminder_jobs other
    WHERE other.account_id=v_job.account_id AND other.contact_id=v_job.contact_id
      AND other.id<>v_job.id AND other.state IN ('queued','leased','deferred','blocked')
      AND other.next_attempt_at<=NOW()
      AND public.lifecycle_reminder_uses_daily_budget(other.kind, other.milestone_key)
      AND public.lifecycle_reminder_priority(other.kind, other.milestone_key)
        > public.lifecycle_reminder_priority(v_job.kind, v_job.milestone_key)
  ) THEN RETURN 'deferred'; END IF;
  INSERT INTO public.lifecycle_reminder_daily_claims(account_id,contact_id,send_on,job_id)
  VALUES(v_job.account_id,v_job.contact_id,p_send_on,v_job.id)
  ON CONFLICT(account_id,contact_id,send_on) DO NOTHING;
  RETURN CASE WHEN EXISTS(SELECT 1 FROM public.lifecycle_reminder_daily_claims WHERE job_id=p_job_id AND send_on=p_send_on) THEN 'reserved' ELSE 'deferred' END;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_lifecycle_reminder_provider_attempt(
  p_job_id UUID,
  p_worker_id TEXT,
  p_lease_generation INTEGER
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_id UUID;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;
  UPDATE public.lifecycle_reminder_jobs job
  SET provider_attempt_count = job.provider_attempt_count + 1
  WHERE job.id = p_job_id AND job.lease_owner = p_worker_id
    AND job.lease_generation = p_lease_generation AND job.state = 'attempting'
    AND job.lease_expires_at >= NOW() AND job.provider_attempt_count < 3
    AND (
      NOT public.lifecycle_reminder_uses_daily_budget(job.kind, job.milestone_key)
      OR EXISTS (SELECT 1 FROM public.lifecycle_reminder_daily_claims daily WHERE daily.job_id = job.id AND daily.state = 'reserved')
    )
  RETURNING job.id INTO v_id;
  RETURN v_id IS NOT NULL;
END;
$$;

ALTER TABLE public.lifecycle_reminder_jobs
  DROP CONSTRAINT IF EXISTS lifecycle_reminder_jobs_attempt_count_check;
ALTER TABLE public.lifecycle_reminder_jobs
  ADD CONSTRAINT lifecycle_reminder_jobs_attempt_count_check
  CHECK (attempt_count BETWEEN 0 AND 5);

CREATE OR REPLACE FUNCTION public.finish_lifecycle_reminder_job(
  p_job_id UUID,
  p_worker_id TEXT,
  p_lease_generation INTEGER,
  p_state TEXT,
  p_provider_message_id TEXT DEFAULT NULL,
  p_reason JSONB DEFAULT NULL,
  p_next_attempt_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_updated UUID; v_state TEXT;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role'
     OR p_state NOT IN ('attempting', 'accepted', 'blocked', 'deferred', 'failed', 'skipped', 'ambiguous', 'queued') THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;
  -- Workers re-queue only failures that happened before any provider request.
  -- Each counts; the fifth becomes terminal instead of retrying forever.
  UPDATE public.lifecycle_reminder_jobs job
  SET state = CASE WHEN p_state = 'queued' AND job.attempt_count + 1 >= 5
        THEN 'failed' ELSE p_state END,
      attempt_count = CASE WHEN p_state = 'queued'
        THEN LEAST(job.attempt_count + 1, 5) ELSE job.attempt_count END,
      provider_message_id = COALESCE(p_provider_message_id, job.provider_message_id),
      reason = CASE WHEN p_state = 'queued' AND job.attempt_count + 1 >= 5
        THEN jsonb_strip_nulls(jsonb_build_object('code', 'retries_exhausted', 'last_code', p_reason ->> 'code'))
        ELSE p_reason END,
      next_attempt_at = COALESCE(p_next_attempt_at, CASE WHEN p_state = 'blocked' THEN NOW() + INTERVAL '1 hour' ELSE job.next_attempt_at END),
      accepted_at = CASE WHEN p_state = 'accepted' THEN NOW() ELSE job.accepted_at END,
      lease_owner = CASE WHEN p_state = 'attempting' THEN job.lease_owner ELSE NULL END,
      lease_expires_at = CASE WHEN p_state = 'attempting' THEN NOW() + INTERVAL '30 minutes' ELSE NULL END
  WHERE job.id = p_job_id AND job.lease_owner = p_worker_id AND job.lease_generation = p_lease_generation
    AND job.state IN ('leased', 'attempting') AND job.lease_expires_at >= NOW()
  RETURNING job.id, job.state INTO v_updated, v_state;
  IF v_updated IS NULL THEN RETURN FALSE; END IF;
  IF v_state IN ('accepted', 'ambiguous') THEN
    UPDATE public.lifecycle_reminder_daily_claims SET state = v_state, updated_at = NOW() WHERE job_id = p_job_id;
  ELSIF v_state <> 'attempting' THEN
    DELETE FROM public.lifecycle_reminder_daily_claims WHERE job_id = p_job_id;
  END IF;
  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION
  public.reserve_lifecycle_reminder_daily_claim(UUID, TEXT, INTEGER, DATE),
  public.mark_lifecycle_reminder_provider_attempt(UUID, TEXT, INTEGER),
  public.finish_lifecycle_reminder_job(UUID, TEXT, INTEGER, TEXT, TEXT, JSONB, TIMESTAMPTZ)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.reserve_lifecycle_reminder_daily_claim(UUID, TEXT, INTEGER, DATE),
  public.mark_lifecycle_reminder_provider_attempt(UUID, TEXT, INTEGER),
  public.finish_lifecycle_reminder_job(UUID, TEXT, INTEGER, TEXT, TEXT, JSONB, TIMESTAMPTZ)
TO service_role;
