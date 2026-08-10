-- Keep recovery claims fail-closed on the event's immutable provider mode and
-- merchant identity. Identity-less pre-OAuth rows are legacy evidence; neither
-- the account's current credential mode nor a merchant-id prefix may relabel
-- them as Test or Live.

CREATE OR REPLACE FUNCTION public.claim_razorpay_webhook_recovery_batch(
  p_provider_mode TEXT,
  p_processing_owner UUID,
  p_limit INTEGER DEFAULT 100,
  p_lease_seconds INTEGER DEFAULT 300
)
RETURNS TABLE(
  event_id TEXT,
  account_id UUID,
  event_type TEXT,
  payload JSONB,
  external_account_id TEXT,
  event_identity_source TEXT,
  payload_sha256 TEXT,
  attempt_count INTEGER,
  created_at TIMESTAMPTZ
)
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH candidates AS (
    SELECT event.id
    FROM public.webhook_events AS event
    WHERE event.gateway = 'razorpay'
      AND event.provider_mode = p_provider_mode
      AND event.external_account_id IS NOT NULL
      AND event.event_identity_source IS NOT NULL
      AND event.payload_sha256 IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.account_payment_credentials AS credentials
        WHERE credentials.account_id = event.account_id
          AND credentials.gateway = 'razorpay'
          AND credentials.provider_mode = event.provider_mode
          AND credentials.razorpay_account_id = event.external_account_id
      )
      AND event.processed_at IS NULL
      AND (
        (
          event.processing_status IN ('pending', 'failed')
          AND (event.next_attempt_at IS NULL OR event.next_attempt_at <= clock_timestamp())
        )
        OR event.processing_started_at IS NULL
        OR event.processing_started_at
          < clock_timestamp() - make_interval(secs => LEAST(GREATEST(p_lease_seconds, 30), 300))
      )
    ORDER BY event.created_at, event.id
    LIMIT LEAST(GREATEST(p_limit, 1), 100)
    FOR UPDATE OF event SKIP LOCKED
  ), claimed AS (
    UPDATE public.webhook_events AS event
    SET processing_status = 'processing',
        attempt_count = event.attempt_count + 1,
        last_attempt_at = clock_timestamp(),
        processing_started_at = clock_timestamp(),
        processing_owner = p_processing_owner,
        next_attempt_at = NULL,
        last_error = NULL
    FROM candidates
    WHERE event.id = candidates.id
    RETURNING event.*
  )
  SELECT
    claimed.id,
    claimed.account_id,
    claimed.type,
    claimed.payload,
    claimed.external_account_id,
    claimed.event_identity_source,
    claimed.payload_sha256,
    claimed.attempt_count,
    claimed.created_at
  FROM claimed
  ORDER BY claimed.created_at, claimed.id;
$$;

REVOKE ALL ON FUNCTION public.claim_razorpay_webhook_recovery_batch(
  TEXT, UUID, INTEGER, INTEGER
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_razorpay_webhook_recovery_batch(
  TEXT, UUID, INTEGER, INTEGER
) TO service_role;

-- One Live recovery pass ran before this stricter contract was installed and
-- filled provider_mode from the account's current credential on four known
-- pre-OAuth rows. Restore their unknown-mode fact without deleting or marking
-- the immutable legacy events as processed.
UPDATE public.webhook_events
SET provider_mode = NULL
WHERE id IN (
  'TCt7UUYDn05NlZ',
  'TDFwepp30TMPfc',
  'TDFweqCmNNCByJ',
  'TDFweqJIKJY9kM'
)
  AND gateway = 'razorpay'
  AND provider_mode = 'live'
  AND external_account_id IS NULL
  AND event_identity_source IS NULL
  AND payload_sha256 IS NULL;
