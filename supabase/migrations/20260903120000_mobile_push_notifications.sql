-- Durable native push installations and inbound-message delivery outbox.
-- Browser roles cannot read tokens or delivery copy. Every mutation and
-- dispatcher operation crosses an explicit service-role-only RPC boundary.

CREATE TABLE IF NOT EXISTS public.push_installations (
  installation_id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
  environment TEXT NOT NULL
    CHECK (environment IN ('development', 'preview', 'production')),
  expo_push_token TEXT NOT NULL
    CHECK (length(expo_push_token) BETWEEN 1 AND 512),
  app_version TEXT CHECK (app_version IS NULL OR length(app_version) <= 64),
  device_model TEXT CHECK (device_model IS NULL OR length(device_model) <= 120),
  os_version TEXT CHECK (os_version IS NULL OR length(os_version) <= 64),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE UNIQUE INDEX IF NOT EXISTS push_installations_active_token_environment_idx
  ON public.push_installations (environment, expo_push_token)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS push_installations_user_active_idx
  ON public.push_installations (user_id, environment, last_seen_at DESC)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS public.push_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL
    REFERENCES public.conversations(id) ON DELETE CASCADE,
  message_id UUID NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  recipient_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  installation_id UUID NOT NULL
    REFERENCES public.push_installations(installation_id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 4096),
  payload JSONB NOT NULL CHECK (
    jsonb_typeof(payload) = 'object'
    AND jsonb_object_length(payload) = 5
    AND payload ?& ARRAY[
      'version',
      'accountId',
      'conversationId',
      'messageId',
      'deliveryId'
    ]
    AND payload->>'version' = '1'
    AND (payload->>'accountId')::uuid = account_id
    AND (payload->>'conversationId')::uuid = conversation_id
    AND (payload->>'messageId')::uuid = message_id
    AND (payload->>'deliveryId')::uuid = id
  ),
  state TEXT NOT NULL DEFAULT 'pending' CHECK (
    state IN (
      'pending',
      'sending',
      'ticketed',
      'delivered',
      'retry',
      'failed',
      'cancelled'
    )
  ),
  attempt_count INTEGER NOT NULL DEFAULT 0
    CHECK (attempt_count >= 0 AND attempt_count <= 12),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  lease_owner UUID,
  lease_expires_at TIMESTAMPTZ,
  expo_ticket_id TEXT CHECK (
    expo_ticket_id IS NULL OR length(expo_ticket_id) <= 200
  ),
  provider_error_code TEXT CHECK (
    provider_error_code IS NULL OR length(provider_error_code) <= 120
  ),
  ticketed_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (message_id, installation_id),
  CHECK (
    (lease_owner IS NULL AND lease_expires_at IS NULL)
    OR (lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS push_deliveries_due_idx
  ON public.push_deliveries (next_attempt_at, created_at, id)
  WHERE state IN ('pending', 'retry', 'sending');

CREATE INDEX IF NOT EXISTS push_deliveries_receipt_idx
  ON public.push_deliveries (next_attempt_at, ticketed_at, id)
  WHERE state = 'ticketed';

CREATE INDEX IF NOT EXISTS push_deliveries_installation_open_idx
  ON public.push_deliveries (installation_id, state)
  WHERE state IN ('pending', 'sending', 'ticketed', 'retry');

ALTER TABLE public.push_installations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_deliveries ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.push_installations
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.push_deliveries
  FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_installations TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_deliveries TO service_role;

DROP TRIGGER IF EXISTS set_push_installations_updated_at
  ON public.push_installations;
CREATE TRIGGER set_push_installations_updated_at
BEFORE UPDATE ON public.push_installations
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS set_push_deliveries_updated_at
  ON public.push_deliveries;
CREATE TRIGGER set_push_deliveries_updated_at
BEFORE UPDATE ON public.push_deliveries
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION private.enforce_push_installation_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> NEW.user_id THEN
    RAISE EXCEPTION 'Push installation user must match authenticated user';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION private.enforce_push_installation_user()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS enforce_push_installation_user
  ON public.push_installations;
CREATE TRIGGER enforce_push_installation_user
BEFORE INSERT OR UPDATE OF user_id ON public.push_installations
FOR EACH ROW EXECUTE FUNCTION private.enforce_push_installation_user();

CREATE OR REPLACE FUNCTION private.enforce_push_delivery_tenancy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.conversations AS conversation
    JOIN public.messages AS message
      ON message.id = NEW.message_id
      AND message.conversation_id = conversation.id
    JOIN public.push_installations AS installation
      ON installation.installation_id = NEW.installation_id
      AND installation.user_id = NEW.recipient_user_id
    WHERE conversation.id = NEW.conversation_id
      AND conversation.account_id = NEW.account_id
  ) THEN
    RAISE EXCEPTION 'Push delivery tenant references do not agree';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION private.enforce_push_delivery_tenancy()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS enforce_push_delivery_tenancy
  ON public.push_deliveries;
CREATE TRIGGER enforce_push_delivery_tenancy
BEFORE INSERT OR UPDATE OF
  account_id,
  conversation_id,
  message_id,
  recipient_user_id,
  installation_id
ON public.push_deliveries
FOR EACH ROW EXECUTE FUNCTION private.enforce_push_delivery_tenancy();

CREATE OR REPLACE FUNCTION public.register_push_installation(
  p_user_id UUID,
  p_installation_id UUID,
  p_platform TEXT,
  p_environment TEXT,
  p_expo_push_token TEXT,
  p_app_version TEXT DEFAULT NULL,
  p_device_model TEXT DEFAULT NULL,
  p_os_version TEXT DEFAULT NULL
)
RETURNS TABLE(installation_id UUID, registration_status TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF p_user_id IS NULL OR p_installation_id IS NULL THEN
    RAISE EXCEPTION 'Push installation identity is required';
  END IF;
  IF p_platform NOT IN ('ios', 'android') THEN
    RAISE EXCEPTION 'Invalid push platform';
  END IF;
  IF p_environment NOT IN ('development', 'preview', 'production') THEN
    RAISE EXCEPTION 'Invalid push environment';
  END IF;
  IF p_expo_push_token IS NULL
    OR length(p_expo_push_token) NOT BETWEEN 1 AND 512 THEN
    RAISE EXCEPTION 'Invalid Expo push token';
  END IF;

  -- Serialize ownership changes for this environment/token pair so the
  -- partial unique index cannot race two authenticated registration routes.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_environment || ':' || p_expo_push_token, 0)
  );

  UPDATE public.push_installations
  SET revoked_at = COALESCE(revoked_at, clock_timestamp())
  WHERE environment = p_environment
    AND expo_push_token = p_expo_push_token
    AND installation_id <> p_installation_id
    AND revoked_at IS NULL;

  INSERT INTO public.push_installations (
    installation_id,
    user_id,
    platform,
    environment,
    expo_push_token,
    app_version,
    device_model,
    os_version,
    last_seen_at,
    revoked_at
  ) VALUES (
    p_installation_id,
    p_user_id,
    p_platform,
    p_environment,
    p_expo_push_token,
    NULLIF(left(btrim(p_app_version), 64), ''),
    NULLIF(left(btrim(p_device_model), 120), ''),
    NULLIF(left(btrim(p_os_version), 64), ''),
    clock_timestamp(),
    NULL
  )
  ON CONFLICT (installation_id) DO UPDATE
  SET user_id = EXCLUDED.user_id,
      platform = EXCLUDED.platform,
      environment = EXCLUDED.environment,
      expo_push_token = EXCLUDED.expo_push_token,
      app_version = EXCLUDED.app_version,
      device_model = EXCLUDED.device_model,
      os_version = EXCLUDED.os_version,
      last_seen_at = clock_timestamp(),
      revoked_at = NULL;

  RETURN QUERY SELECT p_installation_id, 'registered'::TEXT;
END;
$function$;

CREATE OR REPLACE FUNCTION public.revoke_push_installation(
  p_user_id UUID,
  p_installation_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_changed BOOLEAN;
BEGIN
  UPDATE public.push_installations AS installation
  SET revoked_at = COALESCE(installation.revoked_at, clock_timestamp()),
      last_seen_at = clock_timestamp()
  WHERE installation.installation_id = p_installation_id
    AND installation.user_id = p_user_id
  RETURNING TRUE INTO v_changed;

  UPDATE public.push_deliveries AS delivery
  SET state = 'cancelled',
      cancelled_at = COALESCE(delivery.cancelled_at, clock_timestamp()),
      lease_owner = NULL,
      lease_expires_at = NULL,
      provider_error_code = 'installation_revoked'
  WHERE delivery.installation_id = p_installation_id
    AND delivery.recipient_user_id = p_user_id
    AND delivery.state IN ('pending', 'sending', 'ticketed', 'retry');

  RETURN COALESCE(v_changed, FALSE);
END;
$function$;

CREATE OR REPLACE FUNCTION public.enqueue_inbound_push_deliveries(
  p_message_id UUID
)
RETURNS INTEGER
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $function$
  WITH eligible AS (
    SELECT
      gen_random_uuid() AS delivery_id,
      conversation.account_id,
      conversation.id AS conversation_id,
      message.id AS message_id,
      membership.user_id AS recipient_user_id,
      installation.installation_id,
      COALESCE(NULLIF(btrim(contact.name), ''), 'WhatsApp contact') AS title,
      CASE
        WHEN message.content_text IS NOT NULL
          AND btrim(message.content_text) <> '' THEN message.content_text
        WHEN message.content_type = 'image' THEN 'Photo'
        WHEN message.content_type = 'video' THEN 'Video'
        WHEN message.content_type = 'audio' THEN 'Audio'
        WHEN message.content_type = 'document' THEN 'Document'
        WHEN message.content_type = 'location' THEN 'Location'
        ELSE 'New WhatsApp message'
      END AS body
    FROM public.messages AS message
    JOIN public.conversations AS conversation
      ON conversation.id = message.conversation_id
    JOIN public.contacts AS contact
      ON contact.id = conversation.contact_id
      AND contact.account_id = conversation.account_id
    JOIN public.accounts AS account
      ON account.id = conversation.account_id
      AND account.branch_status = 'active'
    JOIN public.account_memberships AS membership
      ON membership.account_id = conversation.account_id
      AND membership.role IN ('owner', 'admin', 'agent')
      AND (
        (
          conversation.assigned_agent_id IS NOT NULL
          AND membership.user_id = conversation.assigned_agent_id
        )
        OR (
          conversation.assigned_agent_id IS NULL
          AND membership.role IN ('owner', 'admin', 'agent')
        )
      )
    JOIN public.push_installations AS installation
      ON installation.user_id = membership.user_id
      AND installation.revoked_at IS NULL
    WHERE message.id = p_message_id
      AND message.sender_type = 'customer'
  ), inserted AS (
    INSERT INTO public.push_deliveries (
      id,
      account_id,
      conversation_id,
      message_id,
      recipient_user_id,
      installation_id,
      title,
      body,
      payload
    )
    SELECT
      eligible.delivery_id,
      eligible.account_id,
      eligible.conversation_id,
      eligible.message_id,
      eligible.recipient_user_id,
      eligible.installation_id,
      left(eligible.title, 200),
      left(eligible.body, 4096),
      jsonb_build_object(
        'version', 1,
        'accountId', eligible.account_id,
        'conversationId', eligible.conversation_id,
        'messageId', eligible.message_id,
        'deliveryId', eligible.delivery_id
      )
    FROM eligible
    ON CONFLICT (message_id, installation_id) DO NOTHING
    RETURNING id
  )
  SELECT count(*)::INTEGER FROM inserted;
$function$;

CREATE OR REPLACE FUNCTION public.claim_push_deliveries(
  p_worker_id UUID,
  p_limit INTEGER DEFAULT 20,
  p_lease_seconds INTEGER DEFAULT 120
)
RETURNS TABLE(
  delivery_id UUID,
  expo_push_token TEXT,
  title TEXT,
  body TEXT,
  payload JSONB,
  attempt_count INTEGER,
  cancelled_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF p_worker_id IS NULL THEN
    RAISE EXCEPTION 'Push worker identity is required';
  END IF;

  RETURN QUERY
  WITH cancelled AS (
    UPDATE public.push_deliveries AS delivery
    SET state = 'cancelled',
        cancelled_at = COALESCE(delivery.cancelled_at, clock_timestamp()),
        lease_owner = NULL,
        lease_expires_at = NULL,
        provider_error_code = 'recipient_ineligible'
    WHERE delivery.state IN ('pending', 'retry', 'sending')
      AND (
        delivery.state <> 'sending'
        OR delivery.lease_expires_at IS NULL
        OR delivery.lease_expires_at <= clock_timestamp()
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.push_installations AS installation
        JOIN public.conversations AS conversation
          ON conversation.id = delivery.conversation_id
          AND conversation.account_id = delivery.account_id
        JOIN public.accounts AS account
          ON account.id = delivery.account_id
          AND account.branch_status = 'active'
        JOIN public.account_memberships AS membership
          ON membership.account_id = delivery.account_id
          AND membership.user_id = delivery.recipient_user_id
          AND membership.role IN ('owner', 'admin', 'agent')
        WHERE installation.installation_id = delivery.installation_id
          AND installation.user_id = delivery.recipient_user_id
          AND installation.revoked_at IS NULL
          AND (
            conversation.assigned_agent_id = delivery.recipient_user_id
            OR (
              conversation.assigned_agent_id IS NULL
              AND membership.role IN ('owner', 'admin', 'agent')
            )
          )
      )
    RETURNING delivery.id
  ), candidates AS (
    SELECT delivery.id
    FROM public.push_deliveries AS delivery
    JOIN public.push_installations AS installation
      ON installation.installation_id = delivery.installation_id
      AND installation.user_id = delivery.recipient_user_id
      AND installation.revoked_at IS NULL
    JOIN public.conversations AS conversation
      ON conversation.id = delivery.conversation_id
      AND conversation.account_id = delivery.account_id
    JOIN public.accounts AS account
      ON account.id = delivery.account_id
      AND account.branch_status = 'active'
    JOIN public.account_memberships AS membership
      ON membership.account_id = delivery.account_id
      AND membership.user_id = delivery.recipient_user_id
      AND membership.role IN ('owner', 'admin', 'agent')
    WHERE (
      (
        delivery.state IN ('pending', 'retry')
        AND delivery.next_attempt_at <= clock_timestamp()
      )
      OR (
        delivery.state = 'sending'
        AND (
          delivery.lease_expires_at IS NULL
          OR delivery.lease_expires_at <= clock_timestamp()
        )
      )
    )
      AND delivery.attempt_count < 12
      AND (
        conversation.assigned_agent_id = delivery.recipient_user_id
        OR (
          conversation.assigned_agent_id IS NULL
          AND membership.role IN ('owner', 'admin', 'agent')
        )
      )
    ORDER BY delivery.next_attempt_at, delivery.created_at, delivery.id
    LIMIT LEAST(GREATEST(p_limit, 1), 100)
    FOR UPDATE OF delivery SKIP LOCKED
  ), claimed AS (
    UPDATE public.push_deliveries AS delivery
    SET state = 'sending',
        attempt_count = delivery.attempt_count + 1,
        lease_owner = p_worker_id,
        lease_expires_at = clock_timestamp()
          + make_interval(
              secs => LEAST(GREATEST(p_lease_seconds, 30), 300)
            ),
        provider_error_code = NULL
    FROM candidates
    WHERE delivery.id = candidates.id
    RETURNING delivery.*
  )
  SELECT
    claimed.id,
    installation.expo_push_token,
    claimed.title,
    claimed.body,
    claimed.payload,
    claimed.attempt_count,
    (SELECT count(*)::INTEGER FROM cancelled)
  FROM claimed
  JOIN public.push_installations AS installation
    ON installation.installation_id = claimed.installation_id
  UNION ALL
  SELECT
    NULL::UUID,
    NULL::TEXT,
    NULL::TEXT,
    NULL::TEXT,
    NULL::JSONB,
    NULL::INTEGER,
    (SELECT count(*)::INTEGER FROM cancelled)
  WHERE NOT EXISTS (SELECT 1 FROM claimed)
    AND EXISTS (SELECT 1 FROM cancelled)
  ORDER BY delivery_id NULLS LAST;
END;
$function$;

CREATE OR REPLACE FUNCTION public.claim_push_receipts(
  p_worker_id UUID,
  p_limit INTEGER DEFAULT 100,
  p_lease_seconds INTEGER DEFAULT 120
)
RETURNS TABLE(
  delivery_id UUID,
  expo_ticket_id TEXT,
  attempt_count INTEGER,
  cancelled_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF p_worker_id IS NULL THEN
    RAISE EXCEPTION 'Push worker identity is required';
  END IF;

  RETURN QUERY
  WITH ineligible AS (
    UPDATE public.push_deliveries AS delivery
    SET state = 'cancelled',
        cancelled_at = COALESCE(delivery.cancelled_at, clock_timestamp()),
        lease_owner = NULL,
        lease_expires_at = NULL,
        provider_error_code = 'recipient_ineligible'
    WHERE delivery.state = 'ticketed'
      AND (
        delivery.lease_expires_at IS NULL
        OR delivery.lease_expires_at <= clock_timestamp()
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.push_installations AS installation
        JOIN public.conversations AS conversation
          ON conversation.id = delivery.conversation_id
          AND conversation.account_id = delivery.account_id
        JOIN public.accounts AS account
          ON account.id = delivery.account_id
          AND account.branch_status = 'active'
        JOIN public.account_memberships AS membership
          ON membership.account_id = delivery.account_id
          AND membership.user_id = delivery.recipient_user_id
          AND membership.role IN ('owner', 'admin', 'agent')
        WHERE installation.installation_id = delivery.installation_id
          AND installation.user_id = delivery.recipient_user_id
          AND installation.revoked_at IS NULL
          AND (
            conversation.assigned_agent_id = delivery.recipient_user_id
            OR conversation.assigned_agent_id IS NULL
          )
      )
    RETURNING delivery.id
  ), candidates AS (
    SELECT delivery.id
    FROM public.push_deliveries AS delivery
    WHERE delivery.state = 'ticketed'
      AND delivery.expo_ticket_id IS NOT NULL
      AND delivery.next_attempt_at <= clock_timestamp()
      AND (
        delivery.lease_expires_at IS NULL
        OR delivery.lease_expires_at <= clock_timestamp()
      )
    ORDER BY delivery.next_attempt_at, delivery.ticketed_at, delivery.id
    LIMIT LEAST(GREATEST(p_limit, 1), 1000)
    FOR UPDATE OF delivery SKIP LOCKED
  ), claimed AS (
    UPDATE public.push_deliveries AS delivery
    SET lease_owner = p_worker_id,
        lease_expires_at = clock_timestamp()
          + make_interval(
              secs => LEAST(GREATEST(p_lease_seconds, 30), 300)
            )
    FROM candidates
    WHERE delivery.id = candidates.id
    RETURNING delivery.*
  )
  SELECT
    claimed.id,
    claimed.expo_ticket_id,
    claimed.attempt_count,
    (SELECT count(*)::INTEGER FROM ineligible)
  FROM claimed
  UNION ALL
  SELECT
    NULL::UUID,
    NULL::TEXT,
    NULL::INTEGER,
    (SELECT count(*)::INTEGER FROM ineligible)
  WHERE NOT EXISTS (SELECT 1 FROM claimed)
    AND EXISTS (SELECT 1 FROM ineligible)
  ORDER BY delivery_id NULLS LAST;
END;
$function$;

CREATE OR REPLACE FUNCTION public.settle_push_delivery(
  p_delivery_id UUID,
  p_worker_id UUID,
  p_outcome TEXT,
  p_ticket_id TEXT DEFAULT NULL,
  p_error_code TEXT DEFAULT NULL,
  p_next_attempt_at TIMESTAMPTZ DEFAULT NULL,
  p_retire_installation BOOLEAN DEFAULT FALSE
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_installation_id UUID;
BEGIN
  IF p_outcome NOT IN (
    'ticketed',
    'delivered',
    'retry',
    'failed',
    'cancelled'
  ) THEN
    RAISE EXCEPTION 'Invalid push settlement outcome';
  END IF;
  IF p_outcome = 'ticketed'
    AND (p_ticket_id IS NULL OR btrim(p_ticket_id) = '') THEN
    RAISE EXCEPTION 'Ticketed push settlement requires a ticket id';
  END IF;

  UPDATE public.push_deliveries AS delivery
  SET state = p_outcome,
      expo_ticket_id = CASE
        WHEN p_outcome = 'ticketed' THEN left(p_ticket_id, 200)
        ELSE delivery.expo_ticket_id
      END,
      provider_error_code = NULLIF(LEFT(p_error_code, 120), ''),
      next_attempt_at = CASE
        WHEN p_outcome = 'ticketed' THEN COALESCE(
          p_next_attempt_at,
          clock_timestamp() + interval '15 minutes'
        )
        WHEN p_outcome = 'retry' THEN COALESCE(
          p_next_attempt_at,
          clock_timestamp() + interval '5 minutes'
        )
        ELSE delivery.next_attempt_at
      END,
      ticketed_at = CASE
        WHEN p_outcome = 'ticketed' THEN clock_timestamp()
        ELSE delivery.ticketed_at
      END,
      delivered_at = CASE
        WHEN p_outcome = 'delivered' THEN clock_timestamp()
        ELSE delivery.delivered_at
      END,
      failed_at = CASE
        WHEN p_outcome = 'failed' THEN clock_timestamp()
        ELSE delivery.failed_at
      END,
      cancelled_at = CASE
        WHEN p_outcome = 'cancelled' THEN clock_timestamp()
        ELSE delivery.cancelled_at
      END,
      lease_owner = NULL,
      lease_expires_at = NULL
  WHERE delivery.id = p_delivery_id
    AND delivery.lease_owner = p_worker_id
    AND delivery.lease_expires_at > clock_timestamp()
  RETURNING delivery.installation_id INTO v_installation_id;

  IF v_installation_id IS NULL THEN
    RETURN FALSE;
  END IF;

  IF p_retire_installation THEN
    UPDATE public.push_installations
    SET revoked_at = COALESCE(revoked_at, clock_timestamp())
    WHERE installation_id = v_installation_id;

    UPDATE public.push_deliveries
    SET state = 'failed',
        failed_at = COALESCE(failed_at, clock_timestamp()),
        lease_owner = NULL,
        lease_expires_at = NULL,
        provider_error_code = COALESCE(
          NULLIF(LEFT(p_error_code, 120), ''),
          'permanent_token_error'
        )
    WHERE installation_id = v_installation_id
      AND id <> p_delivery_id
      AND state IN ('pending', 'sending', 'ticketed', 'retry');
  END IF;

  RETURN TRUE;
END;
$function$;

REVOKE ALL ON FUNCTION public.register_push_installation(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.revoke_push_installation(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enqueue_inbound_push_deliveries(UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_push_deliveries(UUID, INTEGER, INTEGER)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_push_receipts(UUID, INTEGER, INTEGER)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.settle_push_delivery(
  UUID, UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, BOOLEAN
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.register_push_installation(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) TO service_role;
GRANT EXECUTE ON FUNCTION public.revoke_push_installation(UUID, UUID)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.enqueue_inbound_push_deliveries(UUID)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_push_deliveries(UUID, INTEGER, INTEGER)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_push_receipts(UUID, INTEGER, INTEGER)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.settle_push_delivery(
  UUID, UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, BOOLEAN
) TO service_role;

COMMENT ON TABLE public.push_installations IS
  'Service-only native app installations. Expo tokens are never browser-readable.';
COMMENT ON TABLE public.push_deliveries IS
  'Service-only durable Expo push ticket and receipt ledger for inbound messages.';
