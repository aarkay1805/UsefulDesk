-- Razorpay Stage 2 Test-only provider retry acceptance. An authenticated
-- operator may arm one exact subscription cancellation for ten minutes. The
-- first matching signed application delivery is recorded and deliberately
-- rejected before canonical persistence; only an identical Razorpay retry may
-- continue to the existing claim/handler path.

CREATE TABLE IF NOT EXISTS public.razorpay_webhook_retry_acceptances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  provider_mode TEXT NOT NULL,
  expected_event_type TEXT NOT NULL,
  expected_subscription_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'armed',
  armed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  armed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  expires_at TIMESTAMPTZ NOT NULL,
  provider_event_id TEXT,
  first_event_identity_source TEXT,
  first_payload_sha256 TEXT,
  first_signature_generation TEXT,
  first_received_at TIMESTAMPTZ,
  first_response_status INTEGER,
  retry_provider_event_id TEXT,
  retry_payload_sha256 TEXT,
  retry_signature_generation TEXT,
  retry_received_at TIMESTAMPTZ,
  retry_response_status INTEGER,
  delivery_count INTEGER NOT NULL DEFAULT 0,
  canonical_claim_result TEXT,
  canonical_acknowledged_at TIMESTAMPTZ,
  canonical_attempt_count INTEGER,
  canonical_processed_at TIMESTAMPTZ,
  cancelled_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  cancelled_at TIMESTAMPTZ,
  CONSTRAINT razorpay_webhook_retry_acceptances_mode_check
    CHECK (provider_mode = 'test'),
  CONSTRAINT razorpay_webhook_retry_acceptances_event_check
    CHECK (expected_event_type = 'subscription.cancelled'),
  CONSTRAINT razorpay_webhook_retry_acceptances_subscription_check
    CHECK (expected_subscription_id ~ '^sub_[A-Za-z0-9]+$'),
  CONSTRAINT razorpay_webhook_retry_acceptances_status_check
    CHECK (status IN (
      'armed', 'retry_requested', 'retry_received', 'acknowledged',
      'completed', 'cancelled', 'expired'
    )),
  CONSTRAINT razorpay_webhook_retry_acceptances_expiry_check
    CHECK (
      expires_at > armed_at
      AND expires_at <= armed_at + INTERVAL '15 minutes'
    ),
  CONSTRAINT razorpay_webhook_retry_acceptances_identity_source_check
    CHECK (
      first_event_identity_source IS NULL
      OR first_event_identity_source = 'header'
    ),
  CONSTRAINT razorpay_webhook_retry_acceptances_first_hash_check
    CHECK (
      first_payload_sha256 IS NULL
      OR first_payload_sha256 ~ '^[0-9a-f]{64}$'
    ),
  CONSTRAINT razorpay_webhook_retry_acceptances_retry_hash_check
    CHECK (
      retry_payload_sha256 IS NULL
      OR retry_payload_sha256 ~ '^[0-9a-f]{64}$'
    ),
  CONSTRAINT razorpay_webhook_retry_acceptances_matching_retry_check
    CHECK (
      retry_provider_event_id IS NULL
      OR (
        retry_provider_event_id = provider_event_id
        AND retry_payload_sha256 = first_payload_sha256
      )
    ),
  CONSTRAINT razorpay_webhook_retry_acceptances_delivery_count_check
    CHECK (delivery_count >= 0),
  CONSTRAINT razorpay_webhook_retry_acceptances_response_status_check
    CHECK (
      (first_response_status IS NULL OR first_response_status = 503)
      AND (retry_response_status IS NULL OR retry_response_status = 200)
    ),
  CONSTRAINT razorpay_webhook_retry_acceptances_claim_result_check
    CHECK (
      canonical_claim_result IS NULL
      OR canonical_claim_result IN ('claimed', 'processed', 'busy')
    )
);

ALTER TABLE public.razorpay_webhook_retry_acceptances ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.razorpay_webhook_retry_acceptances
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON public.razorpay_webhook_retry_acceptances
  TO service_role;

CREATE UNIQUE INDEX IF NOT EXISTS razorpay_webhook_retry_acceptances_one_open_idx
  ON public.razorpay_webhook_retry_acceptances (account_id)
  WHERE status IN (
    'armed', 'retry_requested', 'retry_received', 'acknowledged'
  );
CREATE UNIQUE INDEX IF NOT EXISTS razorpay_webhook_retry_acceptances_event_idx
  ON public.razorpay_webhook_retry_acceptances (provider_mode, provider_event_id)
  WHERE provider_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS razorpay_webhook_retry_acceptances_account_at_idx
  ON public.razorpay_webhook_retry_acceptances (account_id, armed_at DESC);
CREATE INDEX IF NOT EXISTS razorpay_webhook_retry_acceptances_armed_by_idx
  ON public.razorpay_webhook_retry_acceptances (armed_by)
  WHERE armed_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS razorpay_webhook_retry_acceptances_cancelled_by_idx
  ON public.razorpay_webhook_retry_acceptances (cancelled_by)
  WHERE cancelled_by IS NOT NULL;

CREATE OR REPLACE FUNCTION public.arm_razorpay_webhook_retry_acceptance(
  p_account_id UUID,
  p_provider_mode TEXT,
  p_expected_event_type TEXT,
  p_expected_subscription_id TEXT,
  p_armed_by UUID,
  p_ttl_seconds INTEGER DEFAULT 600
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_credentials public.account_payment_credentials%ROWTYPE;
  v_mandate public.payment_mandates%ROWTYPE;
  v_acceptance_id UUID;
  v_expires_at TIMESTAMPTZ;
BEGIN
  IF p_provider_mode IS DISTINCT FROM 'test'
     OR p_expected_event_type IS DISTINCT FROM 'subscription.cancelled'
     OR p_expected_subscription_id !~ '^sub_[A-Za-z0-9]+$'
     OR p_armed_by IS NULL
     OR p_ttl_seconds < 60
     OR p_ttl_seconds > 900 THEN
    RAISE EXCEPTION 'invalid Razorpay Test retry acceptance request';
  END IF;

  SELECT * INTO v_credentials
  FROM public.account_payment_credentials
  WHERE account_id = p_account_id
    AND gateway = 'razorpay'
  FOR UPDATE;

  IF v_credentials.account_id IS NULL
     OR v_credentials.authentication_mode <> 'oauth'
     OR v_credentials.provider_mode <> 'test'
     OR v_credentials.connection_status <> 'ready'
     OR v_credentials.razorpay_account_id IS NULL
     OR v_credentials.oauth_access_token IS NULL
     OR v_credentials.oauth_refresh_token IS NULL
     OR v_credentials.oauth_refresh_expires_at <= clock_timestamp()
     OR v_credentials.canonical_webhook_ingress <> 'application'
     OR v_credentials.oauth_refresh_scan_lease_owner IS NOT NULL
     OR v_credentials.oauth_refresh_scan_lease_until IS NOT NULL
     OR v_credentials.refresh_lease_owner IS NOT NULL
     OR v_credentials.refresh_lease_until IS NOT NULL THEN
    RAISE EXCEPTION 'Razorpay connection is not eligible for retry acceptance';
  END IF;

  SELECT * INTO v_mandate
  FROM public.payment_mandates
  WHERE account_id = p_account_id
    AND gateway = 'razorpay'
    AND gateway_subscription_id = p_expected_subscription_id
  FOR UPDATE;

  IF v_mandate.id IS NULL OR v_mandate.status NOT IN ('pending', 'active') THEN
    RAISE EXCEPTION 'retry acceptance requires a fresh local Test mandate';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.webhook_events AS event
    WHERE event.gateway = 'razorpay'
      AND event.account_id = p_account_id
      AND event.type = p_expected_event_type
      AND event.payload #>> '{payload,subscription,entity,id}'
        = p_expected_subscription_id
  ) THEN
    RAISE EXCEPTION 'the target provider event already exists';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.webhook_events AS event
    WHERE event.gateway = 'razorpay'
      AND event.account_id = p_account_id
      AND event.processed_at IS NULL
  ) OR EXISTS (
    SELECT 1
    FROM public.gateway_charge_exceptions AS exception
    WHERE exception.account_id = p_account_id
      AND exception.resolved_at IS NULL
  ) THEN
    RAISE EXCEPTION 'unresolved Razorpay work blocks retry acceptance';
  END IF;

  UPDATE public.razorpay_webhook_retry_acceptances
  SET status = 'expired'
  WHERE account_id = p_account_id
    AND status IN ('armed', 'retry_requested', 'retry_received', 'acknowledged')
    AND expires_at <= clock_timestamp();

  IF EXISTS (
    SELECT 1
    FROM public.razorpay_webhook_retry_acceptances
    WHERE account_id = p_account_id
      AND status IN ('armed', 'retry_requested', 'retry_received', 'acknowledged')
  ) THEN
    RAISE EXCEPTION 'a retry acceptance exercise is already open';
  END IF;

  v_expires_at := clock_timestamp() + make_interval(secs => p_ttl_seconds);
  INSERT INTO public.razorpay_webhook_retry_acceptances (
    account_id,
    provider_mode,
    expected_event_type,
    expected_subscription_id,
    armed_by,
    expires_at
  ) VALUES (
    p_account_id,
    'test',
    p_expected_event_type,
    p_expected_subscription_id,
    p_armed_by,
    v_expires_at
  )
  RETURNING id INTO v_acceptance_id;

  RETURN jsonb_build_object(
    'acceptance_id', v_acceptance_id,
    'event_type', p_expected_event_type,
    'subscription_id', p_expected_subscription_id,
    'expires_at', v_expires_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.consume_razorpay_webhook_retry_acceptance(
  p_account_id UUID,
  p_provider_mode TEXT,
  p_event_type TEXT,
  p_subscription_id TEXT,
  p_provider_event_id TEXT,
  p_event_identity_source TEXT,
  p_payload_sha256 TEXT,
  p_signature_generation TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_acceptance public.razorpay_webhook_retry_acceptances%ROWTYPE;
  v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  IF p_provider_mode IS DISTINCT FROM 'test' THEN
    RETURN jsonb_build_object('action', 'pass');
  END IF;

  SELECT * INTO v_acceptance
  FROM public.razorpay_webhook_retry_acceptances
  WHERE account_id = p_account_id
    AND provider_mode = 'test'
    AND expected_event_type = p_event_type
    AND expected_subscription_id = p_subscription_id
    AND status IN ('armed', 'retry_requested', 'retry_received', 'acknowledged')
  FOR UPDATE;

  IF v_acceptance.id IS NULL THEN
    RETURN jsonb_build_object('action', 'pass');
  END IF;
  IF v_acceptance.expires_at <= v_now THEN
    UPDATE public.razorpay_webhook_retry_acceptances
    SET status = 'expired'
    WHERE id = v_acceptance.id;
    RETURN jsonb_build_object('action', 'pass');
  END IF;
  IF p_event_identity_source IS DISTINCT FROM 'header'
     OR p_provider_event_id IS NULL
     OR btrim(p_provider_event_id) = ''
     OR length(p_provider_event_id) > 200
     OR p_payload_sha256 !~ '^[0-9a-f]{64}$'
     OR p_signature_generation NOT IN ('current', 'previous') THEN
    RETURN jsonb_build_object(
      'action', 'conflict',
      'acceptance_id', v_acceptance.id
    );
  END IF;

  IF v_acceptance.status = 'armed' THEN
    UPDATE public.razorpay_webhook_retry_acceptances
    SET status = 'retry_requested',
        provider_event_id = p_provider_event_id,
        first_event_identity_source = p_event_identity_source,
        first_payload_sha256 = p_payload_sha256,
        first_signature_generation = p_signature_generation,
        first_received_at = v_now,
        first_response_status = 503,
        delivery_count = 1
    WHERE id = v_acceptance.id;
    RETURN jsonb_build_object(
      'action', 'retry',
      'acceptance_id', v_acceptance.id
    );
  END IF;

  IF v_acceptance.provider_event_id IS DISTINCT FROM p_provider_event_id
     OR v_acceptance.first_payload_sha256 IS DISTINCT FROM p_payload_sha256 THEN
    RETURN jsonb_build_object(
      'action', 'conflict',
      'acceptance_id', v_acceptance.id
    );
  END IF;

  UPDATE public.razorpay_webhook_retry_acceptances
  SET status = CASE
        WHEN status = 'retry_requested' THEN 'retry_received'
        ELSE status
      END,
      retry_provider_event_id = COALESCE(retry_provider_event_id, p_provider_event_id),
      retry_payload_sha256 = COALESCE(retry_payload_sha256, p_payload_sha256),
      retry_signature_generation = COALESCE(retry_signature_generation, p_signature_generation),
      retry_received_at = COALESCE(retry_received_at, v_now),
      delivery_count = delivery_count + 1
  WHERE id = v_acceptance.id;

  RETURN jsonb_build_object(
    'action', 'redelivery',
    'acceptance_id', v_acceptance.id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.acknowledge_razorpay_webhook_retry_acceptance(
  p_acceptance_id UUID,
  p_account_id UUID,
  p_provider_event_id TEXT,
  p_payload_sha256 TEXT,
  p_claim_result TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH changed AS (
    UPDATE public.razorpay_webhook_retry_acceptances
    SET status = CASE WHEN status = 'completed' THEN status ELSE 'acknowledged' END,
        retry_response_status = 200,
        canonical_claim_result = COALESCE(canonical_claim_result, p_claim_result),
        canonical_acknowledged_at = COALESCE(canonical_acknowledged_at, clock_timestamp())
    WHERE id = p_acceptance_id
      AND account_id = p_account_id
      AND provider_mode = 'test'
      AND provider_event_id = p_provider_event_id
      AND retry_provider_event_id = p_provider_event_id
      AND first_payload_sha256 = p_payload_sha256
      AND retry_payload_sha256 = p_payload_sha256
      AND p_claim_result IN ('claimed', 'processed', 'busy')
      AND status IN ('retry_received', 'acknowledged', 'completed')
    RETURNING id
  )
  SELECT EXISTS (SELECT 1 FROM changed);
$$;

CREATE OR REPLACE FUNCTION public.cancel_razorpay_webhook_retry_acceptance(
  p_acceptance_id UUID,
  p_account_id UUID,
  p_cancelled_by UUID
)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH changed AS (
    UPDATE public.razorpay_webhook_retry_acceptances
    SET status = 'cancelled',
        cancelled_by = p_cancelled_by,
        cancelled_at = clock_timestamp()
    WHERE id = p_acceptance_id
      AND account_id = p_account_id
      AND provider_mode = 'test'
      AND p_cancelled_by IS NOT NULL
      AND status IN ('armed', 'retry_requested', 'retry_received', 'acknowledged')
    RETURNING id
  )
  SELECT EXISTS (SELECT 1 FROM changed);
$$;

CREATE OR REPLACE FUNCTION public.complete_razorpay_webhook_retry_acceptance()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF NEW.gateway = 'razorpay'
     AND NEW.provider_mode = 'test'
     AND NEW.processing_status = 'processed'
     AND NEW.processed_at IS NOT NULL
     AND (OLD.processed_at IS NULL OR OLD.processing_status <> 'processed') THEN
    UPDATE public.razorpay_webhook_retry_acceptances
    SET status = 'completed',
        canonical_attempt_count = NEW.attempt_count,
        canonical_processed_at = NEW.processed_at
    WHERE account_id IS NOT DISTINCT FROM NEW.account_id
      AND provider_mode = 'test'
      AND provider_event_id = NEW.id
      AND retry_provider_event_id = NEW.id
      AND first_payload_sha256 = NEW.payload_sha256
      AND retry_payload_sha256 = NEW.payload_sha256
      AND status IN ('retry_received', 'acknowledged');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS complete_razorpay_retry_acceptance
  ON public.webhook_events;
CREATE TRIGGER complete_razorpay_retry_acceptance
  AFTER UPDATE OF processed_at, processing_status ON public.webhook_events
  FOR EACH ROW
  EXECUTE FUNCTION public.complete_razorpay_webhook_retry_acceptance();

REVOKE ALL ON FUNCTION public.arm_razorpay_webhook_retry_acceptance(
  UUID, TEXT, TEXT, TEXT, UUID, INTEGER
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.consume_razorpay_webhook_retry_acceptance(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.acknowledge_razorpay_webhook_retry_acceptance(
  UUID, UUID, TEXT, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cancel_razorpay_webhook_retry_acceptance(
  UUID, UUID, UUID
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_razorpay_webhook_retry_acceptance()
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.arm_razorpay_webhook_retry_acceptance(
  UUID, TEXT, TEXT, TEXT, UUID, INTEGER
) TO service_role;
GRANT EXECUTE ON FUNCTION public.consume_razorpay_webhook_retry_acceptance(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) TO service_role;
GRANT EXECUTE ON FUNCTION public.acknowledge_razorpay_webhook_retry_acceptance(
  UUID, UUID, TEXT, TEXT, TEXT
) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_razorpay_webhook_retry_acceptance(
  UUID, UUID, UUID
) TO service_role;

COMMENT ON TABLE public.razorpay_webhook_retry_acceptances IS
  'Service-only, Test-only audit and one-shot control for genuine Razorpay provider retry acceptance.';
