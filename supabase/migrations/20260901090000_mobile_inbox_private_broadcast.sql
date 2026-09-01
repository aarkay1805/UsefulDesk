CREATE OR REPLACE FUNCTION private.can_receive_mobile_inbox_topic(
  target_topic text
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.account_memberships AS membership
    WHERE membership.user_id = (SELECT auth.uid())
      AND target_topic = 'account:' || membership.account_id::text
  );
$$;

REVOKE ALL ON FUNCTION private.can_receive_mobile_inbox_topic(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.can_receive_mobile_inbox_topic(text) FROM anon;
GRANT EXECUTE ON FUNCTION private.can_receive_mobile_inbox_topic(text)
  TO authenticated, service_role;

DROP POLICY IF EXISTS mobile_inbox_broadcast_select ON realtime.messages;
CREATE POLICY mobile_inbox_broadcast_select
ON realtime.messages FOR SELECT
TO authenticated
USING (
  realtime.messages.extension = 'broadcast'
  AND private.can_receive_mobile_inbox_topic((SELECT realtime.topic()))
);

CREATE OR REPLACE FUNCTION private.broadcast_mobile_inbox_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, realtime
AS $$
DECLARE
  row_data jsonb;
  target_account_id uuid;
  target_conversation_id uuid;
  target_message_id uuid;
BEGIN
  row_data := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;

  IF TG_TABLE_NAME = 'conversations' THEN
    target_account_id := (row_data->>'account_id')::uuid;
    target_conversation_id := (row_data->>'id')::uuid;
    target_message_id := NULL;
  ELSIF TG_TABLE_NAME = 'messages' THEN
    target_conversation_id := (row_data->>'conversation_id')::uuid;
    target_message_id := (row_data->>'id')::uuid;
    SELECT conversation.account_id
      INTO target_account_id
      FROM public.conversations AS conversation
      WHERE conversation.id = target_conversation_id;
  ELSE
    RAISE EXCEPTION 'Unsupported mobile Inbox broadcast table';
  END IF;

  IF target_account_id IS NOT NULL THEN
    PERFORM realtime.send(
      jsonb_build_object(
        'table', TG_TABLE_NAME,
        'eventType', TG_OP,
        'accountId', target_account_id,
        'conversationId', target_conversation_id,
        'messageId', target_message_id
      ),
      'inbox_change',
      'account:' || target_account_id::text,
      true
    );
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.broadcast_mobile_inbox_change() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.broadcast_mobile_inbox_change() FROM anon;
REVOKE ALL ON FUNCTION private.broadcast_mobile_inbox_change() FROM authenticated;

DROP TRIGGER IF EXISTS broadcast_mobile_conversation_change ON public.conversations;
CREATE TRIGGER broadcast_mobile_conversation_change
AFTER INSERT OR UPDATE OR DELETE ON public.conversations
FOR EACH ROW EXECUTE FUNCTION private.broadcast_mobile_inbox_change();

DROP TRIGGER IF EXISTS broadcast_mobile_message_change ON public.messages;
CREATE TRIGGER broadcast_mobile_message_change
AFTER INSERT OR UPDATE ON public.messages
FOR EACH ROW EXECUTE FUNCTION private.broadcast_mobile_inbox_change();

DROP TRIGGER IF EXISTS broadcast_mobile_message_delete ON public.messages;
CREATE TRIGGER broadcast_mobile_message_delete
BEFORE DELETE ON public.messages
FOR EACH ROW EXECUTE FUNCTION private.broadcast_mobile_inbox_change();
