-- Razorpay OAuth Stage 1: encrypted, mode-scoped merchant connections,
-- short-lived OAuth state, and database-owned refresh single-flight leases.
--
-- This migration deliberately does not encrypt legacy manual secrets: the
-- application owns ENCRYPTION_KEY, so the version-aware server reader upgrades
-- version-0 rows and the operator backfill verifies the remainder. New manual
-- and OAuth writes always use secret_storage_version = 1.

-- ---------------------------------------------------------------------------
-- 1. OAuth initiation state. No browser role can read the state hash or the
-- encrypted PKCE verifier; callback handling uses the service role.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.razorpay_oauth_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  state_hash TEXT UNIQUE NOT NULL,
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  initiated_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id_fingerprint TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('test', 'live')),
  redirect_uri TEXT NOT NULL,
  pkce_code_verifier TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT razorpay_oauth_states_expiry_check
    CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS razorpay_oauth_states_expiry_idx
  ON public.razorpay_oauth_states (expires_at)
  WHERE consumed_at IS NULL;

ALTER TABLE public.razorpay_oauth_states ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.razorpay_oauth_states
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.razorpay_oauth_states
  TO service_role;

-- ---------------------------------------------------------------------------
-- 2. Extend the existing one-row-per-account credential boundary. Transitional
-- provider_mode nulls and version 0 are intentional until the reviewed manual
-- credential backfill is complete; every runtime credential load fails closed
-- when mode is absent or mismatched.
-- ---------------------------------------------------------------------------

ALTER TABLE public.account_payment_credentials
  ADD COLUMN IF NOT EXISTS authentication_mode TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS razorpay_account_id TEXT,
  ADD COLUMN IF NOT EXISTS provider_mode TEXT,
  ADD COLUMN IF NOT EXISTS secret_storage_version SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS oauth_access_token TEXT,
  ADD COLUMN IF NOT EXISTS oauth_refresh_token TEXT,
  ADD COLUMN IF NOT EXISTS oauth_access_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS oauth_refresh_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS oauth_scope TEXT,
  ADD COLUMN IF NOT EXISTS connection_status TEXT NOT NULL DEFAULT 'disconnected',
  ADD COLUMN IF NOT EXISTS merchant_status TEXT NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS canonical_webhook_ingress TEXT NOT NULL DEFAULT 'legacy_account',
  ADD COLUMN IF NOT EXISTS refresh_generation INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS refresh_lease_owner UUID,
  ADD COLUMN IF NOT EXISTS refresh_lease_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS connected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS disconnected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS activation_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_error TEXT;

ALTER TABLE public.account_payment_credentials
  DROP CONSTRAINT IF EXISTS account_payment_credentials_authentication_mode_check;
ALTER TABLE public.account_payment_credentials
  ADD CONSTRAINT account_payment_credentials_authentication_mode_check
  CHECK (authentication_mode IN ('manual', 'oauth'));

ALTER TABLE public.account_payment_credentials
  DROP CONSTRAINT IF EXISTS account_payment_credentials_provider_mode_check;
ALTER TABLE public.account_payment_credentials
  ADD CONSTRAINT account_payment_credentials_provider_mode_check
  CHECK (provider_mode IS NULL OR provider_mode IN ('test', 'live'));

ALTER TABLE public.account_payment_credentials
  DROP CONSTRAINT IF EXISTS account_payment_credentials_secret_storage_version_check;
ALTER TABLE public.account_payment_credentials
  ADD CONSTRAINT account_payment_credentials_secret_storage_version_check
  CHECK (secret_storage_version IN (0, 1));

ALTER TABLE public.account_payment_credentials
  DROP CONSTRAINT IF EXISTS account_payment_credentials_connection_status_check;
ALTER TABLE public.account_payment_credentials
  ADD CONSTRAINT account_payment_credentials_connection_status_check
  CHECK (connection_status IN (
    'connecting', 'ready', 'blocked', 'reconnect_required',
    'disconnecting', 'disconnected'
  ));

ALTER TABLE public.account_payment_credentials
  DROP CONSTRAINT IF EXISTS account_payment_credentials_merchant_status_check;
ALTER TABLE public.account_payment_credentials
  ADD CONSTRAINT account_payment_credentials_merchant_status_check
  CHECK (merchant_status IN (
    'unknown', 'activated', 'under_review', 'needs_clarification',
    'suspended', 'rejected'
  ));

ALTER TABLE public.account_payment_credentials
  DROP CONSTRAINT IF EXISTS account_payment_credentials_canonical_ingress_check;
ALTER TABLE public.account_payment_credentials
  ADD CONSTRAINT account_payment_credentials_canonical_ingress_check
  CHECK (canonical_webhook_ingress IN ('legacy_account', 'application'));

ALTER TABLE public.account_payment_credentials
  DROP CONSTRAINT IF EXISTS account_payment_credentials_oauth_storage_check;
ALTER TABLE public.account_payment_credentials
  ADD CONSTRAINT account_payment_credentials_oauth_storage_check
  CHECK (
    authentication_mode <> 'oauth'
    OR (secret_storage_version = 1 AND provider_mode IS NOT NULL)
  );

ALTER TABLE public.account_payment_credentials
  DROP CONSTRAINT IF EXISTS account_payment_credentials_refresh_lease_pair_check;
ALTER TABLE public.account_payment_credentials
  ADD CONSTRAINT account_payment_credentials_refresh_lease_pair_check
  CHECK (
    (refresh_lease_owner IS NULL AND refresh_lease_until IS NULL)
    OR (refresh_lease_owner IS NOT NULL AND refresh_lease_until IS NOT NULL)
  );

CREATE UNIQUE INDEX IF NOT EXISTS account_payment_credentials_provider_account_uidx
  ON public.account_payment_credentials (provider_mode, razorpay_account_id)
  WHERE razorpay_account_id IS NOT NULL;

ALTER TABLE public.account_payment_credentials ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.account_payment_credentials
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.account_payment_credentials
  TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Refresh leases. The service role owns credential access, but using RPCs
-- keeps generation changes and lease checks atomic across server instances.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.claim_razorpay_oauth_refresh(
  p_account_id UUID,
  p_provider_mode TEXT,
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
    AND connection_status = 'ready'
    AND (
      account_payment_credentials.refresh_lease_until IS NULL
      OR account_payment_credentials.refresh_lease_until <= clock_timestamp()
    )
  RETURNING
    account_payment_credentials.refresh_generation,
    account_payment_credentials.refresh_lease_until;
$$;

CREATE OR REPLACE FUNCTION public.commit_razorpay_oauth_refresh(
  p_account_id UUID,
  p_provider_mode TEXT,
  p_lease_owner UUID,
  p_refresh_generation INTEGER,
  p_access_token TEXT,
  p_refresh_token TEXT,
  p_access_expires_at TIMESTAMPTZ,
  p_refresh_expires_at TIMESTAMPTZ,
  p_scope TEXT
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
        refresh_lease_owner = NULL,
        refresh_lease_until = NULL,
        last_verified_at = clock_timestamp(),
        last_error = NULL
    WHERE account_id = p_account_id
      AND gateway = 'razorpay'
      AND authentication_mode = 'oauth'
      AND provider_mode = p_provider_mode
      AND connection_status = 'ready'
      AND secret_storage_version = 1
      AND refresh_lease_owner = p_lease_owner
      AND refresh_generation = p_refresh_generation
      AND p_access_token <> ''
      AND p_refresh_token <> ''
      AND p_access_expires_at > clock_timestamp()
      AND p_refresh_expires_at > p_access_expires_at
    RETURNING account_id
  )
  SELECT EXISTS (SELECT 1 FROM changed);
$$;

CREATE OR REPLACE FUNCTION public.mark_razorpay_oauth_reconnect_required(
  p_account_id UUID,
  p_provider_mode TEXT,
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
        last_error = LEFT(COALESCE(p_error, 'OAuth token refresh failed'), 2000)
    WHERE account_id = p_account_id
      AND gateway = 'razorpay'
      AND authentication_mode = 'oauth'
      AND provider_mode = p_provider_mode
      AND refresh_lease_owner = p_lease_owner
      AND refresh_generation = p_refresh_generation
    RETURNING account_id
  )
  SELECT EXISTS (SELECT 1 FROM changed);
$$;

REVOKE ALL ON FUNCTION public.claim_razorpay_oauth_refresh(
  UUID, TEXT, UUID, INTEGER
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.commit_razorpay_oauth_refresh(
  UUID, TEXT, UUID, INTEGER, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_razorpay_oauth_reconnect_required(
  UUID, TEXT, UUID, INTEGER, TEXT
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.claim_razorpay_oauth_refresh(
  UUID, TEXT, UUID, INTEGER
) TO service_role;
GRANT EXECUTE ON FUNCTION public.commit_razorpay_oauth_refresh(
  UUID, TEXT, UUID, INTEGER, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT
) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_razorpay_oauth_reconnect_required(
  UUID, TEXT, UUID, INTEGER, TEXT
) TO service_role;
