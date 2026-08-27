-- Database-owned production scheduler. GitHub Actions remains a redundant
-- pinger and alert surface, but GitHub documents that schedule events can be
-- delayed or dropped. Supabase Cron gives the operational routes an
-- independent minute-level trigger on an existing production dependency.

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net;

GRANT USAGE ON SCHEMA cron TO postgres;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA cron TO postgres;

CREATE TABLE IF NOT EXISTS private.database_cron_auth (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  secret_hash TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE private.database_cron_auth ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.database_cron_auth
  FROM PUBLIC, anon, authenticated, service_role;

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
    v_secret := ENCODE(extensions.gen_random_bytes(32), 'hex');
    PERFORM vault.create_secret(
      v_secret,
      'usefuldesk_database_cron_secret',
      'Database-generated secret for the UsefulDesk production cron aggregator'
    );
  END IF;

  INSERT INTO private.database_cron_auth (singleton, secret_hash, updated_at)
  VALUES (
    TRUE,
    extensions.crypt(v_secret, extensions.gen_salt('bf', 10)),
    NOW()
  )
  ON CONFLICT (singleton) DO UPDATE
  SET secret_hash = EXCLUDED.secret_hash,
      updated_at = EXCLUDED.updated_at;
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
      WHERE extensions.crypt(p_secret, auth.secret_hash) = auth.secret_hash
    ),
    FALSE
  );
$$;

ALTER FUNCTION public.verify_database_cron_secret(TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.verify_database_cron_secret(TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.verify_database_cron_secret(TEXT)
  FROM service_role;
GRANT EXECUTE ON FUNCTION public.verify_database_cron_secret(TEXT) TO service_role;

SELECT cron.schedule(
  'usefuldesk-ops-cron',
  '8,23,38,53 * * * *',
  $command$
    SELECT net.http_get(
      url := 'https://desk.usefulmade.com/api/database-cron?group=ops',
      headers := jsonb_build_object(
        'x-database-cron-secret',
        (
          SELECT decrypted_secret
          FROM vault.decrypted_secrets
          WHERE name = 'usefuldesk_database_cron_secret'
          LIMIT 1
        )
      ),
      timeout_milliseconds := 60000
    ) AS request_id;
  $command$
);

SELECT cron.schedule(
  'usefuldesk-renewals-cron',
  '41 * * * *',
  $command$
    SELECT net.http_get(
      url := 'https://desk.usefulmade.com/api/database-cron?group=renewals',
      headers := jsonb_build_object(
        'x-database-cron-secret',
        (
          SELECT decrypted_secret
          FROM vault.decrypted_secrets
          WHERE name = 'usefuldesk_database_cron_secret'
          LIMIT 1
        )
      ),
      timeout_milliseconds := 60000
    ) AS request_id;
  $command$
);

-- The application route must reach Production before these jobs can be
-- activated. A follow-up migration activates both jobs after deployment.
SELECT cron.alter_job(
  job_id := (
    SELECT jobid FROM cron.job WHERE jobname = 'usefuldesk-ops-cron'
  ),
  active := FALSE
);

SELECT cron.alter_job(
  job_id := (
    SELECT jobid FROM cron.job WHERE jobname = 'usefuldesk-renewals-cron'
  ),
  active := FALSE
);

COMMENT ON TABLE private.database_cron_auth IS
  'Service-only verifier state for the database-owned production cron aggregator.';
COMMENT ON FUNCTION public.verify_database_cron_secret(TEXT) IS
  'Service-role-only verifier for the Vault-held database cron secret.';
