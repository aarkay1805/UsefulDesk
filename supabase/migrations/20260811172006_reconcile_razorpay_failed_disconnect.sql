-- Recover an OAuth connection left in `disconnecting` only by rotating the
-- provider refresh grant and re-running readiness. The application performs
-- the provider calls; these service-role-only invoker RPCs own the exact
-- merchant, lease/generation, and final-state compare-and-set boundaries.

CREATE OR REPLACE FUNCTION public.claim_razorpay_oauth_disconnect_recovery(
  p_account_id UUID,
  p_provider_mode TEXT,
  p_external_account_id TEXT,
  p_lease_owner UUID,
  p_lease_seconds INTEGER DEFAULT 120
)
RETURNS TABLE(refresh_generation INTEGER, refresh_lease_until TIMESTAMPTZ)
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  UPDATE public.account_payment_credentials
  SET refresh_generation = account_payment_credentials.refresh_generation + 1,
      refresh_lease_owner = p_lease_owner,
      refresh_lease_until = clock_timestamp()
        + make_interval(secs => LEAST(GREATEST(p_lease_seconds, 30), 120))
  WHERE account_id = p_account_id
    AND gateway = 'razorpay'
    AND authentication_mode = 'oauth'
    AND provider_mode = p_provider_mode
    AND razorpay_account_id = p_external_account_id
    AND secret_storage_version = 1
    AND connection_status = 'disconnecting'
    AND oauth_access_token IS NOT NULL
    AND oauth_refresh_token IS NOT NULL
    AND oauth_access_expires_at IS NOT NULL
    AND oauth_refresh_expires_at IS NOT NULL
    AND 'read_write' = ANY(
      regexp_split_to_array(COALESCE(oauth_scope, ''), '[ ,]+')
    )
    AND razorpay_key_id IS NULL
    AND razorpay_key_secret IS NULL
    AND razorpay_webhook_secret IS NULL
    AND (
      account_payment_credentials.refresh_lease_until IS NULL
      OR account_payment_credentials.refresh_lease_until <= clock_timestamp()
    )
  RETURNING
    account_payment_credentials.refresh_generation,
    account_payment_credentials.refresh_lease_until;
$$;

CREATE OR REPLACE FUNCTION public.commit_razorpay_oauth_disconnect_recovery(
  p_account_id UUID,
  p_provider_mode TEXT,
  p_external_account_id TEXT,
  p_lease_owner UUID,
  p_refresh_generation INTEGER,
  p_access_token TEXT,
  p_refresh_token TEXT,
  p_access_expires_at TIMESTAMPTZ,
  p_refresh_expires_at TIMESTAMPTZ,
  p_scope TEXT,
  p_connection_status TEXT,
  p_merchant_status TEXT,
  p_activation_verified_at TIMESTAMPTZ,
  p_last_error TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH changed AS (
    UPDATE public.account_payment_credentials
    SET oauth_access_token = p_access_token,
        oauth_refresh_token = p_refresh_token,
        oauth_access_expires_at = p_access_expires_at,
        oauth_refresh_expires_at = p_refresh_expires_at,
        oauth_scope = p_scope,
        connection_status = p_connection_status,
        merchant_status = p_merchant_status,
        refresh_lease_owner = NULL,
        refresh_lease_until = NULL,
        disconnected_at = NULL,
        activation_verified_at = p_activation_verified_at,
        last_verified_at = clock_timestamp(),
        last_error = LEFT(p_last_error, 2000)
    WHERE account_id = p_account_id
      AND gateway = 'razorpay'
      AND authentication_mode = 'oauth'
      AND provider_mode = p_provider_mode
      AND razorpay_account_id = p_external_account_id
      AND secret_storage_version = 1
      AND connection_status = 'disconnecting'
      AND refresh_lease_owner = p_lease_owner
      AND refresh_generation = p_refresh_generation
      AND p_access_token <> ''
      AND p_refresh_token <> ''
      AND p_access_expires_at > clock_timestamp()
      AND p_refresh_expires_at > p_access_expires_at
      AND 'read_write' = ANY(
        regexp_split_to_array(COALESCE(p_scope, ''), '[ ,]+')
      )
      AND p_connection_status IN ('ready', 'blocked')
      AND p_merchant_status IN (
        'unknown', 'activated', 'under_review', 'needs_clarification',
        'suspended', 'rejected'
      )
      AND (
        p_connection_status = 'blocked'
        OR (
          p_connection_status = 'ready'
          AND p_merchant_status IN ('unknown', 'activated')
          AND p_activation_verified_at >= clock_timestamp() - INTERVAL '5 minutes'
          AND p_activation_verified_at <= clock_timestamp() + INTERVAL '1 minute'
          AND p_last_error IS NULL
        )
      )
      AND razorpay_key_id IS NULL
      AND razorpay_key_secret IS NULL
      AND razorpay_webhook_secret IS NULL
    RETURNING account_id
  )
  SELECT EXISTS (SELECT 1 FROM changed);
$$;

CREATE OR REPLACE FUNCTION public.fail_razorpay_oauth_disconnect_recovery(
  p_account_id UUID,
  p_provider_mode TEXT,
  p_external_account_id TEXT,
  p_lease_owner UUID,
  p_refresh_generation INTEGER,
  p_error TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH changed AS (
    UPDATE public.account_payment_credentials
    SET connection_status = 'reconnect_required',
        refresh_lease_owner = NULL,
        refresh_lease_until = NULL,
        last_verified_at = clock_timestamp(),
        last_error = LEFT(
          COALESCE(p_error, 'Razorpay disconnect recovery failed'),
          2000
        )
    WHERE account_id = p_account_id
      AND gateway = 'razorpay'
      AND authentication_mode = 'oauth'
      AND provider_mode = p_provider_mode
      AND razorpay_account_id = p_external_account_id
      AND connection_status = 'disconnecting'
      AND refresh_lease_owner = p_lease_owner
      AND refresh_generation = p_refresh_generation
    RETURNING account_id
  )
  SELECT EXISTS (SELECT 1 FROM changed);
$$;

REVOKE ALL ON FUNCTION public.claim_razorpay_oauth_disconnect_recovery(
  UUID, TEXT, TEXT, UUID, INTEGER
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.commit_razorpay_oauth_disconnect_recovery(
  UUID, TEXT, TEXT, UUID, INTEGER, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ,
  TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fail_razorpay_oauth_disconnect_recovery(
  UUID, TEXT, TEXT, UUID, INTEGER, TEXT
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.claim_razorpay_oauth_disconnect_recovery(
  UUID, TEXT, TEXT, UUID, INTEGER
) TO service_role;
GRANT EXECUTE ON FUNCTION public.commit_razorpay_oauth_disconnect_recovery(
  UUID, TEXT, TEXT, UUID, INTEGER, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ,
  TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT
) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_razorpay_oauth_disconnect_recovery(
  UUID, TEXT, TEXT, UUID, INTEGER, TEXT
) TO service_role;

COMMENT ON FUNCTION public.claim_razorpay_oauth_disconnect_recovery(
  UUID, TEXT, TEXT, UUID, INTEGER
) IS 'Service-only exact-merchant lease for provider-grounded recovery of an OAuth row left disconnecting.';
