-- Razorpay Stage 6: OAuth is the only supported merchant authentication path.
-- Historical legacy delivery/cutover evidence remains immutable, but no live
-- credential row may store a manual key or select per-account webhook ingress.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.account_payment_credentials
    WHERE gateway = 'razorpay'
      AND (
        authentication_mode IS DISTINCT FROM 'oauth'
        OR secret_storage_version IS DISTINCT FROM 1
        OR canonical_webhook_ingress IS DISTINCT FROM 'application'
        OR provider_mode IS NULL
      )
  ) THEN
    RAISE EXCEPTION
      'Razorpay Stage 6 requires every credential row to be OAuth/storage-v1/application-canonical';
  END IF;
END;
$$;

-- Secret-blind retirement: both accepted databases were inventoried before
-- this migration. Production has no manual material; the isolated Test row
-- retains only a dormant legacy webhook secret, which is erased here.
UPDATE public.account_payment_credentials
SET razorpay_key_id = NULL,
    razorpay_key_secret = NULL,
    razorpay_webhook_secret = NULL
WHERE gateway = 'razorpay'
  AND (
    razorpay_key_id IS NOT NULL
    OR razorpay_key_secret IS NOT NULL
    OR razorpay_webhook_secret IS NOT NULL
  );

ALTER TABLE public.account_payment_credentials
  ALTER COLUMN authentication_mode SET DEFAULT 'oauth',
  ALTER COLUMN secret_storage_version SET DEFAULT 1,
  ALTER COLUMN canonical_webhook_ingress SET DEFAULT 'application';

ALTER TABLE public.account_payment_credentials
  DROP CONSTRAINT IF EXISTS account_payment_credentials_authentication_mode_check;
ALTER TABLE public.account_payment_credentials
  ADD CONSTRAINT account_payment_credentials_authentication_mode_check
  CHECK (authentication_mode = 'oauth');

ALTER TABLE public.account_payment_credentials
  DROP CONSTRAINT IF EXISTS account_payment_credentials_secret_storage_version_check;
ALTER TABLE public.account_payment_credentials
  ADD CONSTRAINT account_payment_credentials_secret_storage_version_check
  CHECK (secret_storage_version = 1);

ALTER TABLE public.account_payment_credentials
  DROP CONSTRAINT IF EXISTS account_payment_credentials_canonical_ingress_check;
ALTER TABLE public.account_payment_credentials
  ADD CONSTRAINT account_payment_credentials_canonical_ingress_check
  CHECK (canonical_webhook_ingress = 'application');

ALTER TABLE public.account_payment_credentials
  DROP CONSTRAINT IF EXISTS account_payment_credentials_oauth_storage_check;
ALTER TABLE public.account_payment_credentials
  ADD CONSTRAINT account_payment_credentials_oauth_storage_check
  CHECK (
    authentication_mode = 'oauth'
    AND secret_storage_version = 1
    AND provider_mode IS NOT NULL
  );

ALTER TABLE public.account_payment_credentials
  DROP CONSTRAINT IF EXISTS account_payment_credentials_manual_material_retired_check;
ALTER TABLE public.account_payment_credentials
  ADD CONSTRAINT account_payment_credentials_manual_material_retired_check
  CHECK (
    razorpay_key_id IS NULL
    AND razorpay_key_secret IS NULL
    AND razorpay_webhook_secret IS NULL
  );

-- The reviewed cutover transactions are no longer callable. Their immutable
-- audit tables and historical delivery rows are deliberately preserved.
DROP FUNCTION IF EXISTS public.cutover_razorpay_application_webhook(
  UUID, TEXT, TEXT[], UUID
);
DROP FUNCTION IF EXISTS public.activate_razorpay_live_application_webhook(
  UUID, TEXT, UUID
);

COMMENT ON TABLE public.account_payment_credentials IS
  'Service-role-only OAuth Razorpay connections. Manual keys, plaintext storage version 0, and legacy canonical ingress are retired.';
