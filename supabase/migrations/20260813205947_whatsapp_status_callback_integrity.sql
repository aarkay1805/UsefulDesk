-- Meta can retry and reorder message-status callbacks. Bind every callback to
-- the account that owns the signed payload's phone_number_id and perform the
-- predecessor check in the UPDATE itself so concurrent deliveries cannot
-- regress either inbox messages or broadcast recipients.

CREATE OR REPLACE FUNCTION public.apply_whatsapp_status_callback(
  p_phone_number_id TEXT,
  p_message_id TEXT,
  p_status TEXT,
  p_status_at TIMESTAMPTZ
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

  -- messages.status has no account_id of its own, so scope through the
  -- conversation and the unique WhatsApp config for this phone number.
  -- RETURNING is also the authoritative list for public webhook fan-out:
  -- no row means duplicate, regressive, unknown, or wrong-tenant input.
  RETURN QUERY
  WITH target_account AS (
    SELECT config.account_id
    FROM public.whatsapp_config AS config
    WHERE config.phone_number_id = p_phone_number_id
  )
  UPDATE public.messages AS message
  SET status = p_status
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

  -- The aggregate trigger on broadcast_recipients recomputes the parent
  -- broadcast counts after this atomic transition.
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
        WHEN p_status = 'delivered' THEN COALESCE(recipient.delivered_at, p_status_at)
        ELSE recipient.delivered_at
      END,
      read_at = CASE
        WHEN p_status = 'read' THEN COALESCE(recipient.read_at, p_status_at)
        ELSE recipient.read_at
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

ALTER FUNCTION public.apply_whatsapp_status_callback(TEXT, TEXT, TEXT, TIMESTAMPTZ)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.apply_whatsapp_status_callback(TEXT, TEXT, TEXT, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_whatsapp_status_callback(TEXT, TEXT, TEXT, TIMESTAMPTZ)
  TO service_role;
