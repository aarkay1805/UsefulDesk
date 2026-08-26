-- Close the remaining P2 Razorpay integrity gaps without trusting browser
-- writes: retain provider-authored payment time and audit admin mandate
-- cancellation after the provider has confirmed a terminal subscription.

ALTER TABLE public.gateway_payment_exceptions
  ADD COLUMN IF NOT EXISTS provider_created_at TIMESTAMPTZ;

ALTER TABLE public.payment_mandates
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;

ALTER TABLE public.payment_mandates
  DROP CONSTRAINT IF EXISTS payment_mandates_cancellation_reason_check;
ALTER TABLE public.payment_mandates
  ADD CONSTRAINT payment_mandates_cancellation_reason_check CHECK (
    cancellation_reason IS NULL
    OR length(btrim(cancellation_reason)) BETWEEN 3 AND 500
  );

-- A correctly signed application event can arrive before its OAuth merchant
-- mapping is present. Keep its canonical event failed/unprocessed, then bind
-- it only when the exact mode + external merchant appears and let the normal
-- leased recovery worker process it.
CREATE OR REPLACE FUNCTION public.claim_razorpay_webhook_recovery_batch(
  p_provider_mode TEXT,
  p_processing_owner UUID,
  p_limit INTEGER DEFAULT 100,
  p_lease_seconds INTEGER DEFAULT 300
)
RETURNS TABLE(
  event_id TEXT,
  account_id UUID,
  event_type TEXT,
  payload JSONB,
  external_account_id TEXT,
  event_identity_source TEXT,
  payload_sha256 TEXT,
  attempt_count INTEGER,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.webhook_events AS event
  SET account_id = credentials.account_id,
      processing_status = 'pending',
      next_attempt_at = clock_timestamp(),
      last_error = COALESCE(
        event.last_error,
        'Razorpay merchant mapping became available for recovery'
      )
  FROM public.account_payment_credentials AS credentials
  WHERE event.gateway = 'razorpay'
    AND event.account_id IS NULL
    AND event.provider_mode = p_provider_mode
    AND event.external_account_id IS NOT NULL
    AND event.processed_at IS NULL
    AND credentials.gateway = 'razorpay'
    AND credentials.authentication_mode = 'oauth'
    AND credentials.provider_mode = event.provider_mode
    AND credentials.razorpay_account_id = event.external_account_id;

  RETURN QUERY
  WITH candidates AS (
    SELECT event.id
    FROM public.webhook_events AS event
    WHERE event.gateway = 'razorpay'
      AND event.provider_mode = p_provider_mode
      AND event.external_account_id IS NOT NULL
      AND event.event_identity_source IS NOT NULL
      AND event.payload_sha256 IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.account_payment_credentials AS credentials
        WHERE credentials.account_id = event.account_id
          AND credentials.gateway = 'razorpay'
          AND credentials.provider_mode = event.provider_mode
          AND credentials.razorpay_account_id = event.external_account_id
      )
      AND event.processed_at IS NULL
      AND (
        (
          event.processing_status IN ('pending', 'failed')
          AND (
            event.next_attempt_at IS NULL
            OR event.next_attempt_at <= clock_timestamp()
          )
        )
        OR event.processing_started_at IS NULL
        OR event.processing_started_at
          < clock_timestamp()
            - make_interval(
                secs => LEAST(GREATEST(p_lease_seconds, 30), 300)
              )
      )
    ORDER BY event.created_at, event.id
    LIMIT LEAST(GREATEST(p_limit, 1), 100)
    FOR UPDATE OF event SKIP LOCKED
  ), claimed AS (
    UPDATE public.webhook_events AS event
    SET processing_status = 'processing',
        attempt_count = event.attempt_count + 1,
        last_attempt_at = clock_timestamp(),
        processing_started_at = clock_timestamp(),
        processing_owner = p_processing_owner,
        next_attempt_at = NULL,
        last_error = NULL
    FROM candidates
    WHERE event.id = candidates.id
    RETURNING event.*
  )
  SELECT
    claimed.id,
    claimed.account_id,
    claimed.type,
    claimed.payload,
    claimed.external_account_id,
    claimed.event_identity_source,
    claimed.payload_sha256,
    claimed.attempt_count,
    claimed.created_at
  FROM claimed
  ORDER BY claimed.created_at, claimed.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.stamp_razorpay_gateway_charge_provider_time(
  p_account_id UUID,
  p_gateway_payment_id TEXT,
  p_payment_id UUID,
  p_exception_id UUID,
  p_provider_created_at TIMESTAMPTZ
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_rows INTEGER;
BEGIN
  IF p_provider_created_at IS NULL
     OR p_provider_created_at > clock_timestamp() + interval '5 minutes'
     OR p_gateway_payment_id IS NULL
     OR btrim(p_gateway_payment_id) = ''
     OR (p_payment_id IS NULL) = (p_exception_id IS NULL) THEN
    RAISE EXCEPTION 'Invalid recurring-charge provider timestamp identity';
  END IF;

  IF p_payment_id IS NOT NULL THEN
    UPDATE public.payments
    SET paid_at = p_provider_created_at
    WHERE id = p_payment_id
      AND account_id = p_account_id
      AND source = 'auto'
      AND gateway_payment_id = p_gateway_payment_id;
  ELSE
    UPDATE public.gateway_charge_exceptions
    SET gateway_paid_at = p_provider_created_at
    WHERE id = p_exception_id
      AND account_id = p_account_id
      AND gateway = 'razorpay'
      AND gateway_payment_id = p_gateway_payment_id;
  END IF;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows = 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.stamp_razorpay_payment_link_provider_time(
  p_account_id UUID,
  p_payment_link_id UUID,
  p_gateway_payment_id TEXT,
  p_payment_id UUID,
  p_exception_id UUID,
  p_provider_created_at TIMESTAMPTZ
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_rows INTEGER;
BEGIN
  IF p_provider_created_at IS NULL
     OR p_provider_created_at > clock_timestamp() + interval '5 minutes'
     OR p_gateway_payment_id IS NULL
     OR btrim(p_gateway_payment_id) = ''
     OR (p_payment_id IS NULL) = (p_exception_id IS NULL) THEN
    RAISE EXCEPTION 'Invalid Payment Link provider timestamp identity';
  END IF;

  IF p_payment_id IS NOT NULL THEN
    UPDATE public.payments AS payment
    SET paid_at = p_provider_created_at
    FROM public.razorpay_payment_links AS link
    WHERE payment.id = p_payment_id
      AND payment.account_id = p_account_id
      AND payment.source = 'payment_link'
      AND payment.gateway_payment_id = p_gateway_payment_id
      AND link.id = p_payment_link_id
      AND link.account_id = p_account_id
      AND payment.gateway_metadata->>'payment_link_id' = link.gateway_link_id;
  ELSE
    UPDATE public.gateway_payment_exceptions
    SET provider_created_at = p_provider_created_at
    WHERE id = p_exception_id
      AND account_id = p_account_id
      AND payment_link_id = p_payment_link_id
      AND gateway_payment_id = p_gateway_payment_id;
  END IF;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RETURN FALSE; END IF;

  UPDATE public.razorpay_payment_links
  SET paid_at = p_provider_created_at,
      updated_at = clock_timestamp()
  WHERE id = p_payment_link_id
    AND account_id = p_account_id
    AND status = 'paid';

  RETURN FOUND;
END;
$$;

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

REVOKE ALL ON FUNCTION public.stamp_razorpay_gateway_charge_provider_time(
  UUID, TEXT, UUID, UUID, TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_razorpay_webhook_recovery_batch(
  TEXT, UUID, INTEGER, INTEGER
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.stamp_razorpay_payment_link_provider_time(
  UUID, UUID, TEXT, UUID, UUID, TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finalize_razorpay_mandate_cancellation(
  UUID, UUID, TEXT, TEXT, TEXT, UUID, TEXT
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.stamp_razorpay_gateway_charge_provider_time(
  UUID, TEXT, UUID, UUID, TIMESTAMPTZ
) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_razorpay_webhook_recovery_batch(
  TEXT, UUID, INTEGER, INTEGER
) TO service_role;
GRANT EXECUTE ON FUNCTION public.stamp_razorpay_payment_link_provider_time(
  UUID, UUID, TEXT, UUID, UUID, TIMESTAMPTZ
) TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_razorpay_mandate_cancellation(
  UUID, UUID, TEXT, TEXT, TEXT, UUID, TEXT
) TO service_role;
