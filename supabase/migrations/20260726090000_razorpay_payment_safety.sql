-- Razorpay payment safety: server-only credentials, retryable webhook claims,
-- and service-only visibility for charged events missing ledger entries.

-- Browser sessions must never read or write raw gateway credentials. All
-- access now passes through authenticated Next.js routes and the service role.
DROP POLICY IF EXISTS account_payment_credentials_all
  ON public.account_payment_credentials;
REVOKE ALL ON public.account_payment_credentials FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.account_payment_credentials TO service_role;

-- Preserve a stable raw payload while recording processing state separately.
ALTER TABLE public.webhook_events
  ADD COLUMN IF NOT EXISTS processing_status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS processing_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_error TEXT;

UPDATE public.webhook_events
SET processing_status = CASE
      WHEN processed_at IS NOT NULL THEN 'processed'
      WHEN payload ? '_error' THEN 'failed'
      ELSE 'pending'
    END,
    last_error = COALESCE(last_error, payload ->> '_error')
WHERE processing_status = 'pending'
   OR last_error IS NULL;

ALTER TABLE public.webhook_events
  DROP CONSTRAINT IF EXISTS webhook_events_processing_status_check;
ALTER TABLE public.webhook_events
  ADD CONSTRAINT webhook_events_processing_status_check
  CHECK (processing_status IN ('pending', 'processing', 'processed', 'failed'));

CREATE INDEX IF NOT EXISTS webhook_events_recovery_idx
  ON public.webhook_events (gateway, account_id, processing_status, created_at)
  WHERE processed_at IS NULL;

-- Atomically claim a new event or retry a failed/stale attempt. A successfully
-- processed event remains a no-op forever. The short processing lease prevents
-- concurrent webhook deliveries from double-running the handler while allowing
-- recovery if a function dies after claiming.
CREATE OR REPLACE FUNCTION public.claim_razorpay_webhook_event(
  p_event_id TEXT,
  p_account_id UUID,
  p_type TEXT,
  p_payload JSONB,
  p_lease_seconds INTEGER DEFAULT 300
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_claimed_id TEXT;
  v_existing public.webhook_events%ROWTYPE;
  v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  INSERT INTO public.webhook_events (
    id,
    account_id,
    gateway,
    type,
    payload,
    processing_status,
    attempt_count,
    last_attempt_at,
    processing_started_at,
    last_error
  )
  VALUES (
    p_event_id,
    p_account_id,
    'razorpay',
    p_type,
    p_payload,
    'processing',
    1,
    v_now,
    v_now,
    NULL
  )
  ON CONFLICT (id) DO UPDATE
  SET type = EXCLUDED.type,
      payload = EXCLUDED.payload,
      processing_status = 'processing',
      attempt_count = public.webhook_events.attempt_count + 1,
      last_attempt_at = v_now,
      processing_started_at = v_now,
      last_error = NULL
  WHERE public.webhook_events.account_id = p_account_id
    AND public.webhook_events.gateway = 'razorpay'
    AND public.webhook_events.processed_at IS NULL
    AND (
      public.webhook_events.processing_status IN ('pending', 'failed')
      OR public.webhook_events.processing_started_at IS NULL
      OR public.webhook_events.processing_started_at
        < v_now - make_interval(secs => GREATEST(p_lease_seconds, 30))
    )
  RETURNING id INTO v_claimed_id;

  IF v_claimed_id IS NOT NULL THEN
    RETURN 'claimed';
  END IF;

  SELECT *
  INTO v_existing
  FROM public.webhook_events
  WHERE id = p_event_id;

  IF v_existing.id IS NULL
     OR v_existing.account_id IS DISTINCT FROM p_account_id
     OR v_existing.gateway IS DISTINCT FROM 'razorpay' THEN
    RETURN 'conflict';
  END IF;
  IF v_existing.processed_at IS NOT NULL
     OR v_existing.processing_status = 'processed' THEN
    RETURN 'processed';
  END IF;
  RETURN 'busy';
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_razorpay_webhook_event(
  p_event_id TEXT,
  p_account_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  UPDATE public.webhook_events
  SET processing_status = 'processed',
      processed_at = clock_timestamp(),
      processing_started_at = NULL,
      last_error = NULL
  WHERE id = p_event_id
    AND account_id = p_account_id
    AND gateway = 'razorpay'
    AND processed_at IS NULL
  RETURNING TRUE;
$$;

CREATE OR REPLACE FUNCTION public.fail_razorpay_webhook_event(
  p_event_id TEXT,
  p_account_id UUID,
  p_error TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  UPDATE public.webhook_events
  SET processing_status = 'failed',
      processing_started_at = NULL,
      last_error = LEFT(p_error, 4000)
  WHERE id = p_event_id
    AND account_id = p_account_id
    AND gateway = 'razorpay'
    AND processed_at IS NULL
  RETURNING TRUE;
$$;

REVOKE ALL ON FUNCTION public.claim_razorpay_webhook_event(
  TEXT, UUID, TEXT, JSONB, INTEGER
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_razorpay_webhook_event(
  TEXT, UUID
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fail_razorpay_webhook_event(
  TEXT, UUID, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_razorpay_webhook_event(
  TEXT, UUID, TEXT, JSONB, INTEGER
) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_razorpay_webhook_event(
  TEXT, UUID
) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_razorpay_webhook_event(
  TEXT, UUID, TEXT
) TO service_role;

-- Read-only reconciliation surface. It never changes or replays financial
-- data; the authenticated server route reads it with the service role and
-- returns only account-scoped diagnostics.
CREATE OR REPLACE VIEW public.razorpay_missing_payment_ledger
WITH (security_invoker = true)
AS
SELECT
  we.id AS event_id,
  we.account_id,
  we.payload #>> '{payload,payment,entity,id}' AS gateway_payment_id,
  we.payload #>> '{payload,subscription,entity,notes,membership_id}'
    AS membership_id,
  we.processing_status,
  we.attempt_count,
  we.last_error,
  we.created_at,
  we.last_attempt_at,
  we.processed_at
FROM public.webhook_events we
LEFT JOIN public.payments p
  ON p.account_id = we.account_id
 AND p.gateway_payment_id =
   we.payload #>> '{payload,payment,entity,id}'
WHERE we.gateway = 'razorpay'
  AND we.type = 'subscription.charged'
  AND we.payload #>> '{payload,payment,entity,id}' IS NOT NULL
  AND p.id IS NULL;

REVOKE ALL ON public.razorpay_missing_payment_ledger FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.razorpay_missing_payment_ledger TO service_role;

COMMENT ON VIEW public.razorpay_missing_payment_ledger IS
  'Service-only diagnostics for Razorpay charged webhook events with no matching payments.gateway_payment_id. Read-only; never replays or reconciles.';
