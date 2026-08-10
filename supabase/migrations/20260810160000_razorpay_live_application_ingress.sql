-- Stage 5: activate the application webhook for one OAuth-ready Live pilot.
-- This is separate from the Test-only three-event parity cutover. Production
-- has no Live manual key or per-account webhook to use as a second ingress.

CREATE TABLE IF NOT EXISTS public.razorpay_live_webhook_activations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  provider_mode TEXT NOT NULL,
  external_account_id TEXT NOT NULL,
  previous_ingress TEXT NOT NULL,
  new_ingress TEXT NOT NULL,
  activated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  activated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT razorpay_live_webhook_activations_mode_check
    CHECK (provider_mode = 'live'),
  CONSTRAINT razorpay_live_webhook_activations_previous_check
    CHECK (previous_ingress = 'legacy_account'),
  CONSTRAINT razorpay_live_webhook_activations_new_check
    CHECK (new_ingress = 'application'),
  CONSTRAINT razorpay_live_webhook_activations_account_merchant_unique
    UNIQUE (account_id, external_account_id)
);

ALTER TABLE public.razorpay_live_webhook_activations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.razorpay_live_webhook_activations
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.razorpay_live_webhook_activations TO service_role;

CREATE INDEX IF NOT EXISTS razorpay_live_webhook_activations_actor_idx
  ON public.razorpay_live_webhook_activations (activated_by)
  WHERE activated_by IS NOT NULL;

CREATE OR REPLACE FUNCTION public.activate_razorpay_live_application_webhook(
  p_account_id UUID,
  p_external_account_id TEXT,
  p_activated_by UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_credentials public.account_payment_credentials%ROWTYPE;
  v_activation_id UUID;
BEGIN
  IF p_account_id IS NULL
     OR p_activated_by IS NULL
     OR p_external_account_id IS NULL
     OR btrim(p_external_account_id) = ''
     OR length(p_external_account_id) > 200 THEN
    RAISE EXCEPTION 'Live webhook activation identity is invalid';
  END IF;

  SELECT * INTO v_credentials
  FROM public.account_payment_credentials
  WHERE account_id = p_account_id
    AND gateway = 'razorpay'
  FOR UPDATE;

  IF v_credentials.account_id IS NULL THEN
    RAISE EXCEPTION 'Razorpay connection was not found';
  END IF;

  IF v_credentials.canonical_webhook_ingress = 'application' THEN
    SELECT id INTO v_activation_id
    FROM public.razorpay_live_webhook_activations
    WHERE account_id = p_account_id
      AND external_account_id = p_external_account_id;
    IF v_activation_id IS NULL THEN
      RAISE EXCEPTION 'Live webhook selector lacks activation audit';
    END IF;
    RETURN jsonb_build_object(
      'outcome', 'duplicate',
      'activation_id', v_activation_id,
      'account_id', p_account_id,
      'canonical_webhook_ingress', 'application'
    );
  END IF;

  IF v_credentials.authentication_mode <> 'oauth'
     OR v_credentials.provider_mode <> 'live'
     OR v_credentials.connection_status <> 'ready'
     OR v_credentials.razorpay_account_id <> p_external_account_id
     OR v_credentials.secret_storage_version <> 1
     OR v_credentials.oauth_access_token IS NULL
     OR v_credentials.oauth_refresh_token IS NULL
     OR v_credentials.oauth_access_expires_at <= clock_timestamp()
     OR v_credentials.oauth_refresh_expires_at <= v_credentials.oauth_access_expires_at
     OR NOT ('read_write' = ANY(regexp_split_to_array(COALESCE(v_credentials.oauth_scope, ''), '[ ,]+')))
     OR NOT (
       v_credentials.merchant_status = 'activated'
       OR (
         v_credentials.merchant_status = 'unknown'
         AND v_credentials.activation_verified_at >= clock_timestamp() - INTERVAL '24 hours'
       )
     )
     OR v_credentials.canonical_webhook_ingress <> 'legacy_account'
     OR v_credentials.refresh_lease_owner IS NOT NULL
     OR v_credentials.refresh_lease_until IS NOT NULL
     OR v_credentials.razorpay_key_id IS NOT NULL
     OR v_credentials.razorpay_key_secret IS NOT NULL
     OR v_credentials.razorpay_webhook_secret IS NOT NULL THEN
    RAISE EXCEPTION 'Razorpay Live connection is not eligible for application-webhook activation';
  END IF;

  UPDATE public.account_payment_credentials
  SET canonical_webhook_ingress = 'application'
  WHERE account_id = p_account_id
    AND gateway = 'razorpay'
    AND canonical_webhook_ingress = 'legacy_account';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Razorpay canonical ingress changed concurrently';
  END IF;

  INSERT INTO public.razorpay_live_webhook_activations (
    account_id,
    provider_mode,
    external_account_id,
    previous_ingress,
    new_ingress,
    activated_by
  ) VALUES (
    p_account_id,
    'live',
    p_external_account_id,
    'legacy_account',
    'application',
    p_activated_by
  )
  RETURNING id INTO v_activation_id;

  RETURN jsonb_build_object(
    'outcome', 'activated',
    'activation_id', v_activation_id,
    'account_id', p_account_id,
    'canonical_webhook_ingress', 'application',
    'activated_at', clock_timestamp()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.activate_razorpay_live_application_webhook(
  UUID, TEXT, UUID
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.activate_razorpay_live_application_webhook(
  UUID, TEXT, UUID
) TO service_role;

COMMENT ON TABLE public.razorpay_live_webhook_activations IS
  'Service-only immutable audit of readiness-gated Live application-webhook selector activation.';
