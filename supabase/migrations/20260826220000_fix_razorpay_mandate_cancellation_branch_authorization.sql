-- The P2 cancellation finalizer originally consulted profiles.account_id,
-- which is compatibility metadata for a user's default branch. Authorization
-- is sourced from account_memberships, so owners/admins of a non-default
-- branch must be admitted through that exact account membership instead.

CREATE OR REPLACE FUNCTION public.finalize_razorpay_mandate_cancellation(
  p_account_id UUID,
  p_mandate_id UUID,
  p_gateway_subscription_id TEXT,
  p_provider_status TEXT,
  p_local_status TEXT,
  p_actor UUID,
  p_reason TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_mandate public.payment_mandates%ROWTYPE;
BEGIN
  IF p_actor IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.account_memberships AS membership
    WHERE membership.user_id = p_actor
      AND membership.account_id = p_account_id
      AND membership.role IN ('owner', 'admin')
  ) THEN
    RAISE EXCEPTION 'An account admin is required';
  END IF;
  IF p_reason IS NULL
     OR length(btrim(p_reason)) < 3
     OR length(btrim(p_reason)) > 500 THEN
    RAISE EXCEPTION 'A cancellation reason between 3 and 500 characters is required';
  END IF;
  IF p_gateway_subscription_id IS NULL
     OR btrim(p_gateway_subscription_id) = ''
     OR p_provider_status NOT IN ('cancelled', 'completed', 'expired')
     OR p_local_status NOT IN ('revoked', 'expired')
     OR (p_provider_status = 'cancelled' AND p_local_status <> 'revoked')
     OR (p_provider_status IN ('completed', 'expired') AND p_local_status <> 'expired') THEN
    RAISE EXCEPTION 'Invalid terminal Razorpay subscription state';
  END IF;

  SELECT * INTO v_mandate
  FROM public.payment_mandates
  WHERE id = p_mandate_id
    AND account_id = p_account_id
    AND gateway = 'razorpay'
    AND gateway_subscription_id = p_gateway_subscription_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Razorpay mandate not found for this account';
  END IF;

  UPDATE public.payment_mandates
  SET status = p_local_status,
      provider_subscription_status = p_provider_status,
      provider_status_updated_at = clock_timestamp(),
      cancelled_at = COALESCE(cancelled_at, clock_timestamp()),
      cancelled_by = COALESCE(cancelled_by, p_actor),
      cancellation_reason = COALESCE(cancellation_reason, btrim(p_reason)),
      setup_error = NULL
  WHERE id = v_mandate.id;

  UPDATE public.memberships AS membership
  SET collection_mode = 'manual'
  WHERE membership.id = v_mandate.membership_id
    AND membership.account_id = p_account_id
    AND NOT EXISTS (
      SELECT 1
      FROM public.payment_mandates AS mandate
      WHERE mandate.membership_id = membership.id
        AND mandate.status = 'active'
    );

  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_razorpay_mandate_cancellation(
  UUID, UUID, TEXT, TEXT, TEXT, UUID, TEXT
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.finalize_razorpay_mandate_cancellation(
  UUID, UUID, TEXT, TEXT, TEXT, UUID, TEXT
) TO service_role;
