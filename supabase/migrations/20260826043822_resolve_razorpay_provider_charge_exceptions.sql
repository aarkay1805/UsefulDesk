-- Give admins an audited, service-only resolution path for a captured
-- subscription charge discovered by provider polling. Applying re-enters the
-- canonical record_gateway_charge transaction and remains fail-closed; ignore
-- records that the money was handled outside UsefulDesk without touching the
-- ledger.

CREATE OR REPLACE FUNCTION public.resolve_razorpay_provider_charge_exception(
  p_account_id UUID,
  p_exception_id UUID,
  p_actor UUID,
  p_note TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_exception public.gateway_charge_exceptions%ROWTYPE;
  v_mandate public.payment_mandates%ROWTYPE;
  v_original_gateway_payment_id TEXT;
  v_outcome TEXT;
  v_payment_id UUID;
  v_new_exception_id UUID;
  v_new_reason_code TEXT;
  v_new_reason_message TEXT;
BEGIN
  IF p_actor IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.profiles AS profile
    WHERE profile.user_id = p_actor
      AND profile.account_id = p_account_id
      AND profile.account_role IN ('owner', 'admin')
  ) THEN
    RAISE EXCEPTION 'An account admin is required';
  END IF;
  IF p_note IS NULL OR length(btrim(p_note)) < 3 OR length(btrim(p_note)) > 500 THEN
    RAISE EXCEPTION 'A resolution note between 3 and 500 characters is required';
  END IF;

  SELECT * INTO v_exception
  FROM public.gateway_charge_exceptions
  WHERE id = p_exception_id
    AND account_id = p_account_id
    AND gateway = 'razorpay'
    AND status = 'open'
    AND reason_code = 'provider_charge_missing_webhook'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'The provider-discovered Razorpay charge is no longer open';
  END IF;
  IF v_exception.gateway_paid_at IS NULL THEN
    RAISE EXCEPTION 'The provider charge has no authoritative payment time';
  END IF;

  SELECT * INTO v_mandate
  FROM public.payment_mandates
  WHERE id = v_exception.mandate_id
    AND account_id = p_account_id
    AND membership_id = v_exception.membership_id
    AND gateway = 'razorpay'
    AND gateway_subscription_id = v_exception.gateway_subscription_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'The provider charge no longer matches its Razorpay mandate';
  END IF;
  IF v_exception.provider_paid_count IS NULL
     OR v_exception.provider_paid_count <> v_mandate.last_applied_paid_count + 1 THEN
    RAISE EXCEPTION 'Only the immediately next Razorpay charge can be applied';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.payments AS payment
    WHERE payment.account_id = p_account_id
      AND payment.gateway_payment_id = v_exception.gateway_payment_id
  ) THEN
    RAISE EXCEPTION 'The Razorpay payment already exists in the UsefulDesk ledger';
  END IF;

  v_original_gateway_payment_id := v_exception.gateway_payment_id;
  UPDATE public.gateway_charge_exceptions
  SET gateway_payment_id = v_original_gateway_payment_id
    || ':operator:' || p_exception_id::TEXT
  WHERE id = p_exception_id;

  SELECT charge.outcome, charge.payment_id, charge.exception_id
  INTO v_outcome, v_payment_id, v_new_exception_id
  FROM public.record_gateway_charge(
    v_exception.account_id,
    v_exception.membership_id,
    v_exception.mandate_id,
    v_exception.webhook_event_id,
    v_exception.gateway_subscription_id,
    v_original_gateway_payment_id,
    v_exception.gateway_invoice_id,
    v_exception.provider_paid_count,
    v_exception.amount,
    v_exception.currency,
    v_exception.method,
    v_exception.payment_status,
    v_exception.gateway_current_start,
    v_exception.gateway_current_end
  ) AS charge;

  IF v_outcome = 'applied' AND v_payment_id IS NOT NULL THEN
    UPDATE public.payments
    SET paid_at = v_exception.gateway_paid_at
    WHERE id = v_payment_id
      AND account_id = p_account_id
      AND gateway_payment_id = v_original_gateway_payment_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'The applied Razorpay payment could not be timestamped';
    END IF;

    UPDATE public.gateway_charge_exceptions
    SET gateway_payment_id = v_original_gateway_payment_id,
        status = 'resolved',
        resolved_at = clock_timestamp(),
        resolved_by = p_actor,
        resolution_note = left(btrim(p_note), 500),
        last_seen_at = clock_timestamp(),
        attempt_count = v_exception.attempt_count + 1,
        next_retry_at = NULL,
        recovery_owner = NULL,
        recovery_lease_until = NULL,
        last_recovery_error = NULL
    WHERE id = p_exception_id;

    RETURN jsonb_build_object(
      'outcome', 'applied',
      'payment_id', v_payment_id,
      'exception_id', p_exception_id
    );
  END IF;

  IF v_outcome <> 'exception' OR v_new_exception_id IS NULL THEN
    RAISE EXCEPTION 'Recurring charge resolution returned an invalid outcome';
  END IF;

  -- Preserve the stable exception id and its provider-observation timestamp,
  -- but replace the discovery reason with the canonical ledger blocker.
  DELETE FROM public.gateway_charge_exceptions
  WHERE id = p_exception_id;

  UPDATE public.gateway_charge_exceptions
  SET id = p_exception_id,
      first_seen_at = v_exception.first_seen_at,
      gateway_paid_at = v_exception.gateway_paid_at,
      attempt_count = v_exception.attempt_count + 1,
      next_retry_at = CASE
        WHEN reason_code = 'charge_sequence_mismatch' THEN now()
        ELSE NULL
      END,
      recovery_owner = NULL,
      recovery_lease_until = NULL,
      last_recovery_error = reason_message
  WHERE id = v_new_exception_id
  RETURNING reason_code, reason_message
  INTO v_new_reason_code, v_new_reason_message;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'The blocked Razorpay charge diagnosis was lost';
  END IF;

  RETURN jsonb_build_object(
    'outcome', 'blocked',
    'exception_id', p_exception_id,
    'reason_code', v_new_reason_code,
    'reason_message', v_new_reason_message
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.ignore_razorpay_provider_charge_exception(
  p_account_id UUID,
  p_exception_id UUID,
  p_actor UUID,
  p_note TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_updated UUID;
BEGIN
  IF p_actor IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.profiles AS profile
    WHERE profile.user_id = p_actor
      AND profile.account_id = p_account_id
      AND profile.account_role IN ('owner', 'admin')
  ) THEN
    RAISE EXCEPTION 'An account admin is required';
  END IF;
  IF p_note IS NULL OR length(btrim(p_note)) < 3 OR length(btrim(p_note)) > 500 THEN
    RAISE EXCEPTION 'A resolution note between 3 and 500 characters is required';
  END IF;

  UPDATE public.gateway_charge_exceptions
  SET status = 'ignored',
      resolved_at = clock_timestamp(),
      resolved_by = p_actor,
      resolution_note = left(btrim(p_note), 500),
      next_retry_at = NULL,
      recovery_owner = NULL,
      recovery_lease_until = NULL,
      last_recovery_error = NULL,
      last_seen_at = clock_timestamp()
  WHERE id = p_exception_id
    AND account_id = p_account_id
    AND gateway = 'razorpay'
    AND status = 'open'
    AND reason_code = 'provider_charge_missing_webhook'
  RETURNING id INTO v_updated;

  IF v_updated IS NULL THEN
    RAISE EXCEPTION 'The provider-discovered Razorpay charge is no longer open';
  END IF;

  RETURN jsonb_build_object(
    'outcome', 'ignored',
    'exception_id', v_updated
  );
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_razorpay_provider_charge_exception(
  UUID, UUID, UUID, TEXT
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ignore_razorpay_provider_charge_exception(
  UUID, UUID, UUID, TEXT
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.resolve_razorpay_provider_charge_exception(
  UUID, UUID, UUID, TEXT
) TO service_role;
GRANT EXECUTE ON FUNCTION public.ignore_razorpay_provider_charge_exception(
  UUID, UUID, UUID, TEXT
) TO service_role;
