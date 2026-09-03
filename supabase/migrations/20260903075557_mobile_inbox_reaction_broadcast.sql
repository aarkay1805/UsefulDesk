-- Extend the account-private native Inbox broadcast with reaction changes.
-- The web client continues to use the existing Postgres Changes publication;
-- mobile receives identifiers only, then re-reads rows through branch RLS.

CREATE OR REPLACE FUNCTION private.broadcast_mobile_inbox_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
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
  ELSIF TG_TABLE_NAME = 'message_reactions' THEN
    target_conversation_id := (row_data->>'conversation_id')::uuid;
    target_message_id := (row_data->>'message_id')::uuid;
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

DROP TRIGGER IF EXISTS broadcast_mobile_reaction_change ON public.message_reactions;
CREATE TRIGGER broadcast_mobile_reaction_change
AFTER INSERT OR UPDATE ON public.message_reactions
FOR EACH ROW EXECUTE FUNCTION private.broadcast_mobile_inbox_change();

DROP TRIGGER IF EXISTS broadcast_mobile_reaction_delete ON public.message_reactions;
CREATE TRIGGER broadcast_mobile_reaction_delete
BEFORE DELETE ON public.message_reactions
FOR EACH ROW EXECUTE FUNCTION private.broadcast_mobile_inbox_change();
