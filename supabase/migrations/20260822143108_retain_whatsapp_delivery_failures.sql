-- Meta acknowledges accepted sends with a wamid, then reports some delivery
-- failures asynchronously in statuses[].errors[]. Retain only the bounded,
-- operator-actionable scalars before the durable receipt erases its payload.

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS provider_error_code TEXT,
  ADD COLUMN IF NOT EXISTS provider_error_title TEXT,
  ADD COLUMN IF NOT EXISTS provider_error_detail TEXT;

ALTER TABLE public.messages
  DROP CONSTRAINT IF EXISTS messages_provider_error_code_length_check;
ALTER TABLE public.messages
  ADD CONSTRAINT messages_provider_error_code_length_check
  CHECK (provider_error_code IS NULL OR char_length(provider_error_code) <= 100);

ALTER TABLE public.messages
  DROP CONSTRAINT IF EXISTS messages_provider_error_title_length_check;
ALTER TABLE public.messages
  ADD CONSTRAINT messages_provider_error_title_length_check
  CHECK (provider_error_title IS NULL OR char_length(provider_error_title) <= 500);

ALTER TABLE public.messages
  DROP CONSTRAINT IF EXISTS messages_provider_error_detail_length_check;
ALTER TABLE public.messages
  ADD CONSTRAINT messages_provider_error_detail_length_check
  CHECK (provider_error_detail IS NULL OR char_length(provider_error_detail) <= 2000);

-- Keep the four-argument overload from migration 20260813205947 during the
-- rollout so an older deployment can still apply status transitions. New
-- deployments call this seven-argument overload for failed callbacks.
CREATE OR REPLACE FUNCTION public.apply_whatsapp_status_callback(
  p_phone_number_id TEXT,
  p_message_id TEXT,
  p_status TEXT,
  p_status_at TIMESTAMPTZ,
  p_provider_error_code TEXT,
  p_provider_error_title TEXT,
  p_provider_error_detail TEXT
)
RETURNS TABLE(account_id UUID, conversation_id UUID)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
BEGIN
  IF p_phone_number_id IS NULL
     OR p_message_id IS NULL
     OR p_status_at IS NULL
     OR p_status NOT IN ('sent', 'delivered', 'read', 'failed') THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH target_account AS (
    SELECT config.account_id
    FROM public.whatsapp_config AS config
    WHERE config.phone_number_id = p_phone_number_id
  )
  UPDATE public.messages AS message
  SET status = p_status,
      provider_error_code = CASE
        WHEN p_status = 'failed'
          THEN LEFT(NULLIF(btrim(p_provider_error_code), ''), 100)
        ELSE NULL
      END,
      provider_error_title = CASE
        WHEN p_status = 'failed'
          THEN LEFT(NULLIF(btrim(p_provider_error_title), ''), 500)
        ELSE NULL
      END,
      provider_error_detail = CASE
        WHEN p_status = 'failed'
          THEN LEFT(NULLIF(btrim(p_provider_error_detail), ''), 2000)
        ELSE NULL
      END
  FROM public.conversations AS conversation,
       target_account
  WHERE message.conversation_id = conversation.id
    AND conversation.account_id = target_account.account_id
    AND message.message_id = p_message_id
    AND CASE p_status
      WHEN 'sent' THEN message.status = 'sending'
      WHEN 'delivered' THEN message.status IN ('sending', 'sent')
      WHEN 'read' THEN message.status IN ('sending', 'sent', 'delivered')
      WHEN 'failed' THEN message.status IN ('sending', 'sent')
      ELSE FALSE
    END
  RETURNING target_account.account_id, message.conversation_id;

  WITH target_account AS (
    SELECT config.account_id
    FROM public.whatsapp_config AS config
    WHERE config.phone_number_id = p_phone_number_id
  )
  UPDATE public.broadcast_recipients AS recipient
  SET status = p_status,
      sent_at = CASE
        WHEN p_status = 'sent' THEN COALESCE(recipient.sent_at, p_status_at)
        ELSE recipient.sent_at
      END,
      delivered_at = CASE
        WHEN p_status = 'delivered'
          THEN COALESCE(recipient.delivered_at, p_status_at)
        ELSE recipient.delivered_at
      END,
      read_at = CASE
        WHEN p_status = 'read' THEN COALESCE(recipient.read_at, p_status_at)
        ELSE recipient.read_at
      END,
      error_message = CASE
        WHEN p_status = 'failed' THEN LEFT(
          concat_ws(
            ' — ',
            NULLIF(btrim(p_provider_error_code), ''),
            COALESCE(
              NULLIF(btrim(p_provider_error_detail), ''),
              NULLIF(btrim(p_provider_error_title), '')
            )
          ),
          2000
        )
        ELSE recipient.error_message
      END
  FROM public.broadcasts AS broadcast,
       target_account
  WHERE recipient.broadcast_id = broadcast.id
    AND broadcast.account_id = target_account.account_id
    AND recipient.whatsapp_message_id = p_message_id
    AND CASE p_status
      WHEN 'sent' THEN recipient.status = 'pending'
      WHEN 'delivered' THEN recipient.status IN ('pending', 'sent')
      WHEN 'read' THEN recipient.status IN ('pending', 'sent', 'delivered')
      WHEN 'failed' THEN recipient.status IN ('pending', 'sent')
      ELSE FALSE
    END;
END;
$function$;

ALTER FUNCTION public.apply_whatsapp_status_callback(
  TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.apply_whatsapp_status_callback(
  TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_whatsapp_status_callback(
  TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT
) TO service_role;
