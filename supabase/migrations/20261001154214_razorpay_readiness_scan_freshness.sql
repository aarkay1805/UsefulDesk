-- Keep unknown-merchant readiness verification coupled to its 24-hour validity.
-- Does not weaken connection readiness, rotate tokens, or invoke the provider.
CREATE OR REPLACE FUNCTION public.claim_razorpay_oauth_refresh_scan_batch(
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
      AND (
        credentials.oauth_refresh_scan_due_at <= clock_timestamp()
        OR (
          -- Unknown merchant readiness is usable for only 24 hours. A later
          -- daily token scan must not leave recovery blocked until its own due
          -- time. Override that time once; an attempted scan after expiry keeps
          -- the existing six-hour error backoff authoritative.
          credentials.merchant_status = 'unknown'
          AND (
            credentials.activation_verified_at IS NULL
            OR credentials.activation_verified_at < clock_timestamp() - INTERVAL '24 hours'
          )
          AND (
            credentials.last_oauth_refresh_scan_at IS NULL
            OR credentials.last_oauth_refresh_scan_at <= credentials.activation_verified_at + INTERVAL '24 hours'
          )
        )
      )
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

REVOKE ALL ON FUNCTION public.claim_razorpay_oauth_refresh_scan_batch(TEXT, UUID, INTEGER, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_razorpay_oauth_refresh_scan_batch(TEXT, UUID, INTEGER, INTEGER)
  TO service_role;
