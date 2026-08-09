-- Keep the provider-side cancellation that starts the Stage 2 retry exercise
-- inside the same Test-only, account-scoped, one-shot audit boundary.

ALTER TABLE public.razorpay_webhook_retry_acceptances
  ADD COLUMN IF NOT EXISTS provider_triggered_by UUID
    REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS provider_triggered_at TIMESTAMPTZ;

ALTER TABLE public.razorpay_webhook_retry_acceptances
  DROP CONSTRAINT IF EXISTS razorpay_webhook_retry_acceptances_trigger_audit_check;
ALTER TABLE public.razorpay_webhook_retry_acceptances
  ADD CONSTRAINT razorpay_webhook_retry_acceptances_trigger_audit_check
  CHECK (
    (provider_triggered_by IS NULL AND provider_triggered_at IS NULL)
    OR (provider_triggered_by IS NOT NULL AND provider_triggered_at IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS razorpay_webhook_retry_acceptances_triggered_by_idx
  ON public.razorpay_webhook_retry_acceptances (provider_triggered_by)
  WHERE provider_triggered_by IS NOT NULL;

CREATE OR REPLACE FUNCTION public.trigger_razorpay_webhook_retry_acceptance(
  p_acceptance_id UUID,
  p_account_id UUID,
  p_triggered_by UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_acceptance public.razorpay_webhook_retry_acceptances%ROWTYPE;
  v_credentials public.account_payment_credentials%ROWTYPE;
  v_mandate public.payment_mandates%ROWTYPE;
BEGIN
  IF p_triggered_by IS NULL THEN
    RAISE EXCEPTION 'a retry acceptance provider trigger requires an operator';
  END IF;

  SELECT * INTO v_acceptance
  FROM public.razorpay_webhook_retry_acceptances
  WHERE id = p_acceptance_id
    AND account_id = p_account_id
    AND provider_mode = 'test'
  FOR UPDATE;

  IF v_acceptance.id IS NULL
     OR v_acceptance.status <> 'armed'
     OR v_acceptance.expires_at <= clock_timestamp()
     OR v_acceptance.provider_triggered_at IS NOT NULL THEN
    RAISE EXCEPTION 'retry acceptance provider trigger is not eligible';
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
     OR v_credentials.canonical_webhook_ingress <> 'application'
     OR v_credentials.oauth_access_token IS NULL
     OR v_credentials.oauth_refresh_token IS NULL
     OR v_credentials.oauth_refresh_expires_at <= clock_timestamp()
     OR v_credentials.oauth_refresh_scan_lease_owner IS NOT NULL
     OR v_credentials.oauth_refresh_scan_lease_until IS NOT NULL
     OR v_credentials.refresh_lease_owner IS NOT NULL
     OR v_credentials.refresh_lease_until IS NOT NULL THEN
    RAISE EXCEPTION 'Razorpay connection is not eligible for provider trigger';
  END IF;

  SELECT * INTO v_mandate
  FROM public.payment_mandates
  WHERE account_id = p_account_id
    AND gateway = 'razorpay'
    AND gateway_subscription_id = v_acceptance.expected_subscription_id
  FOR UPDATE;

  IF v_mandate.id IS NULL OR v_mandate.status NOT IN ('pending', 'active') THEN
    RAISE EXCEPTION 'retry acceptance provider trigger requires a fresh Test mandate';
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
    RAISE EXCEPTION 'unresolved Razorpay work blocks provider trigger';
  END IF;

  UPDATE public.razorpay_webhook_retry_acceptances
  SET provider_triggered_by = p_triggered_by,
      provider_triggered_at = clock_timestamp()
  WHERE id = v_acceptance.id;

  RETURN jsonb_build_object(
    'acceptance_id', v_acceptance.id,
    'subscription_id', v_acceptance.expected_subscription_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.trigger_razorpay_webhook_retry_acceptance(
  UUID, UUID, UUID
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trigger_razorpay_webhook_retry_acceptance(
  UUID, UUID, UUID
) TO service_role;

COMMENT ON FUNCTION public.trigger_razorpay_webhook_retry_acceptance(
  UUID, UUID, UUID
) IS 'One-shot Test-only audit claim before the application asks Razorpay to cancel the exact armed subscription.';
