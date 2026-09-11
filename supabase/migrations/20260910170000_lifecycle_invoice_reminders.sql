-- Durable, opt-in invoice collection lifecycle. This is deliberately additive:
-- no existing reminder schedule changes and no historical invoice is eligible
-- until an admin explicitly enables the feature for its branch.

ALTER TABLE public.renewal_reminder_settings
  ADD COLUMN IF NOT EXISTS invoice_collection_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS invoice_collection_activated_on DATE,
  ADD COLUMN IF NOT EXISTS invoice_collection_generation UUID NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS invoice_collection_before_due_days INTEGER[] NOT NULL DEFAULT '{3,1,0}',
  ADD COLUMN IF NOT EXISTS invoice_collection_overdue_days INTEGER[] NOT NULL DEFAULT '{1,3,7,14}',
  ADD COLUMN IF NOT EXISTS invoice_collection_catch_up_days INTEGER NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS invoice_collection_send_window_start SMALLINT NOT NULL DEFAULT 9,
  ADD COLUMN IF NOT EXISTS invoice_collection_send_window_end SMALLINT NOT NULL DEFAULT 19;

ALTER TABLE public.renewal_reminder_settings
  DROP CONSTRAINT IF EXISTS renewal_reminder_invoice_collection_window_check;
ALTER TABLE public.renewal_reminder_settings
  ADD CONSTRAINT renewal_reminder_invoice_collection_window_check CHECK (
    invoice_collection_catch_up_days BETWEEN 0 AND 14
    AND invoice_collection_send_window_start BETWEEN 0 AND 23
    AND invoice_collection_send_window_end BETWEEN invoice_collection_send_window_start AND 23
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
  IF NEW.invoice_collection_enabled
     AND NOT COALESCE(OLD.invoice_collection_enabled, FALSE) THEN
    SELECT timezone INTO v_timezone FROM public.accounts WHERE id = NEW.account_id;
    NEW.invoice_collection_activated_on := (NOW() AT TIME ZONE COALESCE(v_timezone, 'UTC'))::DATE;
    NEW.invoice_collection_generation := gen_random_uuid();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_invoice_collection_activation
  ON public.renewal_reminder_settings;
CREATE TRIGGER trg_invoice_collection_activation
  BEFORE INSERT OR UPDATE OF invoice_collection_enabled
  ON public.renewal_reminder_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_invoice_collection_activation();

CREATE TABLE IF NOT EXISTS public.lifecycle_reminder_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  invoice_id UUID REFERENCES public.invoices(id) ON DELETE SET NULL,
  installment_plan_id UUID REFERENCES public.membership_installment_plans(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('invoice_due', 'invoice_overdue', 'installment_overdue', 'payment_confirmation')),
  subject_cycle_id TEXT NOT NULL,
  milestone_key TEXT NOT NULL,
  business_key TEXT NOT NULL,
  effective_due_on DATE NOT NULL,
  coordination_on DATE NOT NULL,
  activation_generation UUID NOT NULL,
  state TEXT NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'leased', 'attempting', 'accepted', 'delivered', 'failed', 'blocked', 'deferred', 'skipped', 'ambiguous')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 3),
  lease_owner TEXT,
  lease_generation INTEGER NOT NULL DEFAULT 0,
  lease_expires_at TIMESTAMPTZ,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  provider_message_id TEXT,
  reason JSONB,
  accepted_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, business_key)
);

CREATE INDEX IF NOT EXISTS lifecycle_reminder_jobs_claim_idx
  ON public.lifecycle_reminder_jobs(state, next_attempt_at, lease_expires_at);
CREATE INDEX IF NOT EXISTS lifecycle_reminder_jobs_history_idx
  ON public.lifecycle_reminder_jobs(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS lifecycle_reminder_jobs_daily_contact_idx
  ON public.lifecycle_reminder_jobs(account_id, contact_id, accepted_at DESC);

ALTER TABLE public.lifecycle_reminder_jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lifecycle_reminder_jobs_select ON public.lifecycle_reminder_jobs;
CREATE POLICY lifecycle_reminder_jobs_select
  ON public.lifecycle_reminder_jobs FOR SELECT TO authenticated
  USING (public.is_account_member(account_id));

DROP TRIGGER IF EXISTS trg_lifecycle_reminder_jobs_updated_at
  ON public.lifecycle_reminder_jobs;
CREATE TRIGGER trg_lifecycle_reminder_jobs_updated_at
  BEFORE UPDATE ON public.lifecycle_reminder_jobs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

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
  IF current_user <> 'service_role' OR COALESCE(NULLIF(p_worker_id, ''), '') = '' THEN
    RAISE EXCEPTION 'service role required';
  END IF;

  RETURN QUERY
  WITH claimable AS (
    SELECT job.id
    FROM public.lifecycle_reminder_jobs AS job
    WHERE job.attempt_count < 3
      AND (
        (job.state IN ('queued', 'deferred', 'failed') AND job.next_attempt_at <= NOW())
        OR (job.state = 'leased' AND job.lease_expires_at < NOW())
      )
    ORDER BY job.next_attempt_at, job.created_at
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 200)
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.lifecycle_reminder_jobs AS job
  SET state = 'leased',
      lease_owner = p_worker_id,
      lease_generation = job.lease_generation + 1,
      lease_expires_at = NOW() + INTERVAL '10 minutes',
      attempt_count = job.attempt_count + 1
  FROM claimable
  WHERE job.id = claimable.id
  RETURNING job.*;
END;
$$;

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
DECLARE
  v_updated UUID;
BEGIN
  IF current_user <> 'service_role' OR p_state NOT IN ('attempting', 'accepted', 'blocked', 'deferred', 'failed', 'skipped', 'ambiguous', 'queued') THEN
    RAISE EXCEPTION 'service role required';
  END IF;

  UPDATE public.lifecycle_reminder_jobs
  SET state = p_state,
      provider_message_id = COALESCE(p_provider_message_id, provider_message_id),
      reason = p_reason,
      next_attempt_at = COALESCE(p_next_attempt_at, next_attempt_at),
      accepted_at = CASE WHEN p_state = 'accepted' THEN NOW() ELSE accepted_at END,
      lease_owner = CASE WHEN p_state = 'attempting' THEN lease_owner ELSE NULL END,
      lease_expires_at = CASE WHEN p_state = 'attempting' THEN NOW() + INTERVAL '30 minutes' ELSE NULL END
  WHERE id = p_job_id
    AND lease_owner = p_worker_id
    AND lease_generation = p_lease_generation
    AND state IN ('leased', 'attempting')
  RETURNING id INTO v_updated;

  RETURN v_updated IS NOT NULL;
END;
$$;

REVOKE ALL ON TABLE public.lifecycle_reminder_jobs FROM anon, authenticated;
GRANT SELECT ON TABLE public.lifecycle_reminder_jobs TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.lifecycle_reminder_jobs TO service_role;
REVOKE ALL ON FUNCTION public.claim_lifecycle_reminder_jobs(TEXT, INTEGER)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_lifecycle_reminder_job(UUID, TEXT, INTEGER, TEXT, TEXT, JSONB, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_lifecycle_reminder_jobs(TEXT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_lifecycle_reminder_job(UUID, TEXT, INTEGER, TEXT, TEXT, JSONB, TIMESTAMPTZ) TO service_role;

COMMENT ON TABLE public.lifecycle_reminder_jobs IS
  'Durable no-backfill lifecycle reminder queue. An attempting row is ambiguous after a worker crash and is never auto-resubmitted.';
