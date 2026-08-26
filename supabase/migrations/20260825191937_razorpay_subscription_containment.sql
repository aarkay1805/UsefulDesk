-- Contain high-risk Razorpay lifecycle gaps before broader reconciliation work.
-- Transient provider state is stored separately from UsefulDesk's local
-- mandate lifecycle so a retrying charge never becomes a terminal failure.

ALTER TABLE public.payment_mandates
  ADD COLUMN IF NOT EXISTS provider_subscription_status TEXT,
  ADD COLUMN IF NOT EXISTS provider_status_updated_at TIMESTAMPTZ;

ALTER TABLE public.payment_mandates
  DROP CONSTRAINT IF EXISTS payment_mandates_provider_subscription_status_check;
ALTER TABLE public.payment_mandates
  ADD CONSTRAINT payment_mandates_provider_subscription_status_check CHECK (
    provider_subscription_status IS NULL
    OR provider_subscription_status IN (
      'pending', 'halted', 'authenticated', 'active', 'cancelled',
      'completed', 'expired'
    )
  );

CREATE OR REPLACE FUNCTION public.record_razorpay_mandate_provider_status(
  p_mandate_id UUID,
  p_provider_status TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF p_provider_status NOT IN ('pending', 'halted', 'authenticated', 'active', 'cancelled', 'completed', 'expired') THEN
    RAISE EXCEPTION 'Invalid Razorpay subscription status';
  END IF;

  UPDATE public.payment_mandates
  SET provider_subscription_status = p_provider_status,
      provider_status_updated_at = clock_timestamp()
  WHERE id = p_mandate_id
    AND gateway = 'razorpay';

  RETURN FOUND;
END;
$$;

-- Terminal local states are sticky. Out-of-order provider events may add a
-- newer provider fact, but they cannot reopen a locally ended mandate.
CREATE OR REPLACE FUNCTION public.revoke_mandate(
  p_mandate_id UUID,
  p_status TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_mandate public.payment_mandates%ROWTYPE;
BEGIN
  IF p_status NOT IN ('paused', 'revoked', 'expired', 'failed') THEN
    RAISE EXCEPTION 'Invalid mandate end state';
  END IF;

  SELECT * INTO v_mandate
  FROM public.payment_mandates
  WHERE id = p_mandate_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Mandate not found'; END IF;

  IF v_mandate.status IN ('revoked', 'expired', 'failed') THEN
    RETURN p_mandate_id;
  END IF;

  UPDATE public.payment_mandates
  SET status = p_status
  WHERE id = p_mandate_id;

  UPDATE public.memberships AS membership
  SET collection_mode = 'manual'
  WHERE membership.id = v_mandate.membership_id
    AND NOT EXISTS (
      SELECT 1
      FROM public.payment_mandates AS mandate
      WHERE mandate.membership_id = membership.id
        AND mandate.status = 'active'
    );

  RETURN p_mandate_id;
END;
$$;

-- Keep the external merchant id as an ingress/reconciliation tombstone, but
-- remove every token that could otherwise be reused after provider revocation.
CREATE OR REPLACE FUNCTION public.mark_razorpay_oauth_authorization_revoked(
  p_account_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH changed AS (
    UPDATE public.account_payment_credentials
    SET oauth_access_token = NULL,
        oauth_refresh_token = NULL,
        oauth_access_expires_at = NULL,
        oauth_refresh_expires_at = NULL,
        oauth_scope = NULL,
        connection_status = 'reconnect_required',
        refresh_lease_owner = NULL,
        refresh_lease_until = NULL,
        oauth_refresh_scan_lease_owner = NULL,
        oauth_refresh_scan_lease_until = NULL,
        last_verified_at = clock_timestamp(),
        last_error = 'Razorpay revoked this application authorization; reconnect is required'
    WHERE account_id = p_account_id
      AND gateway = 'razorpay'
      AND authentication_mode = 'oauth'
    RETURNING account_id
  )
  SELECT EXISTS (SELECT 1 FROM changed);
$$;

-- Lock the credential row, check every provider-dependent queue, then block
-- new connection lookups by moving the row to disconnecting in one transaction.
CREATE OR REPLACE FUNCTION public.begin_razorpay_oauth_disconnect(
  p_account_id UUID,
  p_provider_mode TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_credentials public.account_payment_credentials%ROWTYPE;
BEGIN
  SELECT * INTO v_credentials
  FROM public.account_payment_credentials
  WHERE account_id = p_account_id
    AND gateway = 'razorpay'
    AND authentication_mode = 'oauth'
  FOR UPDATE;

  IF NOT FOUND OR v_credentials.connection_status = 'disconnected' THEN
    RETURN 'already_disconnected';
  END IF;
  IF v_credentials.provider_mode IS DISTINCT FROM p_provider_mode THEN
    RAISE EXCEPTION 'Razorpay provider mode mismatch';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.payment_mandates
    WHERE account_id = p_account_id
      AND status IN ('creating', 'pending', 'active', 'paused', 'orphaned')
  ) THEN RETURN 'active_mandate'; END IF;

  IF EXISTS (
    SELECT 1 FROM public.razorpay_payment_links
    WHERE account_id = p_account_id
      AND status IN ('creating', 'created', 'cancel_requested', 'orphaned')
  ) THEN RETURN 'active_payment_link'; END IF;

  IF EXISTS (
    SELECT 1 FROM public.payment_refunds
    WHERE account_id = p_account_id
      AND status IN ('creating', 'pending', 'orphaned')
  ) THEN RETURN 'active_refund'; END IF;

  IF EXISTS (
    SELECT 1 FROM public.webhook_events
    WHERE account_id = p_account_id
      AND gateway = 'razorpay'
      AND processed_at IS NULL
  ) THEN RETURN 'pending_webhook'; END IF;

  IF EXISTS (
    SELECT 1 FROM public.gateway_charge_exceptions
    WHERE account_id = p_account_id AND status = 'open'
  ) THEN RETURN 'open_charge_exception'; END IF;

  IF EXISTS (
    SELECT 1 FROM public.gateway_payment_exceptions
    WHERE account_id = p_account_id AND status = 'open'
  ) THEN RETURN 'open_payment_exception'; END IF;

  IF EXISTS (
    SELECT 1 FROM public.gateway_refund_exceptions
    WHERE account_id = p_account_id AND resolved_at IS NULL
  ) THEN RETURN 'open_refund_exception'; END IF;

  UPDATE public.account_payment_credentials
  SET connection_status = 'disconnecting',
      last_error = NULL
  WHERE account_id = p_account_id
    AND gateway = 'razorpay'
    AND authentication_mode = 'oauth';

  RETURN 'started';
END;
$$;

-- The daily OAuth scan also carries readiness age, allowing the recovery
-- worker to re-verify imported merchants whose capability proof expired.
DROP FUNCTION IF EXISTS public.claim_razorpay_oauth_refresh_scan_batch(
  TEXT, UUID, INTEGER, INTEGER
);
CREATE FUNCTION public.claim_razorpay_oauth_refresh_scan_batch(
  p_provider_mode TEXT,
  p_lease_owner UUID,
  p_limit INTEGER DEFAULT 100,
  p_lease_seconds INTEGER DEFAULT 300
)
RETURNS TABLE(
  account_id UUID,
  oauth_access_expires_at TIMESTAMPTZ,
  activation_verified_at TIMESTAMPTZ,
  merchant_status TEXT
)
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH candidates AS (
    SELECT credentials.account_id
    FROM public.account_payment_credentials AS credentials
    WHERE credentials.gateway = 'razorpay'
      AND credentials.authentication_mode = 'oauth'
      AND credentials.provider_mode = p_provider_mode
      AND credentials.connection_status = 'ready'
      AND credentials.oauth_access_expires_at IS NOT NULL
      AND credentials.oauth_refresh_expires_at IS NOT NULL
      AND credentials.oauth_refresh_scan_due_at <= clock_timestamp()
      AND (
        credentials.oauth_refresh_scan_lease_until IS NULL
        OR credentials.oauth_refresh_scan_lease_until <= clock_timestamp()
      )
    ORDER BY credentials.oauth_refresh_scan_due_at, credentials.account_id
    LIMIT LEAST(GREATEST(p_limit, 1), 100)
    FOR UPDATE OF credentials SKIP LOCKED
  ), claimed AS (
    UPDATE public.account_payment_credentials AS credentials
    SET oauth_refresh_scan_lease_owner = p_lease_owner,
        oauth_refresh_scan_lease_until = clock_timestamp()
          + make_interval(secs => LEAST(GREATEST(p_lease_seconds, 30), 300))
    FROM candidates
    WHERE credentials.account_id = candidates.account_id
    RETURNING
      credentials.account_id,
      credentials.oauth_access_expires_at,
      credentials.activation_verified_at,
      credentials.merchant_status
  )
  SELECT
    claimed.account_id,
    claimed.oauth_access_expires_at,
    claimed.activation_verified_at,
    claimed.merchant_status
  FROM claimed
  ORDER BY claimed.account_id;
$$;

REVOKE ALL ON FUNCTION public.record_razorpay_mandate_provider_status(UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.revoke_mandate(UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_razorpay_oauth_authorization_revoked(UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.begin_razorpay_oauth_disconnect(UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_razorpay_oauth_refresh_scan_batch(TEXT, UUID, INTEGER, INTEGER)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.record_razorpay_mandate_provider_status(UUID, TEXT)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.revoke_mandate(UUID, TEXT)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_razorpay_oauth_authorization_revoked(UUID)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.begin_razorpay_oauth_disconnect(UUID, TEXT)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_razorpay_oauth_refresh_scan_batch(TEXT, UUID, INTEGER, INTEGER)
  TO service_role;
