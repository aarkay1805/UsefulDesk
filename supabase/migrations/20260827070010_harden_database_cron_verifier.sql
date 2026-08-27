-- The scheduler credential is 256 bits of database-generated randomness, so a
-- fast digest is sufficient for storage and comparison. Avoid bcrypt here:
-- this verifier sits behind a public HTTP route, and invalid requests must not
-- amplify into deliberately expensive password-hash work.

DO $$
DECLARE
  v_secret TEXT;
BEGIN
  SELECT decrypted_secret
  INTO v_secret
  FROM vault.decrypted_secrets
  WHERE name = 'usefuldesk_database_cron_secret'
  LIMIT 1;

  IF v_secret IS NULL THEN
    RAISE EXCEPTION 'usefuldesk_database_cron_secret is missing from Vault';
  END IF;

  UPDATE private.database_cron_auth
  SET secret_hash = ENCODE(extensions.digest(v_secret, 'sha256'), 'hex'),
      updated_at = NOW()
  WHERE singleton = TRUE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'database_cron_auth verifier row is missing';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.verify_database_cron_secret(p_secret TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(
    p_secret IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM private.database_cron_auth AS auth
      WHERE extensions.digest(p_secret, 'sha256') = DECODE(auth.secret_hash, 'hex')
    ),
    FALSE
  );
$$;

ALTER FUNCTION public.verify_database_cron_secret(TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.verify_database_cron_secret(TEXT)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.verify_database_cron_secret(TEXT) TO service_role;
