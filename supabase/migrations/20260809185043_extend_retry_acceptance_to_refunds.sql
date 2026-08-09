-- Extend the existing Razorpay Test-only provider retry proof to the exact
-- `refund.processed` event for a freshly reserved UsefulDesk refund. The
-- signed refund's immutable `notes.usefuldesk_refund_id` identifies the one
-- armed local intent before a gateway refund id exists.

ALTER TABLE public.razorpay_webhook_retry_acceptances
  ALTER COLUMN expected_subscription_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS expected_refund_id UUID
    REFERENCES public.payment_refunds(id) ON DELETE RESTRICT;

ALTER TABLE public.razorpay_webhook_retry_acceptances
  DROP CONSTRAINT IF EXISTS razorpay_webhook_retry_acceptances_event_check,
  DROP CONSTRAINT IF EXISTS razorpay_webhook_retry_acceptances_subscription_check;

ALTER TABLE public.razorpay_webhook_retry_acceptances
  ADD CONSTRAINT razorpay_webhook_retry_acceptances_event_check
    CHECK (expected_event_type IN ('subscription.cancelled', 'refund.processed')),
  ADD CONSTRAINT razorpay_webhook_retry_acceptances_target_check
    CHECK (
      (expected_event_type = 'subscription.cancelled'
        AND expected_subscription_id ~ '^sub_[A-Za-z0-9]+$'
        AND expected_refund_id IS NULL)
      OR
      (expected_event_type = 'refund.processed'
        AND expected_subscription_id IS NULL
        AND expected_refund_id IS NOT NULL)
    );

CREATE INDEX IF NOT EXISTS razorpay_webhook_retry_acceptances_refund_idx
  ON public.razorpay_webhook_retry_acceptances (expected_refund_id)
  WHERE expected_refund_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.arm_razorpay_refund_retry_acceptance(
  p_account_id UUID,
  p_provider_mode TEXT,
  p_expected_refund_id UUID,
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
  v_refund public.payment_refunds%ROWTYPE;
  v_acceptance_id UUID;
  v_expires_at TIMESTAMPTZ;
BEGIN
  IF p_provider_mode IS DISTINCT FROM 'test'
     OR p_expected_refund_id IS NULL
     OR p_armed_by IS NULL
     OR p_ttl_seconds < 60
     OR p_ttl_seconds > 900 THEN
    RAISE EXCEPTION 'invalid Razorpay Test refund retry acceptance request';
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
    RAISE EXCEPTION 'Razorpay connection is not eligible for refund retry acceptance';
  END IF;

  SELECT * INTO v_refund
  FROM public.payment_refunds
  WHERE id = p_expected_refund_id
    AND account_id = p_account_id
  FOR UPDATE;

  IF v_refund.id IS NULL
     OR v_refund.source <> 'usefuldesk'
     OR v_refund.status <> 'creating'
     OR v_refund.gateway_refund_id IS NOT NULL
     OR v_refund.requested_by IS DISTINCT FROM p_armed_by
     OR v_refund.disposition IS NULL THEN
    RAISE EXCEPTION 'refund retry acceptance requires a fresh local Test refund';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.webhook_events AS event
    WHERE event.gateway = 'razorpay'
      AND event.account_id = p_account_id
      AND event.type = 'refund.processed'
      AND event.payload #>> '{payload,refund,entity,notes,usefuldesk_refund_id}'
        = p_expected_refund_id::TEXT
  ) THEN
    RAISE EXCEPTION 'the target provider refund event already exists';
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
  ) OR EXISTS (
    SELECT 1
    FROM public.gateway_refund_exceptions AS exception
    WHERE exception.account_id = p_account_id
      AND exception.payment_id = v_refund.payment_id
      AND exception.resolved_at IS NULL
  ) THEN
    RAISE EXCEPTION 'unresolved target Razorpay work blocks refund retry acceptance';
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
    expected_refund_id,
    armed_by,
    expires_at,
    provider_triggered_by,
    provider_triggered_at
  ) VALUES (
    p_account_id,
    'test',
    'refund.processed',
    p_expected_refund_id,
    p_armed_by,
    v_expires_at,
    p_armed_by,
    clock_timestamp()
  )
  RETURNING id INTO v_acceptance_id;

  RETURN jsonb_build_object(
    'acceptance_id', v_acceptance_id,
    'event_type', 'refund.processed',
    'refund_id', p_expected_refund_id,
    'expires_at', v_expires_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.consume_razorpay_refund_retry_acceptance(
  p_account_id UUID,
  p_provider_mode TEXT,
  p_event_type TEXT,
  p_refund_id UUID,
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
  IF p_provider_mode IS DISTINCT FROM 'test'
     OR p_event_type IS DISTINCT FROM 'refund.processed' THEN
    RETURN jsonb_build_object('action', 'pass');
  END IF;

  SELECT * INTO v_acceptance
  FROM public.razorpay_webhook_retry_acceptances
  WHERE account_id = p_account_id
    AND provider_mode = 'test'
    AND expected_event_type = 'refund.processed'
    AND expected_refund_id = p_refund_id
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

REVOKE ALL ON FUNCTION public.arm_razorpay_refund_retry_acceptance(
  UUID, TEXT, UUID, UUID, INTEGER
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.consume_razorpay_refund_retry_acceptance(
  UUID, TEXT, TEXT, UUID, TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.arm_razorpay_refund_retry_acceptance(
  UUID, TEXT, UUID, UUID, INTEGER
) TO service_role;
GRANT EXECUTE ON FUNCTION public.consume_razorpay_refund_retry_acceptance(
  UUID, TEXT, TEXT, UUID, TEXT, TEXT, TEXT, TEXT
) TO service_role;

COMMENT ON COLUMN public.razorpay_webhook_retry_acceptances.expected_refund_id IS
  'Exact local UsefulDesk refund selected for a one-shot signed refund.processed provider retry proof.';
COMMENT ON FUNCTION public.arm_razorpay_refund_retry_acceptance(
  UUID, TEXT, UUID, UUID, INTEGER
) IS 'Arms only a freshly reserved UsefulDesk refund in the isolated Razorpay Test acceptance stack.';
