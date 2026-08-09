-- Razorpay Stage 2 Test-only application-webhook cutover. The selector update
-- and its parity proof share one transaction; code existence alone can never
-- switch a merchant.

CREATE TABLE IF NOT EXISTS public.razorpay_webhook_cutovers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  provider_mode TEXT NOT NULL,
  external_account_id TEXT NOT NULL,
  previous_ingress TEXT NOT NULL,
  new_ingress TEXT NOT NULL,
  parity_event_ids TEXT[] NOT NULL,
  cutover_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  cutover_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT razorpay_webhook_cutovers_mode_check
    CHECK (provider_mode = 'test'),
  CONSTRAINT razorpay_webhook_cutovers_previous_check
    CHECK (previous_ingress = 'legacy_account'),
  CONSTRAINT razorpay_webhook_cutovers_new_check
    CHECK (new_ingress = 'application'),
  CONSTRAINT razorpay_webhook_cutovers_three_events_check
    CHECK (cardinality(parity_event_ids) = 3)
);

ALTER TABLE public.razorpay_webhook_cutovers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.razorpay_webhook_cutovers
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.razorpay_webhook_cutovers TO service_role;

CREATE INDEX IF NOT EXISTS razorpay_webhook_cutovers_account_at_idx
  ON public.razorpay_webhook_cutovers (account_id, cutover_at DESC);
CREATE INDEX IF NOT EXISTS razorpay_webhook_cutovers_cutover_by_idx
  ON public.razorpay_webhook_cutovers (cutover_by)
  WHERE cutover_by IS NOT NULL;

CREATE OR REPLACE FUNCTION public.cutover_razorpay_application_webhook(
  p_account_id UUID,
  p_provider_mode TEXT,
  p_parity_event_ids TEXT[],
  p_cutover_by UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_credentials public.account_payment_credentials%ROWTYPE;
  v_qualified_pairs INTEGER;
  v_qualified_types INTEGER;
  v_required_types INTEGER;
  v_processed_events INTEGER;
  v_charged_ledger_events INTEGER;
  v_unresolved_events INTEGER;
  v_cutover_id UUID;
BEGIN
  IF p_provider_mode IS DISTINCT FROM 'test' THEN
    RAISE EXCEPTION 'Razorpay application-webhook cutover is Test-only';
  END IF;
  IF p_cutover_by IS NULL
     OR cardinality(p_parity_event_ids) <> 3
     OR EXISTS (
       SELECT 1
       FROM unnest(p_parity_event_ids) AS supplied(event_id)
       WHERE supplied.event_id IS NULL
          OR btrim(supplied.event_id) = ''
          OR length(supplied.event_id) > 200
     )
     OR (
       SELECT count(DISTINCT supplied.event_id)
       FROM unnest(p_parity_event_ids) AS supplied(event_id)
     ) <> 3 THEN
    RAISE EXCEPTION 'exactly three distinct parity event ids are required';
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
     OR v_credentials.canonical_webhook_ingress <> 'legacy_account'
     OR v_credentials.last_oauth_refresh_scan_at IS NULL
     OR v_credentials.last_oauth_refresh_scan_at < clock_timestamp() - INTERVAL '48 hours'
     OR v_credentials.oauth_refresh_scan_lease_owner IS NOT NULL
     OR v_credentials.oauth_refresh_scan_lease_until IS NOT NULL
     OR v_credentials.refresh_lease_owner IS NOT NULL
     OR v_credentials.refresh_lease_until IS NOT NULL THEN
    RAISE EXCEPTION 'Razorpay connection is not eligible for application-webhook cutover';
  END IF;

  WITH pairs AS (
    SELECT
      delivery.provider_event_id,
      count(*) FILTER (WHERE delivery.ingress = 'legacy_account') AS legacy_count,
      count(*) FILTER (WHERE delivery.ingress = 'application') AS application_count,
      count(DISTINCT delivery.account_id) AS account_count,
      count(DISTINCT delivery.external_account_id) AS external_account_count,
      count(DISTINCT delivery.event_type) AS type_count,
      count(DISTINCT delivery.payload_sha256) AS payload_count,
      min(delivery.event_type) AS event_type,
      bool_and(delivery.account_id = p_account_id) AS account_matches,
      bool_and(delivery.external_account_id = v_credentials.razorpay_account_id) AS external_matches,
      bool_and(delivery.event_identity_source = 'header') AS header_identity,
      bool_and(NOT delivery.canonical_mutation_attempted) AS no_mutation_attempt,
      bool_and(
        (delivery.ingress = 'legacy_account' AND NOT delivery.shadow_only)
        OR (delivery.ingress = 'application' AND delivery.shadow_only)
      ) AS pre_cutover_roles,
      extract(epoch FROM max(delivery.received_at) - min(delivery.received_at)) AS skew_seconds,
      min(delivery.received_at) AS first_received_at
    FROM public.razorpay_webhook_deliveries AS delivery
    WHERE delivery.provider_mode = 'test'
      AND delivery.provider_event_id = ANY(p_parity_event_ids)
    GROUP BY delivery.provider_event_id
  ), qualified AS (
    SELECT *
    FROM pairs
    WHERE legacy_count = 1
      AND application_count = 1
      AND account_count = 1
      AND external_account_count = 1
      AND type_count = 1
      AND payload_count = 1
      AND account_matches
      AND external_matches
      AND header_identity
      AND no_mutation_attempt
      AND pre_cutover_roles
      AND skew_seconds <= 5
      AND first_received_at >= clock_timestamp() - INTERVAL '48 hours'
  )
  SELECT
    count(*),
    count(DISTINCT event_type),
    count(DISTINCT event_type) FILTER (
      WHERE event_type IN (
        'subscription.authenticated',
        'subscription.activated',
        'subscription.charged'
      )
    )
  INTO v_qualified_pairs, v_qualified_types, v_required_types
  FROM qualified;

  IF v_qualified_pairs <> 3
     OR v_qualified_types <> 3
     OR v_required_types <> 3 THEN
    RAISE EXCEPTION 'Razorpay dual-ingress parity proof did not qualify';
  END IF;

  SELECT count(*) INTO v_processed_events
  FROM public.webhook_events AS event
  WHERE event.id = ANY(p_parity_event_ids)
    AND event.gateway = 'razorpay'
    AND event.account_id = p_account_id
    AND event.processing_status = 'processed'
    AND event.processed_at IS NOT NULL;

  SELECT count(*) INTO v_charged_ledger_events
  FROM public.webhook_events AS event
  JOIN public.payments AS payment
    ON payment.account_id = event.account_id
   AND payment.gateway_payment_id = event.payload #>> '{payload,payment,entity,id}'
  WHERE event.id = ANY(p_parity_event_ids)
    AND event.gateway = 'razorpay'
    AND event.account_id = p_account_id
    AND event.type = 'subscription.charged'
    AND event.processing_status = 'processed'
    AND payment.source = 'auto';

  SELECT count(*) INTO v_unresolved_events
  FROM public.webhook_events AS event
  WHERE event.gateway = 'razorpay'
    AND event.account_id = p_account_id
    AND event.processed_at IS NULL;

  IF v_processed_events <> 3
     OR v_charged_ledger_events <> 1
     OR v_unresolved_events <> 0 THEN
    RAISE EXCEPTION 'Razorpay canonical processing evidence is incomplete';
  END IF;

  UPDATE public.account_payment_credentials
  SET canonical_webhook_ingress = 'application'
  WHERE account_id = p_account_id
    AND gateway = 'razorpay'
    AND canonical_webhook_ingress = 'legacy_account';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Razorpay canonical ingress changed concurrently';
  END IF;

  INSERT INTO public.razorpay_webhook_cutovers (
    account_id,
    provider_mode,
    external_account_id,
    previous_ingress,
    new_ingress,
    parity_event_ids,
    cutover_by
  ) VALUES (
    p_account_id,
    'test',
    v_credentials.razorpay_account_id,
    'legacy_account',
    'application',
    p_parity_event_ids,
    p_cutover_by
  )
  RETURNING id INTO v_cutover_id;

  RETURN jsonb_build_object(
    'cutover_id', v_cutover_id,
    'account_id', p_account_id,
    'canonical_webhook_ingress', 'application',
    'parity_event_count', 3,
    'cutover_at', clock_timestamp()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cutover_razorpay_application_webhook(
  UUID, TEXT, TEXT[], UUID
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cutover_razorpay_application_webhook(
  UUID, TEXT, TEXT[], UUID
) TO service_role;

COMMENT ON TABLE public.razorpay_webhook_cutovers IS
  'Service-only immutable audit of parity-gated Test application-webhook selector transitions.';
