-- Razorpay Stage 2 recovery foundation: immutable canonical event claims,
-- bounded lease/backoff recovery, and a once-daily OAuth token-due scan.

ALTER TABLE public.webhook_events
  ADD COLUMN IF NOT EXISTS provider_mode TEXT,
  ADD COLUMN IF NOT EXISTS external_account_id TEXT,
  ADD COLUMN IF NOT EXISTS event_identity_source TEXT,
  ADD COLUMN IF NOT EXISTS payload_sha256 TEXT,
  ADD COLUMN IF NOT EXISTS processing_owner UUID,
  ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ;

ALTER TABLE public.webhook_events
  DROP CONSTRAINT IF EXISTS webhook_events_provider_mode_check;
ALTER TABLE public.webhook_events
  ADD CONSTRAINT webhook_events_provider_mode_check
  CHECK (provider_mode IS NULL OR provider_mode IN ('test', 'live'));

ALTER TABLE public.webhook_events
  DROP CONSTRAINT IF EXISTS webhook_events_identity_source_check;
ALTER TABLE public.webhook_events
  ADD CONSTRAINT webhook_events_identity_source_check
  CHECK (
    event_identity_source IS NULL
    OR event_identity_source IN ('header', 'payload_hash_fallback')
  );

ALTER TABLE public.webhook_events
  DROP CONSTRAINT IF EXISTS webhook_events_payload_sha256_check;
ALTER TABLE public.webhook_events
  ADD CONSTRAINT webhook_events_payload_sha256_check
  CHECK (payload_sha256 IS NULL OR payload_sha256 ~ '^[0-9a-f]{64}$');

-- Historical legacy events predate mode metadata. Backfill only through the
-- already-reviewed account credential binding; never infer mode from payload.
UPDATE public.webhook_events AS event
SET provider_mode = credentials.provider_mode,
    external_account_id = credentials.razorpay_account_id,
    event_identity_source = COALESCE(event.event_identity_source, 'header')
FROM public.account_payment_credentials AS credentials
WHERE event.gateway = 'razorpay'
  AND event.account_id = credentials.account_id
  AND credentials.gateway = 'razorpay'
  AND credentials.provider_mode IS NOT NULL
  AND event.provider_mode IS NULL;

DROP INDEX IF EXISTS webhook_events_recovery_idx;
CREATE INDEX IF NOT EXISTS webhook_events_recovery_idx
  ON public.webhook_events (
    gateway,
    provider_mode,
    processing_status,
    next_attempt_at,
    created_at
  )
  WHERE processed_at IS NULL;

-- New canonical claims preserve the first signed payload permanently. A
-- replay may reacquire only when every identity field agrees and its retry is
-- due (or the prior five-minute processing lease is stale).
CREATE OR REPLACE FUNCTION public.claim_razorpay_canonical_webhook_event(
  p_event_id TEXT,
  p_account_id UUID,
  p_type TEXT,
  p_payload JSONB,
  p_provider_mode TEXT,
  p_external_account_id TEXT,
  p_event_identity_source TEXT,
  p_payload_sha256 TEXT,
  p_processing_owner UUID,
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
  IF p_provider_mode NOT IN ('test', 'live')
     OR p_event_identity_source NOT IN ('header', 'payload_hash_fallback')
     OR p_payload_sha256 !~ '^[0-9a-f]{64}$'
     OR p_processing_owner IS NULL THEN
    RAISE EXCEPTION 'invalid Razorpay canonical webhook identity';
  END IF;

  INSERT INTO public.webhook_events (
    id,
    account_id,
    gateway,
    type,
    payload,
    provider_mode,
    external_account_id,
    event_identity_source,
    payload_sha256,
    processing_status,
    attempt_count,
    last_attempt_at,
    processing_started_at,
    processing_owner,
    next_attempt_at,
    last_error
  )
  VALUES (
    p_event_id,
    p_account_id,
    'razorpay',
    p_type,
    p_payload,
    p_provider_mode,
    p_external_account_id,
    p_event_identity_source,
    p_payload_sha256,
    'processing',
    1,
    v_now,
    v_now,
    p_processing_owner,
    NULL,
    NULL
  )
  ON CONFLICT (id) DO UPDATE
  SET provider_mode = COALESCE(public.webhook_events.provider_mode, EXCLUDED.provider_mode),
      external_account_id = COALESCE(public.webhook_events.external_account_id, EXCLUDED.external_account_id),
      event_identity_source = COALESCE(public.webhook_events.event_identity_source, EXCLUDED.event_identity_source),
      payload_sha256 = COALESCE(public.webhook_events.payload_sha256, EXCLUDED.payload_sha256),
      processing_status = 'processing',
      attempt_count = public.webhook_events.attempt_count + 1,
      last_attempt_at = v_now,
      processing_started_at = v_now,
      processing_owner = p_processing_owner,
      next_attempt_at = NULL,
      last_error = NULL
  WHERE public.webhook_events.account_id IS NOT DISTINCT FROM p_account_id
    AND public.webhook_events.gateway = 'razorpay'
    AND public.webhook_events.type = p_type
    AND public.webhook_events.payload IS NOT DISTINCT FROM p_payload
    AND (
      public.webhook_events.provider_mode IS NULL
      OR public.webhook_events.provider_mode = p_provider_mode
    )
    AND (
      public.webhook_events.external_account_id IS NULL
      OR public.webhook_events.external_account_id = p_external_account_id
    )
    AND (
      public.webhook_events.event_identity_source IS NULL
      OR public.webhook_events.event_identity_source = p_event_identity_source
    )
    AND (
      public.webhook_events.payload_sha256 IS NULL
      OR public.webhook_events.payload_sha256 = p_payload_sha256
    )
    AND public.webhook_events.processed_at IS NULL
    AND (
      (
        public.webhook_events.processing_status IN ('pending', 'failed')
        AND (
          public.webhook_events.next_attempt_at IS NULL
          OR public.webhook_events.next_attempt_at <= v_now
        )
      )
      OR public.webhook_events.processing_started_at IS NULL
      OR public.webhook_events.processing_started_at
        < v_now - make_interval(secs => LEAST(GREATEST(p_lease_seconds, 30), 300))
    )
  RETURNING id INTO v_claimed_id;

  IF v_claimed_id IS NOT NULL THEN
    RETURN 'claimed';
  END IF;

  SELECT * INTO v_existing
  FROM public.webhook_events
  WHERE id = p_event_id;

  IF v_existing.id IS NULL
     OR v_existing.account_id IS DISTINCT FROM p_account_id
     OR v_existing.gateway IS DISTINCT FROM 'razorpay'
     OR v_existing.type IS DISTINCT FROM p_type
     OR v_existing.payload IS DISTINCT FROM p_payload
     OR (v_existing.provider_mode IS NOT NULL AND v_existing.provider_mode IS DISTINCT FROM p_provider_mode)
     OR (v_existing.external_account_id IS NOT NULL AND v_existing.external_account_id IS DISTINCT FROM p_external_account_id)
     OR (v_existing.event_identity_source IS NOT NULL AND v_existing.event_identity_source IS DISTINCT FROM p_event_identity_source)
     OR (v_existing.payload_sha256 IS NOT NULL AND v_existing.payload_sha256 IS DISTINCT FROM p_payload_sha256) THEN
    RETURN 'conflict';
  END IF;
  IF v_existing.processed_at IS NOT NULL
     OR v_existing.processing_status = 'processed' THEN
    RETURN 'processed';
  END IF;
  RETURN 'busy';
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_razorpay_canonical_webhook_event(
  p_event_id TEXT,
  p_account_id UUID,
  p_processing_owner UUID
)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH changed AS (
    UPDATE public.webhook_events
    SET processing_status = 'processed',
        processed_at = clock_timestamp(),
        processing_started_at = NULL,
        processing_owner = NULL,
        next_attempt_at = NULL,
        last_error = NULL
    WHERE id = p_event_id
      AND account_id IS NOT DISTINCT FROM p_account_id
      AND gateway = 'razorpay'
      AND processing_owner = p_processing_owner
      AND processed_at IS NULL
    RETURNING id
  )
  SELECT EXISTS (SELECT 1 FROM changed);
$$;

CREATE OR REPLACE FUNCTION public.fail_razorpay_canonical_webhook_event(
  p_event_id TEXT,
  p_account_id UUID,
  p_processing_owner UUID,
  p_error TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH changed AS (
    UPDATE public.webhook_events
    SET processing_status = 'failed',
        processing_started_at = NULL,
        processing_owner = NULL,
        next_attempt_at = clock_timestamp() + CASE
          WHEN attempt_count <= 1 THEN INTERVAL '1 minute'
          WHEN attempt_count = 2 THEN INTERVAL '5 minutes'
          WHEN attempt_count = 3 THEN INTERVAL '15 minutes'
          WHEN attempt_count = 4 THEN INTERVAL '1 hour'
          ELSE INTERVAL '6 hours'
        END,
        last_error = LEFT(COALESCE(p_error, 'Razorpay webhook processing failed'), 4000)
    WHERE id = p_event_id
      AND account_id IS NOT DISTINCT FROM p_account_id
      AND gateway = 'razorpay'
      AND processing_owner = p_processing_owner
      AND processed_at IS NULL
    RETURNING id
  )
  SELECT EXISTS (SELECT 1 FROM changed);
$$;

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
    LEFT JOIN public.account_payment_credentials AS credentials
      ON credentials.account_id = event.account_id
     AND credentials.gateway = 'razorpay'
    WHERE event.gateway = 'razorpay'
      AND COALESCE(event.provider_mode, credentials.provider_mode) = p_provider_mode
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
    SET provider_mode = COALESCE(event.provider_mode, p_provider_mode),
        processing_status = 'processing',
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

REVOKE ALL ON FUNCTION public.claim_razorpay_canonical_webhook_event(
  TEXT, UUID, TEXT, JSONB, TEXT, TEXT, TEXT, TEXT, UUID, INTEGER
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_razorpay_canonical_webhook_event(
  TEXT, UUID, UUID
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fail_razorpay_canonical_webhook_event(
  TEXT, UUID, UUID, TEXT
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_razorpay_webhook_recovery_batch(
  TEXT, UUID, INTEGER, INTEGER
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.claim_razorpay_canonical_webhook_event(
  TEXT, UUID, TEXT, JSONB, TEXT, TEXT, TEXT, TEXT, UUID, INTEGER
) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_razorpay_canonical_webhook_event(
  TEXT, UUID, UUID
) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_razorpay_canonical_webhook_event(
  TEXT, UUID, UUID, TEXT
) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_razorpay_webhook_recovery_batch(
  TEXT, UUID, INTEGER, INTEGER
) TO service_role;

-- The 15-minute worker leases each ready OAuth connection at most once per
-- day. Token rotation itself continues to use the separate two-minute
-- generation/CAS lease from Stage 1.
ALTER TABLE public.account_payment_credentials
  ADD COLUMN IF NOT EXISTS oauth_refresh_scan_due_at TIMESTAMPTZ
    NOT NULL DEFAULT clock_timestamp(),
  ADD COLUMN IF NOT EXISTS oauth_refresh_scan_lease_owner UUID,
  ADD COLUMN IF NOT EXISTS oauth_refresh_scan_lease_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_oauth_refresh_scan_at TIMESTAMPTZ;

ALTER TABLE public.account_payment_credentials
  DROP CONSTRAINT IF EXISTS account_payment_credentials_refresh_scan_lease_pair_check;
ALTER TABLE public.account_payment_credentials
  ADD CONSTRAINT account_payment_credentials_refresh_scan_lease_pair_check
  CHECK (
    (oauth_refresh_scan_lease_owner IS NULL AND oauth_refresh_scan_lease_until IS NULL)
    OR (oauth_refresh_scan_lease_owner IS NOT NULL AND oauth_refresh_scan_lease_until IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS account_payment_credentials_refresh_scan_due_idx
  ON public.account_payment_credentials (provider_mode, oauth_refresh_scan_due_at)
  WHERE gateway = 'razorpay'
    AND authentication_mode = 'oauth'
    AND connection_status = 'ready';

CREATE OR REPLACE FUNCTION public.claim_razorpay_oauth_refresh_scan_batch(
  p_provider_mode TEXT,
  p_lease_owner UUID,
  p_limit INTEGER DEFAULT 100,
  p_lease_seconds INTEGER DEFAULT 300
)
RETURNS TABLE(account_id UUID, oauth_access_expires_at TIMESTAMPTZ)
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH candidates AS (
    SELECT credentials.account_id
    FROM public.account_payment_credentials AS credentials
    WHERE credentials.gateway = 'razorpay'
      AND credentials.authentication_mode = 'oauth'
      AND credentials.provider_mode = p_provider_mode
      AND credentials.connection_status = 'ready'
      AND credentials.oauth_access_expires_at IS NOT NULL
      AND credentials.oauth_refresh_expires_at IS NOT NULL
      AND credentials.oauth_refresh_scan_due_at <= clock_timestamp()
      AND (
        credentials.oauth_refresh_scan_lease_until IS NULL
        OR credentials.oauth_refresh_scan_lease_until <= clock_timestamp()
      )
    ORDER BY credentials.oauth_refresh_scan_due_at, credentials.account_id
    LIMIT LEAST(GREATEST(p_limit, 1), 100)
    FOR UPDATE OF credentials SKIP LOCKED
  ), claimed AS (
    UPDATE public.account_payment_credentials AS credentials
    SET oauth_refresh_scan_lease_owner = p_lease_owner,
        oauth_refresh_scan_lease_until = clock_timestamp()
          + make_interval(secs => LEAST(GREATEST(p_lease_seconds, 30), 300))
    FROM candidates
    WHERE credentials.account_id = candidates.account_id
    RETURNING credentials.account_id, credentials.oauth_access_expires_at
  )
  SELECT claimed.account_id, claimed.oauth_access_expires_at
  FROM claimed
  ORDER BY claimed.account_id;
$$;

CREATE OR REPLACE FUNCTION public.finish_razorpay_oauth_refresh_scan(
  p_account_id UUID,
  p_lease_owner UUID,
  p_error TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH changed AS (
    UPDATE public.account_payment_credentials
    SET oauth_refresh_scan_due_at = clock_timestamp() + CASE
          WHEN p_error IS NULL THEN INTERVAL '1 day'
          ELSE INTERVAL '6 hours'
        END,
        oauth_refresh_scan_lease_owner = NULL,
        oauth_refresh_scan_lease_until = NULL,
        last_oauth_refresh_scan_at = clock_timestamp(),
        last_error = CASE
          WHEN p_error IS NULL THEN last_error
          ELSE LEFT(p_error, 2000)
        END
    WHERE account_id = p_account_id
      AND gateway = 'razorpay'
      AND oauth_refresh_scan_lease_owner = p_lease_owner
    RETURNING account_id
  )
  SELECT EXISTS (SELECT 1 FROM changed);
$$;

REVOKE ALL ON FUNCTION public.claim_razorpay_oauth_refresh_scan_batch(
  TEXT, UUID, INTEGER, INTEGER
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_razorpay_oauth_refresh_scan(
  UUID, UUID, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_razorpay_oauth_refresh_scan_batch(
  TEXT, UUID, INTEGER, INTEGER
) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_razorpay_oauth_refresh_scan(
  UUID, UUID, TEXT
) TO service_role;
