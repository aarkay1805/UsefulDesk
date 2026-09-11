-- Repair the opt-in reminder lifecycle without rewriting its applied history.
-- Security definer functions must inspect the request JWT role, not
-- current_user (which is the definer/owner inside these functions).

ALTER TABLE public.lifecycle_reminder_jobs
  ADD COLUMN IF NOT EXISTS provider_attempt_count INTEGER NOT NULL DEFAULT 0
    CHECK (provider_attempt_count BETWEEN 0 AND 3);

CREATE TABLE IF NOT EXISTS public.lifecycle_reminder_daily_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  send_on DATE NOT NULL,
  job_id UUID NOT NULL REFERENCES public.lifecycle_reminder_jobs(id) ON DELETE CASCADE,
  state TEXT NOT NULL DEFAULT 'reserved' CHECK (state IN ('reserved', 'accepted', 'ambiguous')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, contact_id, send_on),
  UNIQUE (job_id)
);
ALTER TABLE public.lifecycle_reminder_daily_claims ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lifecycle_reminder_daily_claims_select ON public.lifecycle_reminder_daily_claims;
CREATE POLICY lifecycle_reminder_daily_claims_select
  ON public.lifecycle_reminder_daily_claims FOR SELECT TO authenticated
  USING (public.is_account_member(account_id));
REVOKE ALL ON TABLE public.lifecycle_reminder_daily_claims FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lifecycle_reminder_daily_claims TO service_role;

CREATE OR REPLACE FUNCTION public.valid_lifecycle_reminder_offsets(
  p_values INTEGER[],
  p_allowed INTEGER[]
)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT cardinality(p_values) > 0
    AND p_values <@ p_allowed
    AND cardinality(p_values) = cardinality(ARRAY(SELECT DISTINCT value FROM unnest(p_values) AS value));
$$;

ALTER TABLE public.renewal_reminder_settings
  DROP CONSTRAINT IF EXISTS renewal_reminder_invoice_collection_offsets_check;
ALTER TABLE public.renewal_reminder_settings
  ADD CONSTRAINT renewal_reminder_invoice_collection_offsets_check CHECK (
    public.valid_lifecycle_reminder_offsets(invoice_collection_before_due_days, ARRAY[0, 1, 3])
    AND public.valid_lifecycle_reminder_offsets(invoice_collection_overdue_days, ARRAY[1, 3, 7, 14])
  );

CREATE OR REPLACE FUNCTION public.set_invoice_collection_activation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_timezone TEXT;
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.invoice_collection_enabled = OLD.invoice_collection_enabled
     AND (
       NEW.invoice_collection_activated_on IS DISTINCT FROM OLD.invoice_collection_activated_on
       OR NEW.invoice_collection_activated_at IS DISTINCT FROM OLD.invoice_collection_activated_at
       OR NEW.invoice_collection_generation IS DISTINCT FROM OLD.invoice_collection_generation
     ) THEN
    RAISE EXCEPTION 'Invoice collection activation fields are system managed';
  END IF;

  IF NEW.invoice_collection_enabled
     AND NOT COALESCE(OLD.invoice_collection_enabled, FALSE) THEN
    SELECT timezone INTO v_timezone FROM public.accounts WHERE id = NEW.account_id;
    NEW.invoice_collection_activated_on := (NOW() AT TIME ZONE COALESCE(v_timezone, 'UTC'))::DATE;
    NEW.invoice_collection_activated_at := NOW();
    NEW.invoice_collection_generation := gen_random_uuid();
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_lifecycle_reminder_jobs(
  p_worker_id TEXT,
  p_limit INTEGER DEFAULT 100
)
RETURNS SETOF public.lifecycle_reminder_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role'
     OR COALESCE(NULLIF(p_worker_id, ''), '') = '' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;

  -- A worker that died after a pre-provider boundary must be visible for
  -- reconciliation, never silently reclaimed for a duplicate send.
  UPDATE public.lifecycle_reminder_jobs
  SET state = 'ambiguous',
      reason = COALESCE(reason, '{}'::jsonb) || jsonb_build_object('code', 'lease_expired_before_outcome'),
      lease_owner = NULL,
      lease_expires_at = NULL
  WHERE state IN ('leased', 'attempting')
    AND lease_expires_at < NOW();

  RETURN QUERY
  WITH claimable AS (
    SELECT job.id
    FROM public.lifecycle_reminder_jobs AS job
    WHERE job.provider_attempt_count < 3
      AND job.state IN ('queued', 'deferred', 'failed', 'blocked')
      AND job.next_attempt_at <= NOW()
    ORDER BY job.next_attempt_at, job.created_at
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 200)
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.lifecycle_reminder_jobs AS job
  SET state = 'leased',
      lease_owner = p_worker_id,
      lease_generation = job.lease_generation + 1,
      lease_expires_at = NOW() + INTERVAL '10 minutes'
  FROM claimable
  WHERE job.id = claimable.id
  RETURNING job.*;
END;
$$;

CREATE OR REPLACE FUNCTION public.reserve_lifecycle_reminder_daily_claim(
  p_job_id UUID,
  p_worker_id TEXT,
  p_lease_generation INTEGER,
  p_send_on DATE
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_job public.lifecycle_reminder_jobs%ROWTYPE;
  v_candidate_priority INTEGER;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_job FROM public.lifecycle_reminder_jobs
  WHERE id = p_job_id AND lease_owner = p_worker_id
    AND lease_generation = p_lease_generation AND state = 'leased'
    AND lease_expires_at >= NOW()
  FOR UPDATE;
  IF NOT FOUND THEN RETURN 'lost'; END IF;
  v_candidate_priority := CASE v_job.kind
    WHEN 'installment_overdue' THEN 4 WHEN 'invoice_overdue' THEN 3
    WHEN 'invoice_due' THEN 2 ELSE 5 END;
  IF EXISTS (
    SELECT 1 FROM public.lifecycle_reminder_jobs other
    WHERE other.account_id = v_job.account_id AND other.contact_id = v_job.contact_id
      AND other.id <> v_job.id
      AND other.state IN ('queued', 'leased', 'deferred', 'failed', 'blocked')
      AND other.next_attempt_at <= NOW()
      AND (CASE other.kind WHEN 'installment_overdue' THEN 4 WHEN 'invoice_overdue' THEN 3 WHEN 'invoice_due' THEN 2 ELSE 5 END) > v_candidate_priority
  ) THEN RETURN 'deferred'; END IF;
  INSERT INTO public.lifecycle_reminder_daily_claims(account_id, contact_id, send_on, job_id)
  VALUES (v_job.account_id, v_job.contact_id, p_send_on, v_job.id)
  ON CONFLICT (account_id, contact_id, send_on) DO NOTHING;
  RETURN CASE WHEN EXISTS (SELECT 1 FROM public.lifecycle_reminder_daily_claims WHERE job_id = v_job.id)
    THEN 'reserved' ELSE 'deferred' END;
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
    AND EXISTS (SELECT 1 FROM public.lifecycle_reminder_daily_claims daily WHERE daily.job_id = job.id AND daily.state = 'reserved')
  RETURNING job.id INTO v_id;
  RETURN v_id IS NOT NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_lifecycle_reminder_job(
  p_job_id UUID, p_worker_id TEXT, p_lease_generation INTEGER, p_state TEXT,
  p_provider_message_id TEXT DEFAULT NULL, p_reason JSONB DEFAULT NULL,
  p_next_attempt_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_updated UUID;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role'
     OR p_state NOT IN ('attempting', 'accepted', 'blocked', 'deferred', 'failed', 'skipped', 'ambiguous', 'queued') THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;
  UPDATE public.lifecycle_reminder_jobs
  SET state = p_state, provider_message_id = COALESCE(p_provider_message_id, provider_message_id),
      reason = p_reason, next_attempt_at = COALESCE(p_next_attempt_at, next_attempt_at),
      accepted_at = CASE WHEN p_state = 'accepted' THEN NOW() ELSE accepted_at END,
      lease_owner = CASE WHEN p_state = 'attempting' THEN lease_owner ELSE NULL END,
      lease_expires_at = CASE WHEN p_state = 'attempting' THEN NOW() + INTERVAL '30 minutes' ELSE NULL END
  WHERE id = p_job_id AND lease_owner = p_worker_id AND lease_generation = p_lease_generation
    AND state IN ('leased', 'attempting') AND lease_expires_at >= NOW()
  RETURNING id INTO v_updated;
  IF v_updated IS NULL THEN RETURN FALSE; END IF;
  IF p_state IN ('accepted', 'ambiguous') THEN
    UPDATE public.lifecycle_reminder_daily_claims SET state = p_state, updated_at = NOW() WHERE job_id = p_job_id;
  ELSIF p_state <> 'attempting' THEN
    DELETE FROM public.lifecycle_reminder_daily_claims WHERE job_id = p_job_id;
  END IF;
  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_lifecycle_reminder_jobs(TEXT, INTEGER), public.reserve_lifecycle_reminder_daily_claim(UUID, TEXT, INTEGER, DATE), public.mark_lifecycle_reminder_provider_attempt(UUID, TEXT, INTEGER), public.finish_lifecycle_reminder_job(UUID, TEXT, INTEGER, TEXT, TEXT, JSONB, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_lifecycle_reminder_jobs(TEXT, INTEGER), public.reserve_lifecycle_reminder_daily_claim(UUID, TEXT, INTEGER, DATE), public.mark_lifecycle_reminder_provider_attempt(UUID, TEXT, INTEGER), public.finish_lifecycle_reminder_job(UUID, TEXT, INTEGER, TEXT, TEXT, JSONB, TIMESTAMPTZ) TO service_role;
