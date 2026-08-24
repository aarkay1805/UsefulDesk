-- Server-owned Live OAuth rollout authority. This replaces the one-account
-- environment pin without exposing enrollment controls to browser roles.

CREATE TABLE IF NOT EXISTS public.razorpay_live_rollout_accounts (
  account_id UUID PRIMARY KEY REFERENCES public.accounts(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  first_bind_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  merchant_id TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT razorpay_live_rollout_merchant_id_check
    CHECK (merchant_id IS NULL OR merchant_id ~ '^acc_[A-Za-z0-9]+$'),
  CONSTRAINT razorpay_live_rollout_first_bind_check
    CHECK (
      NOT first_bind_enabled
      OR (enabled = TRUE AND merchant_id IS NULL)
    )
);

ALTER TABLE public.razorpay_live_rollout_accounts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.razorpay_live_rollout_accounts
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.razorpay_live_rollout_accounts FROM service_role;
GRANT SELECT, UPDATE ON TABLE public.razorpay_live_rollout_accounts TO service_role;

DROP TRIGGER IF EXISTS update_razorpay_live_rollout_accounts_updated_at
  ON public.razorpay_live_rollout_accounts;
CREATE TRIGGER update_razorpay_live_rollout_accounts_updated_at
  BEFORE UPDATE ON public.razorpay_live_rollout_accounts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Seed only where the exact account exists so the same migration remains safe
-- in isolated environments that do not contain Production account identities.
INSERT INTO public.razorpay_live_rollout_accounts (
  account_id,
  enabled,
  first_bind_enabled,
  merchant_id
)
SELECT seed.account_id, seed.enabled, seed.first_bind_enabled, seed.merchant_id
FROM (
  VALUES
    ('50a9e8f9-d7e5-44d2-ba04-c367509b981e'::UUID, TRUE, FALSE, 'acc_TCJwBqanN9LTrK'),
    ('9c50dcd9-ed4a-427c-a2fc-07d452f0aec7'::UUID, TRUE, TRUE, NULL)
) AS seed(account_id, enabled, first_bind_enabled, merchant_id)
WHERE EXISTS (
  SELECT 1
  FROM public.accounts account
  WHERE account.id = seed.account_id
)
ON CONFLICT (account_id) DO UPDATE
SET enabled = EXCLUDED.enabled,
    first_bind_enabled = CASE
      WHEN public.razorpay_live_rollout_accounts.merchant_id IS NULL
        THEN EXCLUDED.first_bind_enabled
      ELSE FALSE
    END,
    merchant_id = COALESCE(
      public.razorpay_live_rollout_accounts.merchant_id,
      EXCLUDED.merchant_id
    ),
    updated_at = NOW();

CREATE OR REPLACE FUNCTION public.claim_razorpay_live_rollout_merchant(
  p_account_id UUID,
  p_merchant_id TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_claimed BOOLEAN := FALSE;
BEGIN
  IF p_merchant_id IS NULL OR p_merchant_id !~ '^acc_[A-Za-z0-9]+$' THEN
    RETURN FALSE;
  END IF;

  UPDATE public.razorpay_live_rollout_accounts
  SET merchant_id = p_merchant_id,
      first_bind_enabled = FALSE,
      updated_at = NOW()
  WHERE account_id = p_account_id
    AND (
      merchant_id = p_merchant_id
      OR (
        merchant_id IS NULL
        AND first_bind_enabled = TRUE
        AND enabled = TRUE
      )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.account_payment_credentials credential
      WHERE credential.gateway = 'razorpay'
        AND credential.provider_mode = 'live'
        AND credential.razorpay_account_id = p_merchant_id
        AND credential.account_id <> p_account_id
    )
  RETURNING TRUE INTO v_claimed;

  RETURN COALESCE(v_claimed, FALSE);
END;
$$;

REVOKE ALL ON FUNCTION public.claim_razorpay_live_rollout_merchant(UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_razorpay_live_rollout_merchant(UUID, TEXT)
  FROM service_role;
GRANT EXECUTE ON FUNCTION public.claim_razorpay_live_rollout_merchant(UUID, TEXT) TO service_role;

COMMENT ON TABLE public.razorpay_live_rollout_accounts IS
  'Server-only account allowlist and exact merchant binding for staged Razorpay Live OAuth rollout.';
COMMENT ON FUNCTION public.claim_razorpay_live_rollout_merchant(UUID, TEXT) IS
  'Atomically binds the first provider-issued merchant for one explicitly enabled rollout account.';
