-- Add provider-source polling for subscription payments whose webhook never
-- reached UsefulDesk. Discovery is read-only at Razorpay and preserves a
-- review-held local exception; it never creates a ledger payment by itself.

ALTER TABLE public.payment_mandates
  ADD COLUMN IF NOT EXISTS provider_reconcile_at TIMESTAMPTZ DEFAULT now(),
  ADD COLUMN IF NOT EXISTS provider_recovery_owner UUID,
  ADD COLUMN IF NOT EXISTS provider_recovery_lease_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS provider_last_reconciled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS provider_reconciliation_error TEXT;

ALTER TABLE public.gateway_charge_exceptions
  ADD COLUMN IF NOT EXISTS gateway_paid_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_payment_mandates_provider_reconciliation
  ON public.payment_mandates(provider_reconcile_at, account_id)
  WHERE status IN ('pending', 'active')
    AND gateway = 'razorpay'
    AND gateway_subscription_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.claim_razorpay_subscription_reconciliation_batch(
  p_provider_mode TEXT,
  p_recovery_owner UUID,
  p_limit INTEGER DEFAULT 20,
  p_lease_seconds INTEGER DEFAULT 300
)
RETURNS TABLE(
  id UUID,
  account_id UUID,
  membership_id UUID,
  gateway_subscription_id TEXT,
  last_applied_paid_count INTEGER,
  provider_reconcile_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_provider_mode NOT IN ('test', 'live') THEN
    RAISE EXCEPTION 'A valid Razorpay provider mode is required';
  END IF;
  IF p_recovery_owner IS NULL THEN
    RAISE EXCEPTION 'A recovery owner is required';
  END IF;
  IF p_limit < 1 OR p_limit > 20 THEN
    RAISE EXCEPTION 'Subscription reconciliation limit must be between 1 and 20';
  END IF;
  IF p_lease_seconds < 30 OR p_lease_seconds > 900 THEN
    RAISE EXCEPTION 'Reconciliation lease must be between 30 and 900 seconds';
  END IF;

  RETURN QUERY
  WITH candidates AS (
    SELECT mandate.id
    FROM public.payment_mandates AS mandate
    JOIN public.account_payment_credentials AS credential
      ON credential.account_id = mandate.account_id
     AND credential.gateway = 'razorpay'
    WHERE mandate.gateway = 'razorpay'
      AND mandate.status IN ('pending', 'active')
      AND mandate.gateway_subscription_id IS NOT NULL
      AND btrim(mandate.gateway_subscription_id) <> ''
      AND mandate.provider_reconcile_at IS NOT NULL
      AND mandate.provider_reconcile_at <= now()
      AND (
        mandate.provider_recovery_lease_until IS NULL
        OR mandate.provider_recovery_lease_until < now()
      )
      AND credential.authentication_mode = 'oauth'
      AND credential.connection_status = 'ready'
      AND credential.provider_mode = p_provider_mode
    ORDER BY mandate.provider_reconcile_at, mandate.created_at
    LIMIT p_limit
    FOR UPDATE OF mandate SKIP LOCKED
  ), claimed AS (
    UPDATE public.payment_mandates AS mandate
    SET provider_recovery_owner = p_recovery_owner,
        provider_recovery_lease_until = now() + make_interval(secs => p_lease_seconds),
        provider_reconciliation_error = NULL
    FROM candidates
    WHERE mandate.id = candidates.id
    RETURNING mandate.id, mandate.account_id, mandate.membership_id,
      mandate.gateway_subscription_id, mandate.last_applied_paid_count,
      mandate.provider_reconcile_at
  )
  SELECT claimed.id, claimed.account_id, claimed.membership_id,
    claimed.gateway_subscription_id, claimed.last_applied_paid_count,
    claimed.provider_reconcile_at
  FROM claimed
  ORDER BY claimed.provider_reconcile_at, claimed.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.preserve_razorpay_provider_charge_observation(
  p_account_id UUID,
  p_membership_id UUID,
  p_mandate_id UUID,
  p_gateway_subscription_id TEXT,
  p_gateway_payment_id TEXT,
  p_gateway_invoice_id TEXT,
  p_provider_paid_count INTEGER,
  p_amount NUMERIC,
  p_currency TEXT,
  p_method TEXT,
  p_payment_status TEXT,
  p_gateway_paid_at TIMESTAMPTZ,
  p_gateway_current_start TIMESTAMPTZ,
  p_gateway_current_end TIMESTAMPTZ
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_mandate public.payment_mandates%ROWTYPE;
  v_existing_exception_id UUID;
  v_exception_id UUID;
BEGIN
  IF p_gateway_payment_id IS NULL OR btrim(p_gateway_payment_id) = '' THEN
    RAISE EXCEPTION 'A Razorpay payment id is required';
  END IF;
  IF p_provider_paid_count IS NULL OR p_provider_paid_count < 1 THEN
    RAISE EXCEPTION 'A positive Razorpay paid_count is required';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'A positive Razorpay payment amount is required';
  END IF;

  SELECT * INTO v_mandate
  FROM public.payment_mandates
  WHERE id = p_mandate_id
  FOR SHARE;

  IF v_mandate.id IS NULL
     OR v_mandate.account_id <> p_account_id
     OR v_mandate.membership_id <> p_membership_id
     OR v_mandate.gateway <> 'razorpay'
     OR v_mandate.gateway_subscription_id IS DISTINCT FROM p_gateway_subscription_id THEN
    RAISE EXCEPTION 'The provider charge does not match the local Razorpay mandate';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.payments AS payment
    WHERE payment.account_id = p_account_id
      AND payment.gateway_payment_id = p_gateway_payment_id
  ) THEN
    RAISE EXCEPTION 'The provider payment exists locally while mandate paid_count is behind';
  END IF;

  SELECT exception.id INTO v_existing_exception_id
  FROM public.gateway_charge_exceptions AS exception
  WHERE exception.account_id = p_account_id
    AND exception.gateway_payment_id = p_gateway_payment_id
  FOR UPDATE;

  IF v_existing_exception_id IS NOT NULL THEN
    UPDATE public.gateway_charge_exceptions
    SET gateway_paid_at = COALESCE(gateway_paid_at, p_gateway_paid_at),
        last_seen_at = now()
    WHERE id = v_existing_exception_id;
    RETURN v_existing_exception_id;
  END IF;

  v_exception_id := public.preserve_gateway_charge_exception(
    p_account_id,
    p_membership_id,
    p_mandate_id,
    NULL,
    p_gateway_subscription_id,
    p_gateway_payment_id,
    p_gateway_invoice_id,
    p_provider_paid_count,
    p_amount,
    p_currency,
    p_method,
    p_payment_status,
    p_gateway_current_start,
    p_gateway_current_end,
    'provider_charge_missing_webhook',
    'Razorpay reports a captured subscription invoice that UsefulDesk did not receive through its canonical webhook ingress.'
  );

  UPDATE public.gateway_charge_exceptions
  SET gateway_paid_at = p_gateway_paid_at,
      status = 'open',
      next_retry_at = NULL,
      recovery_owner = NULL,
      recovery_lease_until = NULL,
      last_recovery_error = NULL
  WHERE id = v_exception_id;

  RETURN v_exception_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_razorpay_subscription_reconciliation(
  p_mandate_id UUID,
  p_recovery_owner UUID,
  p_error TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_updated UUID;
BEGIN
  UPDATE public.payment_mandates
  SET provider_reconcile_at = CASE
        WHEN p_error IS NULL THEN now() + interval '24 hours'
        ELSE now() + interval '15 minutes'
      END,
      provider_recovery_owner = NULL,
      provider_recovery_lease_until = NULL,
      provider_last_reconciled_at = CASE
        WHEN p_error IS NULL THEN now()
        ELSE provider_last_reconciled_at
      END,
      provider_reconciliation_error = CASE
        WHEN p_error IS NULL THEN NULL
        ELSE left(p_error, 1000)
      END
  WHERE id = p_mandate_id
    AND provider_recovery_owner = p_recovery_owner
  RETURNING id INTO v_updated;

  RETURN v_updated IS NOT NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_razorpay_subscription_reconciliation_batch(TEXT, UUID, INTEGER, INTEGER)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.preserve_razorpay_provider_charge_observation(
  UUID, UUID, UUID, TEXT, TEXT, TEXT, INTEGER, NUMERIC, TEXT, TEXT, TEXT,
  TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_razorpay_subscription_reconciliation(UUID, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.claim_razorpay_subscription_reconciliation_batch(TEXT, UUID, INTEGER, INTEGER)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.preserve_razorpay_provider_charge_observation(
  UUID, UUID, UUID, TEXT, TEXT, TEXT, INTEGER, NUMERIC, TEXT, TEXT, TEXT,
  TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ
) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_razorpay_subscription_reconciliation(UUID, UUID, TEXT)
  TO service_role;
