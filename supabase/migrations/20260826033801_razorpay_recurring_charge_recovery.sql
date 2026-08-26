-- Recover provider-confirmed recurring charges that arrived ahead of an
-- earlier charge. Only the immediately next paid_count is eligible, and the
-- replay remains atomic with record_gateway_charge's ledger transaction.

ALTER TABLE public.gateway_charge_exceptions
  ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ DEFAULT now(),
  ADD COLUMN IF NOT EXISTS recovery_owner UUID,
  ADD COLUMN IF NOT EXISTS recovery_lease_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_recovery_error TEXT;

CREATE INDEX IF NOT EXISTS idx_gateway_charge_exceptions_recovery
  ON public.gateway_charge_exceptions(next_retry_at, account_id, mandate_id, provider_paid_count)
  WHERE status = 'open' AND reason_code = 'charge_sequence_mismatch';

CREATE OR REPLACE FUNCTION public.claim_gateway_charge_exception_recovery_batch(
  p_provider_mode TEXT,
  p_recovery_owner UUID,
  p_limit INTEGER DEFAULT 100,
  p_lease_seconds INTEGER DEFAULT 300
)
RETURNS TABLE(
  id UUID,
  account_id UUID,
  mandate_id UUID,
  provider_paid_count INTEGER,
  first_seen_at TIMESTAMPTZ
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
  IF p_limit < 1 OR p_limit > 100 THEN
    RAISE EXCEPTION 'Recovery batch limit must be between 1 and 100';
  END IF;
  IF p_lease_seconds < 30 OR p_lease_seconds > 900 THEN
    RAISE EXCEPTION 'Recovery lease must be between 30 and 900 seconds';
  END IF;

  RETURN QUERY
  WITH candidates AS (
    SELECT exception.id
    FROM public.gateway_charge_exceptions AS exception
    JOIN public.payment_mandates AS mandate
      ON mandate.id = exception.mandate_id
     AND mandate.account_id = exception.account_id
    JOIN public.account_payment_credentials AS credential
      ON credential.account_id = exception.account_id
     AND credential.gateway = 'razorpay'
    WHERE exception.status = 'open'
      AND exception.reason_code = 'charge_sequence_mismatch'
      AND exception.next_retry_at IS NOT NULL
      AND exception.next_retry_at <= now()
      AND (
        exception.recovery_lease_until IS NULL
        OR exception.recovery_lease_until < now()
      )
      AND exception.provider_paid_count = mandate.last_applied_paid_count + 1
      AND mandate.status IN ('pending', 'active')
      AND credential.authentication_mode = 'oauth'
      AND credential.connection_status = 'ready'
      AND credential.provider_mode = p_provider_mode
    ORDER BY exception.account_id, exception.mandate_id,
      exception.provider_paid_count, exception.first_seen_at
    LIMIT p_limit
    FOR UPDATE OF exception SKIP LOCKED
  ), claimed AS (
    UPDATE public.gateway_charge_exceptions AS exception
    SET recovery_owner = p_recovery_owner,
        recovery_lease_until = now() + make_interval(secs => p_lease_seconds),
        last_recovery_error = NULL
    FROM candidates
    WHERE exception.id = candidates.id
    RETURNING exception.id, exception.account_id, exception.mandate_id,
      exception.provider_paid_count, exception.first_seen_at
  )
  SELECT claimed.id, claimed.account_id, claimed.mandate_id,
    claimed.provider_paid_count, claimed.first_seen_at
  FROM claimed
  ORDER BY claimed.account_id, claimed.mandate_id,
    claimed.provider_paid_count, claimed.first_seen_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.recover_gateway_charge_exception(
  p_exception_id UUID,
  p_recovery_owner UUID
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_exception public.gateway_charge_exceptions%ROWTYPE;
  v_original_gateway_payment_id TEXT;
  v_outcome TEXT;
  v_payment_id UUID;
  v_new_exception_id UUID;
BEGIN
  SELECT * INTO v_exception
  FROM public.gateway_charge_exceptions
  WHERE id = p_exception_id
    AND status = 'open'
    AND reason_code = 'charge_sequence_mismatch'
    AND recovery_owner = p_recovery_owner
    AND recovery_lease_until >= now()
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'The recurring charge exception lease is missing or expired';
  END IF;

  v_original_gateway_payment_id := v_exception.gateway_payment_id;

  -- Keep the original audit row while temporarily releasing its unique
  -- provider-payment key so record_gateway_charge can re-evaluate the facts.
  UPDATE public.gateway_charge_exceptions
  SET gateway_payment_id = v_original_gateway_payment_id
    || ':recovery:' || p_exception_id::TEXT
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

  IF v_outcome = 'applied' THEN
    UPDATE public.gateway_charge_exceptions
    SET gateway_payment_id = v_original_gateway_payment_id,
        status = 'resolved',
        resolved_at = now(),
        resolved_by = NULL,
        resolution_note = 'Recovered automatically after the earlier Razorpay charge was applied.',
        last_seen_at = now(),
        attempt_count = v_exception.attempt_count + 1,
        next_retry_at = NULL,
        recovery_owner = NULL,
        recovery_lease_until = NULL,
        last_recovery_error = NULL
    WHERE id = p_exception_id;
    RETURN 'applied';
  END IF;

  IF v_outcome <> 'exception' OR v_new_exception_id IS NULL THEN
    RAISE EXCEPTION 'Recurring charge replay returned an invalid outcome';
  END IF;

  -- record_gateway_charge preserved the latest reason under a fresh row.
  -- Keep that latest diagnosis but restore the stable exception id and age.
  DELETE FROM public.gateway_charge_exceptions
  WHERE id = p_exception_id;

  UPDATE public.gateway_charge_exceptions
  SET id = p_exception_id,
      first_seen_at = v_exception.first_seen_at,
      attempt_count = v_exception.attempt_count + 1,
      next_retry_at = CASE
        WHEN reason_code = 'charge_sequence_mismatch'
          THEN now() + interval '15 minutes'
        ELSE NULL
      END,
      recovery_owner = NULL,
      recovery_lease_until = NULL,
      last_recovery_error = reason_message
  WHERE id = v_new_exception_id;

  RETURN 'deferred';
END;
$$;

CREATE OR REPLACE FUNCTION public.fail_gateway_charge_exception_recovery(
  p_exception_id UUID,
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
  UPDATE public.gateway_charge_exceptions
  SET attempt_count = attempt_count + 1,
      next_retry_at = now() + make_interval(
        secs => LEAST(86400, 60 * (2 ^ LEAST(attempt_count, 8))::INTEGER)
      ),
      recovery_owner = NULL,
      recovery_lease_until = NULL,
      last_recovery_error = left(COALESCE(p_error, 'Unknown recovery error'), 1000),
      last_seen_at = now()
  WHERE id = p_exception_id
    AND status = 'open'
    AND recovery_owner = p_recovery_owner
  RETURNING id INTO v_updated;

  RETURN v_updated IS NOT NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_gateway_charge_exception_recovery_batch(TEXT, UUID, INTEGER, INTEGER)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.recover_gateway_charge_exception(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fail_gateway_charge_exception_recovery(UUID, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.claim_gateway_charge_exception_recovery_batch(TEXT, UUID, INTEGER, INTEGER)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.recover_gateway_charge_exception(UUID, UUID)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_gateway_charge_exception_recovery(UUID, UUID, TEXT)
  TO service_role;
