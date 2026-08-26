-- Terminally reconcile pre-OAuth Razorpay Test events whose signed receipt
-- tenant disagrees with the tenant embedded in the provider subscription.
-- This path is intentionally narrower than webhook replay: it requires no
-- surviving domain object or local financial effect and records an immutable
-- service-only audit before closing the failed event.

CREATE TABLE IF NOT EXISTS public.razorpay_webhook_reconciliations (
  event_id TEXT PRIMARY KEY
    REFERENCES public.webhook_events(id) ON DELETE RESTRICT,
  receipt_account_id UUID NOT NULL
    REFERENCES public.accounts(id) ON DELETE RESTRICT,
  payload_account_id UUID NOT NULL
    REFERENCES public.accounts(id) ON DELETE RESTRICT,
  provider_mode TEXT NOT NULL CHECK (provider_mode = 'test'),
  external_account_id TEXT NOT NULL
    CHECK (external_account_id ~ '^acc_[A-Za-z0-9]+$'),
  event_type TEXT NOT NULL,
  payload_membership_id UUID NOT NULL,
  payload_contact_id UUID NOT NULL,
  gateway_subscription_id TEXT NOT NULL,
  gateway_payment_id TEXT,
  amount_subunits BIGINT,
  provider_payment_captured BOOLEAN NOT NULL,
  resolution_code TEXT NOT NULL CHECK (
    resolution_code = 'legacy_identity_mismatch_no_local_effect'
  ),
  evidence_note TEXT NOT NULL CHECK (
    length(btrim(evidence_note)) BETWEEN 20 AND 1000
  ),
  resolved_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  resolved_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CHECK (receipt_account_id <> payload_account_id),
  CHECK (
    (gateway_payment_id IS NULL AND amount_subunits IS NULL AND NOT provider_payment_captured)
    OR (
      gateway_payment_id ~ '^pay_[A-Za-z0-9]+$'
      AND amount_subunits > 0
      AND provider_payment_captured
    )
  )
);

ALTER TABLE public.razorpay_webhook_reconciliations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.razorpay_webhook_reconciliations
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.razorpay_webhook_reconciliations TO service_role;

COMMENT ON TABLE public.razorpay_webhook_reconciliations IS
  'Immutable service-only audit for terminal Razorpay webhook reconciliation. Rows preserve proven provider and tenant identity without replaying financial effects.';

CREATE OR REPLACE FUNCTION public.reconcile_razorpay_legacy_identity_mismatch_event(
  p_event_id TEXT,
  p_receipt_account_id UUID,
  p_payload_account_id UUID,
  p_provider_mode TEXT,
  p_external_account_id TEXT,
  p_event_type TEXT,
  p_gateway_subscription_id TEXT,
  p_gateway_payment_id TEXT,
  p_amount_subunits BIGINT,
  p_actor UUID,
  p_evidence_note TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_event public.webhook_events%ROWTYPE;
  v_existing public.razorpay_webhook_reconciliations%ROWTYPE;
  v_payload_account_id UUID;
  v_payload_membership_id UUID;
  v_payload_contact_id UUID;
  v_payload_subscription_id TEXT;
  v_payload_payment_id TEXT;
  v_payload_amount_subunits BIGINT;
  v_payload_payment_captured BOOLEAN;
  v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  IF p_provider_mode IS DISTINCT FROM 'test' THEN
    RAISE EXCEPTION 'Legacy identity-mismatch reconciliation is Test-only';
  END IF;
  IF p_event_id IS NULL
     OR btrim(p_event_id) = ''
     OR p_receipt_account_id IS NULL
     OR p_payload_account_id IS NULL
     OR p_receipt_account_id = p_payload_account_id
     OR p_external_account_id IS NULL
     OR p_external_account_id !~ '^acc_[A-Za-z0-9]+$'
     OR p_event_type IS NULL
     OR p_event_type NOT IN (
       'subscription.authenticated',
       'subscription.activated',
       'subscription.charged'
     )
     OR p_gateway_subscription_id IS NULL
     OR p_gateway_subscription_id !~ '^sub_[A-Za-z0-9]+$' THEN
    RAISE EXCEPTION 'The expected Razorpay identity mapping is invalid';
  END IF;
  IF p_evidence_note IS NULL
     OR length(btrim(p_evidence_note)) < 20
     OR length(btrim(p_evidence_note)) > 1000 THEN
    RAISE EXCEPTION 'A 20 to 1000 character evidence note is required';
  END IF;
  IF p_actor IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.profiles AS profile
    WHERE profile.user_id = p_actor
      AND profile.account_id = p_receipt_account_id
      AND profile.account_role IN ('owner', 'admin')
  ) THEN
    RAISE EXCEPTION 'A receipt-account admin is required';
  END IF;

  SELECT * INTO v_existing
  FROM public.razorpay_webhook_reconciliations
  WHERE event_id = p_event_id;

  IF FOUND THEN
    IF v_existing.receipt_account_id IS DISTINCT FROM p_receipt_account_id
       OR v_existing.payload_account_id IS DISTINCT FROM p_payload_account_id
       OR v_existing.provider_mode IS DISTINCT FROM p_provider_mode
       OR v_existing.external_account_id IS DISTINCT FROM p_external_account_id
       OR v_existing.event_type IS DISTINCT FROM p_event_type
       OR v_existing.gateway_subscription_id IS DISTINCT FROM p_gateway_subscription_id
       OR v_existing.gateway_payment_id IS DISTINCT FROM p_gateway_payment_id
       OR v_existing.amount_subunits IS DISTINCT FROM p_amount_subunits THEN
      RAISE EXCEPTION 'The event was reconciled with different identity facts';
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM public.webhook_events AS event
      WHERE event.id = p_event_id
        AND event.account_id = p_receipt_account_id
        AND event.gateway = 'razorpay'
        AND event.processing_status = 'processed'
        AND event.processed_at = v_existing.resolved_at
        AND event.provider_mode = v_existing.provider_mode
        AND event.external_account_id = v_existing.external_account_id
        AND event.event_identity_source IS NULL
        AND event.payload_sha256 IS NULL
        AND event.processing_context #>>
          '{razorpay_terminal_reconciliation,resolution_code}'
          = v_existing.resolution_code
    ) THEN
      RAISE EXCEPTION 'The reconciliation audit and webhook event disagree';
    END IF;

    RETURN jsonb_build_object(
      'outcome', 'already_reconciled',
      'event_id', p_event_id,
      'resolution_code', v_existing.resolution_code
    );
  END IF;

  SELECT * INTO v_event
  FROM public.webhook_events AS event
  WHERE event.id = p_event_id
    AND event.gateway = 'razorpay'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'The Razorpay webhook event was not found';
  END IF;
  IF v_event.account_id IS DISTINCT FROM p_receipt_account_id
     OR v_event.type IS DISTINCT FROM p_event_type
     OR v_event.processing_status IS DISTINCT FROM 'failed'
     OR v_event.processed_at IS NOT NULL
     OR v_event.provider_mode IS NOT NULL
     OR v_event.external_account_id IS NOT NULL
     OR v_event.event_identity_source IS NOT NULL
     OR v_event.payload_sha256 IS NOT NULL THEN
    RAISE EXCEPTION 'The event is not an unresolved identity-less legacy failure';
  END IF;
  IF v_event.last_error IS NULL
     OR v_event.last_error NOT LIKE 'account mismatch:%'
     OR position(p_receipt_account_id::TEXT IN v_event.last_error) = 0
     OR position(p_payload_account_id::TEXT IN v_event.last_error) = 0 THEN
    RAISE EXCEPTION 'The stored failure does not prove the expected account mismatch';
  END IF;

  BEGIN
    v_payload_account_id := NULLIF(
      v_event.payload #>> '{payload,subscription,entity,notes,account_id}',
      ''
    )::UUID;
    v_payload_membership_id := NULLIF(
      v_event.payload #>> '{payload,subscription,entity,notes,membership_id}',
      ''
    )::UUID;
    v_payload_contact_id := NULLIF(
      v_event.payload #>> '{payload,subscription,entity,notes,contact_id}',
      ''
    )::UUID;
    v_payload_amount_subunits := NULLIF(
      v_event.payload #>> '{payload,payment,entity,amount}',
      ''
    )::BIGINT;
  EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RAISE EXCEPTION 'The legacy payload contains invalid identity or amount facts';
  END;

  v_payload_subscription_id :=
    v_event.payload #>> '{payload,subscription,entity,id}';
  v_payload_payment_id :=
    v_event.payload #>> '{payload,payment,entity,id}';
  v_payload_payment_captured :=
    COALESCE(v_event.payload #>> '{payload,payment,entity,captured}', '0')
      IN ('1', 'true');

  IF v_payload_membership_id IS NULL
     OR v_payload_contact_id IS NULL
     OR v_event.payload ->> 'account_id' IS DISTINCT FROM p_external_account_id
     OR v_payload_account_id IS DISTINCT FROM p_payload_account_id
     OR v_payload_subscription_id IS DISTINCT FROM p_gateway_subscription_id
     OR v_payload_payment_id IS DISTINCT FROM p_gateway_payment_id
     OR v_payload_amount_subunits IS DISTINCT FROM p_amount_subunits THEN
    RAISE EXCEPTION 'The payload does not match the reviewed provider and tenant facts';
  END IF;
  IF p_gateway_payment_id IS NULL THEN
    IF p_amount_subunits IS NOT NULL OR v_payload_payment_captured THEN
      RAISE EXCEPTION 'A non-monetary event cannot carry captured payment facts';
    END IF;
  ELSIF p_gateway_payment_id !~ '^pay_[A-Za-z0-9]+$'
        OR p_amount_subunits IS NULL
        OR p_amount_subunits <= 0
        OR NOT v_payload_payment_captured
        OR v_event.payload #>> '{payload,payment,entity,status}' <> 'captured' THEN
    RAISE EXCEPTION 'The expected provider payment is not captured';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.accounts
    WHERE id = p_payload_account_id
  ) THEN
    RAISE EXCEPTION 'The payload tenant no longer exists';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.razorpay_live_webhook_activations AS activation
    WHERE activation.account_id = p_receipt_account_id
      AND activation.external_account_id = p_external_account_id
      AND activation.activated_at <= v_event.created_at
  ) THEN
    RAISE EXCEPTION 'The event does not predate Live application-webhook activation';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.razorpay_live_webhook_activations AS activation
    WHERE activation.account_id = p_receipt_account_id
      AND activation.external_account_id = p_external_account_id
      AND activation.activated_at > v_event.created_at
  ) THEN
    RAISE EXCEPTION 'The later Live merchant activation evidence is missing';
  END IF;

  -- A terminal ignore is safe only after every referenced domain and financial
  -- object has been proven absent. Any surviving fact requires a separate,
  -- provider-backed reconciliation instead of this historical closeout.
  IF EXISTS (
    SELECT 1 FROM public.memberships
    WHERE id = v_payload_membership_id
  ) OR EXISTS (
    SELECT 1 FROM public.contacts
    WHERE id = v_payload_contact_id
  ) OR EXISTS (
    SELECT 1 FROM public.payment_mandates
    WHERE gateway_subscription_id = p_gateway_subscription_id
  ) OR EXISTS (
    SELECT 1 FROM public.payments
    WHERE gateway_payment_id = p_gateway_payment_id
  ) OR EXISTS (
    SELECT 1 FROM public.gateway_charge_exceptions
    WHERE webhook_event_id = p_event_id
       OR gateway_subscription_id = p_gateway_subscription_id
       OR gateway_payment_id = p_gateway_payment_id
  ) OR EXISTS (
    SELECT 1 FROM public.gateway_payment_exceptions
    WHERE webhook_event_id = p_event_id
       OR gateway_payment_id = p_gateway_payment_id
  ) OR EXISTS (
    SELECT 1 FROM public.razorpay_webhook_deliveries
    WHERE provider_event_id = p_event_id
  ) THEN
    RAISE EXCEPTION 'The event has a surviving domain or financial effect';
  END IF;

  INSERT INTO public.razorpay_webhook_reconciliations (
    event_id,
    receipt_account_id,
    payload_account_id,
    provider_mode,
    external_account_id,
    event_type,
    payload_membership_id,
    payload_contact_id,
    gateway_subscription_id,
    gateway_payment_id,
    amount_subunits,
    provider_payment_captured,
    resolution_code,
    evidence_note,
    resolved_by,
    resolved_at
  ) VALUES (
    p_event_id,
    p_receipt_account_id,
    p_payload_account_id,
    p_provider_mode,
    p_external_account_id,
    p_event_type,
    v_payload_membership_id,
    v_payload_contact_id,
    p_gateway_subscription_id,
    p_gateway_payment_id,
    p_amount_subunits,
    v_payload_payment_captured,
    'legacy_identity_mismatch_no_local_effect',
    btrim(p_evidence_note),
    p_actor,
    v_now
  );

  UPDATE public.webhook_events
  SET provider_mode = p_provider_mode,
      external_account_id = p_external_account_id,
      processing_status = 'processed',
      processed_at = v_now,
      processing_started_at = NULL,
      processing_owner = NULL,
      next_attempt_at = NULL,
      last_error = NULL,
      processing_context = processing_context || jsonb_build_object(
        'razorpay_terminal_reconciliation',
        jsonb_build_object(
          'resolution_code', 'legacy_identity_mismatch_no_local_effect',
          'receipt_account_id', p_receipt_account_id,
          'payload_account_id', p_payload_account_id,
          'provider_mode', p_provider_mode,
          'external_account_id', p_external_account_id,
          'local_financial_effect', 'none',
          'resolved_by', p_actor,
          'resolved_at', v_now
        )
      )
  WHERE id = p_event_id
    AND account_id = p_receipt_account_id
    AND gateway = 'razorpay'
    AND processing_status = 'failed'
    AND processed_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'The failed event changed during reconciliation';
  END IF;

  RETURN jsonb_build_object(
    'outcome', 'reconciled',
    'event_id', p_event_id,
    'resolution_code', 'legacy_identity_mismatch_no_local_effect'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_razorpay_legacy_identity_mismatch_event(
  TEXT, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT, UUID, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_razorpay_legacy_identity_mismatch_event(
  TEXT, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT, UUID, TEXT
) TO service_role;
