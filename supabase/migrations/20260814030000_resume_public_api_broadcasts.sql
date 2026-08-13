-- Public API broadcasts acknowledge after persisting recipient rows, then use
-- Next.js after() for the first send drain. Persist the complete per-recipient
-- send payload and add service-only owner leases so a cron worker can resume
-- rows left pending when that invocation reaches its platform timeout.

ALTER TABLE public.broadcast_recipients
  ADD COLUMN IF NOT EXISTS destination_phone TEXT,
  ADD COLUMN IF NOT EXISTS template_params JSONB NOT NULL DEFAULT '[]'::JSONB,
  ADD COLUMN IF NOT EXISTS send_lease_owner UUID,
  ADD COLUMN IF NOT EXISTS send_lease_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS send_attempt_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.broadcast_recipients
  DROP CONSTRAINT IF EXISTS broadcast_recipients_destination_phone_check;
ALTER TABLE public.broadcast_recipients
  ADD CONSTRAINT broadcast_recipients_destination_phone_check
  CHECK (
    destination_phone IS NULL
    OR destination_phone ~ '^[1-9][0-9]{6,14}$'
  );

ALTER TABLE public.broadcast_recipients
  DROP CONSTRAINT IF EXISTS broadcast_recipients_template_params_check;
ALTER TABLE public.broadcast_recipients
  ADD CONSTRAINT broadcast_recipients_template_params_check
  CHECK (jsonb_typeof(template_params) = 'array');

ALTER TABLE public.broadcast_recipients
  DROP CONSTRAINT IF EXISTS broadcast_recipients_send_attempt_count_check;
ALTER TABLE public.broadcast_recipients
  ADD CONSTRAINT broadcast_recipients_send_attempt_count_check
  CHECK (send_attempt_count >= 0);

ALTER TABLE public.broadcast_recipients
  DROP CONSTRAINT IF EXISTS broadcast_recipients_send_lease_pair_check;
ALTER TABLE public.broadcast_recipients
  ADD CONSTRAINT broadcast_recipients_send_lease_pair_check
  CHECK (
    (send_lease_owner IS NULL AND send_lease_until IS NULL)
    OR (send_lease_owner IS NOT NULL AND send_lease_until IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS broadcast_recipients_send_recovery_idx
  ON public.broadcast_recipients (send_lease_until, created_at, id)
  WHERE status = 'pending' AND destination_phone IS NOT NULL;

CREATE OR REPLACE FUNCTION public.claim_public_broadcast_recipients(
  p_lease_owner UUID,
  p_limit INTEGER DEFAULT 25,
  p_broadcast_id UUID DEFAULT NULL,
  p_lease_seconds INTEGER DEFAULT 300
)
RETURNS TABLE(
  recipient_id UUID,
  broadcast_id UUID,
  account_id UUID,
  template_name TEXT,
  template_language TEXT,
  destination_phone TEXT,
  template_params JSONB,
  attempt_count INTEGER,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
BEGIN
  IF p_lease_owner IS NULL
     OR p_limit < 1
     OR p_limit > 100
     OR p_lease_seconds < 30
     OR p_lease_seconds > 300 THEN
    RAISE EXCEPTION 'Invalid public broadcast recovery claim';
  END IF;

  RETURN QUERY
  WITH candidates AS (
    SELECT recipient.id
    FROM public.broadcast_recipients AS recipient
    JOIN public.broadcasts AS broadcast
      ON broadcast.id = recipient.broadcast_id
    WHERE recipient.status = 'pending'
      AND recipient.destination_phone IS NOT NULL
      AND broadcast.status = 'sending'
      AND (p_broadcast_id IS NULL OR broadcast.id = p_broadcast_id)
      AND (
        recipient.send_lease_until IS NULL
        OR recipient.send_lease_until <= clock_timestamp()
      )
    ORDER BY recipient.created_at, recipient.id
    LIMIT p_limit
    FOR UPDATE OF recipient SKIP LOCKED
  ), claimed AS (
    UPDATE public.broadcast_recipients AS recipient
    SET send_lease_owner = p_lease_owner,
        send_lease_until = clock_timestamp()
          + make_interval(secs => p_lease_seconds),
        send_attempt_count = recipient.send_attempt_count + 1,
        error_message = NULL
    FROM candidates
    WHERE recipient.id = candidates.id
    RETURNING recipient.*
  )
  SELECT
    claimed.id,
    claimed.broadcast_id,
    broadcast.account_id,
    broadcast.template_name,
    broadcast.template_language,
    claimed.destination_phone,
    claimed.template_params,
    claimed.send_attempt_count,
    claimed.created_at
  FROM claimed
  JOIN public.broadcasts AS broadcast
    ON broadcast.id = claimed.broadcast_id
  ORDER BY claimed.created_at, claimed.id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.complete_public_broadcast_recipient(
  p_recipient_id UUID,
  p_lease_owner UUID,
  p_whatsapp_message_id TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_broadcast_id UUID;
BEGIN
  UPDATE public.broadcast_recipients AS recipient
  SET status = 'sent',
      sent_at = clock_timestamp(),
      whatsapp_message_id = p_whatsapp_message_id,
      error_message = NULL,
      send_lease_owner = NULL,
      send_lease_until = NULL
  WHERE recipient.id = p_recipient_id
    AND recipient.status = 'pending'
    AND recipient.send_lease_owner = p_lease_owner
  RETURNING recipient.broadcast_id INTO v_broadcast_id;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  UPDATE public.broadcasts AS broadcast
  SET status = CASE
        WHEN EXISTS (
          SELECT 1
          FROM public.broadcast_recipients AS recipient
          WHERE recipient.broadcast_id = v_broadcast_id
            AND recipient.status IN ('sent', 'delivered', 'read', 'replied')
        ) THEN 'sent'
        ELSE 'failed'
      END,
      updated_at = clock_timestamp()
  WHERE broadcast.id = v_broadcast_id
    AND broadcast.status = 'sending'
    AND NOT EXISTS (
      SELECT 1
      FROM public.broadcast_recipients AS recipient
      WHERE recipient.broadcast_id = v_broadcast_id
        AND recipient.status = 'pending'
    );

  RETURN TRUE;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fail_public_broadcast_recipient(
  p_recipient_id UUID,
  p_lease_owner UUID,
  p_error TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_broadcast_id UUID;
BEGIN
  UPDATE public.broadcast_recipients AS recipient
  SET status = 'failed',
      error_message = LEFT(COALESCE(p_error, 'Unknown error'), 4000),
      send_lease_owner = NULL,
      send_lease_until = NULL
  WHERE recipient.id = p_recipient_id
    AND recipient.status = 'pending'
    AND recipient.send_lease_owner = p_lease_owner
  RETURNING recipient.broadcast_id INTO v_broadcast_id;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  UPDATE public.broadcasts AS broadcast
  SET status = CASE
        WHEN EXISTS (
          SELECT 1
          FROM public.broadcast_recipients AS recipient
          WHERE recipient.broadcast_id = v_broadcast_id
            AND recipient.status IN ('sent', 'delivered', 'read', 'replied')
        ) THEN 'sent'
        ELSE 'failed'
      END,
      updated_at = clock_timestamp()
  WHERE broadcast.id = v_broadcast_id
    AND broadcast.status = 'sending'
    AND NOT EXISTS (
      SELECT 1
      FROM public.broadcast_recipients AS recipient
      WHERE recipient.broadcast_id = v_broadcast_id
        AND recipient.status = 'pending'
    );

  RETURN TRUE;
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_public_broadcast_recipients(
  UUID, INTEGER, UUID, INTEGER
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_public_broadcast_recipient(
  UUID, UUID, TEXT
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fail_public_broadcast_recipient(
  UUID, UUID, TEXT
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.claim_public_broadcast_recipients(
  UUID, INTEGER, UUID, INTEGER
) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_public_broadcast_recipient(
  UUID, UUID, TEXT
) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_public_broadcast_recipient(
  UUID, UUID, TEXT
) TO service_role;

COMMENT ON FUNCTION public.claim_public_broadcast_recipients(
  UUID, INTEGER, UUID, INTEGER
) IS 'Service-only owner-leased claim for resumable public API broadcast recipients.';
