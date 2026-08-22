-- Meta Lead Ads proactive recovery. Additive and rollback-compatible: the
-- earlier unowned Meta webhook RPCs remain available to older application
-- versions while new workers use generation- and owner-guarded leases.

ALTER TABLE public.meta_page_config
  ADD COLUMN IF NOT EXISTS connected_meta_user_id TEXT,
  ADD COLUMN IF NOT EXISTS credential_generation INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS health_checked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_healthy_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS lead_access_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS subscription_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_repair_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS next_health_check_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS consecutive_health_failures INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS health_error_code TEXT,
  ADD COLUMN IF NOT EXISTS health_error_resolution TEXT,
  ADD COLUMN IF NOT EXISTS health_lease_owner UUID,
  ADD COLUMN IF NOT EXISTS health_lease_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS attention_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS attention_notified_at TIMESTAMPTZ;

ALTER TABLE public.meta_page_config
  ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.meta_page_config
  DROP CONSTRAINT IF EXISTS meta_page_config_user_id_fkey;
DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.meta_page_config'::regclass
      AND conname = 'meta_page_config_user_id_fkey'
  ) THEN
    ALTER TABLE public.meta_page_config
      ADD CONSTRAINT meta_page_config_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;
END
$migration$;

ALTER TABLE public.meta_page_config
  DROP CONSTRAINT IF EXISTS meta_page_config_credential_generation_check;
ALTER TABLE public.meta_page_config
  ADD CONSTRAINT meta_page_config_credential_generation_check
  CHECK (credential_generation >= 1);

ALTER TABLE public.meta_page_config
  DROP CONSTRAINT IF EXISTS meta_page_config_health_failures_check;
ALTER TABLE public.meta_page_config
  ADD CONSTRAINT meta_page_config_health_failures_check
  CHECK (consecutive_health_failures >= 0);

ALTER TABLE public.meta_page_config
  DROP CONSTRAINT IF EXISTS meta_page_config_health_lease_pair_check;
ALTER TABLE public.meta_page_config
  ADD CONSTRAINT meta_page_config_health_lease_pair_check
  CHECK (
    (health_lease_owner IS NULL AND health_lease_until IS NULL)
    OR (health_lease_owner IS NOT NULL AND health_lease_until IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS idx_meta_page_config_health_due
  ON public.meta_page_config (next_health_check_at, health_lease_until)
  WHERE status IN ('connected', 'error');

CREATE INDEX IF NOT EXISTS idx_meta_lead_webhook_recovery_due
  ON public.webhook_events (next_attempt_at, processing_started_at, created_at)
  WHERE gateway = 'meta'
    AND type = 'leadgen'
    AND processed_at IS NULL;

-- Preserve the admin-only client contract after adding health fields.
DROP POLICY IF EXISTS meta_page_config_select ON public.meta_page_config;
CREATE POLICY meta_page_config_select ON public.meta_page_config
  FOR SELECT TO authenticated
  USING (public.is_account_member(account_id, 'admin'));
DROP POLICY IF EXISTS meta_page_config_insert ON public.meta_page_config;
CREATE POLICY meta_page_config_insert ON public.meta_page_config
  FOR INSERT TO authenticated
  WITH CHECK (public.is_account_member(account_id, 'admin'));
DROP POLICY IF EXISTS meta_page_config_update ON public.meta_page_config;
CREATE POLICY meta_page_config_update ON public.meta_page_config
  FOR UPDATE TO authenticated
  USING (public.is_account_member(account_id, 'admin'))
  WITH CHECK (public.is_account_member(account_id, 'admin'));
DROP POLICY IF EXISTS meta_page_config_delete ON public.meta_page_config;
CREATE POLICY meta_page_config_delete ON public.meta_page_config
  FOR DELETE TO authenticated
  USING (public.is_account_member(account_id, 'admin'));

ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('conversation_assigned','lead_assigned','follow_up_reminder',
                  'lead_transfer_request','lead_transfer_accepted',
                  'lead_transfer_declined','lead_transfer_cancelled',
                  'lead_assignment_request','lead_assignment_approved',
                  'lead_assignment_rejected','lead_assignment_cancelled',
                  'meta_leads_attention'));

CREATE OR REPLACE FUNCTION public.claim_meta_page_health_batch(
  p_health_owner UUID,
  p_limit INTEGER,
  p_lease_seconds INTEGER,
  p_force_config_id UUID DEFAULT NULL
)
RETURNS TABLE(
  config_id UUID,
  account_id UUID,
  page_id TEXT,
  page_access_token TEXT,
  connected_meta_user_id TEXT,
  credential_generation INTEGER
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  IF p_health_owner IS NULL THEN
    RAISE EXCEPTION 'Meta Page health owner is required'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH candidates AS (
    SELECT config.id
    FROM public.meta_page_config AS config
    WHERE config.status IN ('connected', 'error')
      AND (p_force_config_id IS NULL OR config.id = p_force_config_id)
      AND (
        p_force_config_id IS NOT NULL
        OR config.next_health_check_at <= v_now
      )
      AND (
        config.health_lease_until IS NULL
        OR config.health_lease_until < v_now
      )
    ORDER BY
      CASE WHEN config.status = 'error' THEN 0 ELSE 1 END,
      config.next_health_check_at,
      config.created_at,
      config.id
    LIMIT LEAST(GREATEST(p_limit, 1), 10)
    FOR UPDATE OF config SKIP LOCKED
  ), claimed AS (
    UPDATE public.meta_page_config AS config
    SET health_lease_owner = p_health_owner,
        health_lease_until = v_now + make_interval(
          secs => LEAST(GREATEST(p_lease_seconds, 30), 300)
        )
    FROM candidates
    WHERE config.id = candidates.id
    RETURNING config.*
  )
  SELECT
    claimed.id,
    claimed.account_id,
    claimed.page_id,
    claimed.page_access_token,
    claimed.connected_meta_user_id,
    claimed.credential_generation
  FROM claimed
  ORDER BY claimed.next_health_check_at, claimed.id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.complete_meta_page_health_check(
  p_config_id UUID,
  p_account_id UUID,
  p_health_owner UUID,
  p_credential_generation INTEGER,
  p_repaired BOOLEAN DEFAULT FALSE
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_now TIMESTAMPTZ := clock_timestamp();
  v_changed UUID;
BEGIN
  UPDATE public.meta_page_config
  SET status = 'connected',
      health_checked_at = v_now,
      last_healthy_at = v_now,
      lead_access_verified_at = v_now,
      subscription_verified_at = v_now,
      last_repair_at = CASE WHEN p_repaired THEN v_now ELSE last_repair_at END,
      subscribed_at = COALESCE(subscribed_at, v_now),
      next_health_check_at = v_now + INTERVAL '6 hours',
      consecutive_health_failures = 0,
      last_error = NULL,
      health_error_code = NULL,
      health_error_resolution = NULL,
      health_lease_owner = NULL,
      health_lease_until = NULL,
      attention_started_at = NULL,
      attention_notified_at = NULL
  WHERE id = p_config_id
    AND account_id = p_account_id
    AND health_lease_owner = p_health_owner
    AND health_lease_until >= v_now
    AND credential_generation = p_credential_generation
  RETURNING id INTO v_changed;

  RETURN v_changed IS NOT NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fail_meta_page_health_check(
  p_config_id UUID,
  p_account_id UUID,
  p_health_owner UUID,
  p_credential_generation INTEGER,
  p_error_code TEXT,
  p_error_resolution TEXT,
  p_error_message TEXT,
  p_human_action BOOLEAN,
  p_transient BOOLEAN DEFAULT FALSE
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_now TIMESTAMPTZ := clock_timestamp();
  v_failure_count INTEGER;
  v_human_action BOOLEAN := COALESCE(p_human_action, FALSE);
  v_attention BOOLEAN;
  v_changed UUID;
  v_notify BOOLEAN := FALSE;
BEGIN
  SELECT consecutive_health_failures + 1
  INTO v_failure_count
  FROM public.meta_page_config
  WHERE id = p_config_id
    AND account_id = p_account_id
    AND health_lease_owner = p_health_owner
    AND health_lease_until >= v_now
    AND credential_generation = p_credential_generation
  FOR UPDATE;

  IF v_failure_count IS NULL THEN
    RETURN FALSE;
  END IF;

  v_attention := v_human_action OR v_failure_count >= 3;

  UPDATE public.meta_page_config
  SET status = CASE WHEN v_attention THEN 'error' ELSE status END,
      health_checked_at = v_now,
      next_health_check_at = CASE
        WHEN v_human_action THEN v_now + INTERVAL '1 day'
        WHEN v_failure_count <= 1 THEN v_now + INTERVAL '5 minutes'
        WHEN v_failure_count = 2 THEN v_now + INTERVAL '15 minutes'
        WHEN v_failure_count = 3 THEN v_now + INTERVAL '1 hour'
        ELSE v_now + INTERVAL '6 hours'
      END,
      consecutive_health_failures = v_failure_count,
      last_error = LEFT(
        COALESCE(NULLIF(btrim(p_error_message), ''), 'Meta lead capture health check failed'),
        1000
      ),
      health_error_code = LEFT(COALESCE(NULLIF(btrim(p_error_code), ''), 'unknown'), 100),
      health_error_resolution = LEFT(
        COALESCE(NULLIF(btrim(p_error_resolution), ''), 'Try checking the connection again.'),
        1000
      ),
      health_lease_owner = NULL,
      health_lease_until = NULL,
      attention_started_at = CASE
        WHEN v_human_action OR v_failure_count >= 3
          THEN COALESCE(attention_started_at, v_now)
        ELSE attention_started_at
      END,
      attention_notified_at = CASE
        WHEN v_attention AND attention_notified_at IS NULL THEN v_now
        ELSE attention_notified_at
      END
  WHERE id = p_config_id
    AND account_id = p_account_id
    AND health_lease_owner = p_health_owner
    AND health_lease_until >= v_now
    AND credential_generation = p_credential_generation
  RETURNING id, (v_attention AND attention_notified_at = v_now)
  INTO v_changed, v_notify;

  IF v_changed IS NULL THEN
    RETURN FALSE;
  END IF;

  IF v_notify THEN
    INSERT INTO public.notifications (
      account_id,
      user_id,
      type,
      title,
      body
    )
    SELECT
      p_account_id,
      profile.user_id,
      'meta_leads_attention',
      'Facebook lead capture needs attention',
      LEFT(
        COALESCE(NULLIF(btrim(p_error_resolution), ''), 'Check the Facebook connection in Settings.'),
        1000
      )
    FROM public.profiles AS profile
    WHERE profile.account_id = p_account_id
      AND profile.account_role IN ('owner', 'admin');
  END IF;

  RETURN TRUE;
END;
$function$;

CREATE OR REPLACE FUNCTION public.claim_meta_lead_webhook_event_owned(
  p_event_id TEXT,
  p_account_id UUID,
  p_payload JSONB,
  p_processing_owner UUID,
  p_lease_seconds INTEGER DEFAULT 300
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_claimed_id TEXT;
  v_existing public.webhook_events%ROWTYPE;
  v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  IF p_event_id NOT LIKE 'meta:leadgen:%'
     OR p_account_id IS NULL
     OR p_processing_owner IS NULL
     OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Invalid Meta lead event identity'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.webhook_events (
    id,
    account_id,
    gateway,
    type,
    payload,
    processing_status,
    attempt_count,
    last_attempt_at,
    processing_started_at,
    processing_owner,
    next_attempt_at,
    last_error
  )
  VALUES (
    p_event_id,
    p_account_id,
    'meta',
    'leadgen',
    p_payload,
    'processing',
    1,
    v_now,
    v_now,
    p_processing_owner,
    NULL,
    NULL
  )
  ON CONFLICT (id) DO UPDATE
  SET processing_status = 'processing',
      attempt_count = public.webhook_events.attempt_count + 1,
      last_attempt_at = v_now,
      processing_started_at = v_now,
      processing_owner = p_processing_owner,
      next_attempt_at = NULL,
      last_error = NULL
  WHERE public.webhook_events.account_id = p_account_id
    AND public.webhook_events.gateway = 'meta'
    AND public.webhook_events.type = 'leadgen'
    AND public.webhook_events.payload IS NOT DISTINCT FROM p_payload
    AND public.webhook_events.processed_at IS NULL
    AND (
      (
        public.webhook_events.processing_status IN ('pending', 'failed')
        AND (
          public.webhook_events.next_attempt_at IS NULL
          OR public.webhook_events.next_attempt_at <= v_now
        )
      )
      OR public.webhook_events.processing_started_at IS NULL
      OR public.webhook_events.processing_started_at
        < v_now - make_interval(
          secs => LEAST(GREATEST(p_lease_seconds, 30), 300)
        )
    )
  RETURNING id INTO v_claimed_id;

  IF v_claimed_id IS NOT NULL THEN
    RETURN 'claimed';
  END IF;

  SELECT *
  INTO v_existing
  FROM public.webhook_events
  WHERE id = p_event_id;

  IF v_existing.id IS NULL
     OR v_existing.account_id IS DISTINCT FROM p_account_id
     OR v_existing.gateway IS DISTINCT FROM 'meta'
     OR v_existing.type IS DISTINCT FROM 'leadgen'
     OR v_existing.payload IS DISTINCT FROM p_payload THEN
    RETURN 'conflict';
  END IF;
  IF v_existing.processed_at IS NOT NULL
     OR v_existing.processing_status = 'processed' THEN
    RETURN 'processed';
  END IF;
  RETURN 'busy';
END;
$function$;

CREATE OR REPLACE FUNCTION public.claim_meta_lead_webhook_recovery_batch(
  p_processing_owner UUID,
  p_limit INTEGER,
  p_lease_seconds INTEGER
)
RETURNS TABLE(
  event_id TEXT,
  account_id UUID,
  payload JSONB,
  attempt_count INTEGER,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
BEGIN
  IF p_processing_owner IS NULL THEN
    RAISE EXCEPTION 'Meta lead processing owner is required'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH candidates AS (
    SELECT event.id
    FROM public.webhook_events AS event
    WHERE event.gateway = 'meta'
      AND event.type = 'leadgen'
      AND event.account_id IS NOT NULL
      AND jsonb_typeof(event.payload) = 'object'
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
          < clock_timestamp() - make_interval(
            secs => LEAST(GREATEST(p_lease_seconds, 30), 300)
          )
      )
    ORDER BY event.created_at, event.id
    LIMIT LEAST(GREATEST(p_limit, 1), 25)
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
    claimed.payload,
    claimed.attempt_count,
    claimed.created_at
  FROM claimed
  ORDER BY claimed.created_at, claimed.id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.complete_meta_lead_webhook_event_owned(
  p_event_id TEXT,
  p_account_id UUID,
  p_processing_owner UUID,
  p_processing_context JSONB DEFAULT '{}'::jsonb
)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $function$
  WITH changed AS (
    UPDATE public.webhook_events
    SET processing_status = 'processed',
        processing_context = processing_context || COALESCE(
          p_processing_context,
          '{}'::jsonb
        ),
        processed_at = clock_timestamp(),
        processing_started_at = NULL,
        processing_owner = NULL,
        next_attempt_at = NULL,
        last_error = NULL
    WHERE id = p_event_id
      AND account_id = p_account_id
      AND gateway = 'meta'
      AND type = 'leadgen'
      AND processing_status = 'processing'
      AND processing_owner = p_processing_owner
      AND processed_at IS NULL
    RETURNING id
  )
  SELECT EXISTS (SELECT 1 FROM changed);
$function$;

CREATE OR REPLACE FUNCTION public.fail_meta_lead_webhook_event_owned(
  p_event_id TEXT,
  p_account_id UUID,
  p_processing_owner UUID,
  p_error TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $function$
  WITH changed AS (
    UPDATE public.webhook_events
    SET processing_status = 'failed',
        processing_started_at = NULL,
        processing_owner = NULL,
        next_attempt_at = clock_timestamp() + CASE
          WHEN attempt_count <= 1 THEN INTERVAL '1 minute'
          WHEN attempt_count = 2 THEN INTERVAL '5 minutes'
          WHEN attempt_count = 3 THEN INTERVAL '15 minutes'
          WHEN attempt_count = 4 THEN INTERVAL '1 hour'
          ELSE INTERVAL '6 hours'
        END,
        last_error = LEFT(
          COALESCE(p_error, 'Meta lead processing failed'),
          4000
        )
    WHERE id = p_event_id
      AND account_id = p_account_id
      AND gateway = 'meta'
      AND type = 'leadgen'
      AND processing_status = 'processing'
      AND processing_owner = p_processing_owner
      AND processed_at IS NULL
    RETURNING id
  )
  SELECT EXISTS (SELECT 1 FROM changed);
$function$;

CREATE OR REPLACE FUNCTION public.complete_meta_lead_without_phone_owned(
  p_config_id UUID,
  p_account_id UUID,
  p_event_id TEXT,
  p_processing_owner UUID
)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $function$
  WITH owned_event AS (
    SELECT event.id, event.payload
    FROM public.webhook_events AS event
    WHERE event.id = p_event_id
      AND event.account_id = p_account_id
      AND event.gateway = 'meta'
      AND event.type = 'leadgen'
      AND event.processing_status = 'processing'
      AND event.processing_owner = p_processing_owner
      AND event.processed_at IS NULL
  ), incremented AS (
    UPDATE public.meta_page_config AS config
    SET skipped_no_phone = skipped_no_phone + 1
    FROM owned_event
    WHERE config.id = p_config_id
      AND config.account_id = p_account_id
      AND config.page_id = owned_event.payload ->> 'page_id'
    RETURNING config.id
  ), completed AS (
    UPDATE public.webhook_events AS event
    SET processing_status = 'processed',
        processing_context = processing_context || jsonb_build_object(
          'meta_lead',
          jsonb_build_object('skipped', 'no_phone')
        ),
        processed_at = clock_timestamp(),
        processing_started_at = NULL,
        processing_owner = NULL,
        next_attempt_at = NULL,
        last_error = NULL
    FROM incremented
    WHERE event.id = p_event_id
      AND event.account_id = p_account_id
      AND event.gateway = 'meta'
      AND event.type = 'leadgen'
      AND event.processing_status = 'processing'
      AND event.processing_owner = p_processing_owner
      AND event.processed_at IS NULL
    RETURNING event.id
  )
  SELECT EXISTS (SELECT 1 FROM completed);
$function$;

REVOKE ALL ON FUNCTION public.claim_meta_page_health_batch(
  UUID, INTEGER, INTEGER, UUID
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_meta_page_health_check(
  UUID, UUID, UUID, INTEGER, BOOLEAN
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fail_meta_page_health_check(
  UUID, UUID, UUID, INTEGER, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_meta_lead_webhook_event_owned(
  TEXT, UUID, JSONB, UUID, INTEGER
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_meta_lead_webhook_recovery_batch(
  UUID, INTEGER, INTEGER
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_meta_lead_webhook_event_owned(
  TEXT, UUID, UUID, JSONB
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fail_meta_lead_webhook_event_owned(
  TEXT, UUID, UUID, TEXT
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_meta_lead_without_phone_owned(
  UUID, UUID, TEXT, UUID
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.claim_meta_page_health_batch(
  UUID, INTEGER, INTEGER, UUID
) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_meta_page_health_check(
  UUID, UUID, UUID, INTEGER, BOOLEAN
) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_meta_page_health_check(
  UUID, UUID, UUID, INTEGER, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN
) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_meta_lead_webhook_event_owned(
  TEXT, UUID, JSONB, UUID, INTEGER
) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_meta_lead_webhook_recovery_batch(
  UUID, INTEGER, INTEGER
) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_meta_lead_webhook_event_owned(
  TEXT, UUID, UUID, JSONB
) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_meta_lead_webhook_event_owned(
  TEXT, UUID, UUID, TEXT
) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_meta_lead_without_phone_owned(
  UUID, UUID, TEXT, UUID
) TO service_role;

COMMENT ON FUNCTION public.claim_meta_page_health_batch(
  UUID, INTEGER, INTEGER, UUID
) IS 'Claims bounded Meta Page health work with an owner lease; ciphertext is returned only to service_role.';
COMMENT ON FUNCTION public.claim_meta_lead_webhook_recovery_batch(
  UUID, INTEGER, INTEGER
) IS 'Claims failed, due, or stale Meta lead events for internal recovery without provider redelivery.';
