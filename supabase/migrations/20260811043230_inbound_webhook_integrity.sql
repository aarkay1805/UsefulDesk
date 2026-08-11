-- Prevent duplicate conversations and replayed Meta messages from fragmenting
-- inbox state or repeating downstream effects. Cleanup is intentionally kept
-- inside this migration's anonymous transaction rather than exposed as a
-- callable maintenance function.

DO $cleanup$
DECLARE
  v_conversation_group RECORD;
  v_message_group RECORD;
  v_survivor_conversation UUID;
  v_loser_conversations UUID[];
  v_survivor_message UUID;
  v_loser_messages UUID[];
  v_all_messages UUID[];
  v_latest_text TEXT;
  v_latest_at TIMESTAMPTZ;
BEGIN
  -- Keep the oldest conversation for each tenant/contact pair. Before moving
  -- messages, collapse Meta-message duplicates across the whole group so the
  -- existing referral-only unique index cannot reject the re-parenting.
  FOR v_conversation_group IN
    SELECT
      account_id,
      contact_id,
      array_agg(id ORDER BY created_at ASC, id ASC) AS ids,
      LEAST(COALESCE(SUM(unread_count), 0), 2147483647)::INTEGER AS total_unread
    FROM public.conversations
    GROUP BY account_id, contact_id
    HAVING count(*) > 1
  LOOP
    v_survivor_conversation := v_conversation_group.ids[1];
    v_loser_conversations :=
      v_conversation_group.ids[2:array_length(v_conversation_group.ids, 1)];

    FOR v_message_group IN
      SELECT
        message_id,
        array_agg(id ORDER BY created_at ASC, id ASC) AS ids
      FROM public.messages
      WHERE conversation_id = ANY(v_conversation_group.ids)
        AND message_id IS NOT NULL
      GROUP BY message_id
      HAVING count(*) > 1
    LOOP
      v_all_messages := v_message_group.ids;
      v_survivor_message := v_all_messages[1];
      v_loser_messages := v_all_messages[2:array_length(v_all_messages, 1)];

      -- A reaction is unique per message/actor. Keep one actor reaction before
      -- re-pointing all survivors to the canonical message.
      DELETE FROM public.message_reactions reaction
      USING (
        SELECT id
        FROM (
          SELECT
            id,
            row_number() OVER (
              PARTITION BY actor_type, actor_id
              ORDER BY id ASC
            ) AS row_number
          FROM public.message_reactions
          WHERE message_id = ANY(v_all_messages)
        ) ranked
        WHERE ranked.row_number > 1
      ) duplicate_reaction
      WHERE reaction.id = duplicate_reaction.id;

      UPDATE public.message_reactions
      SET message_id = v_survivor_message,
          conversation_id = v_survivor_conversation
      WHERE message_id = ANY(v_all_messages);

      UPDATE public.messages
      SET reply_to_message_id = v_survivor_message
      WHERE reply_to_message_id = ANY(v_loser_messages);

      UPDATE public.flow_runs
      SET last_prompt_message_id = v_survivor_message
      WHERE last_prompt_message_id = ANY(v_loser_messages);

      DELETE FROM public.messages
      WHERE id = ANY(v_loser_messages);
    END LOOP;

    UPDATE public.messages
    SET conversation_id = v_survivor_conversation
    WHERE conversation_id = ANY(v_loser_conversations);

    UPDATE public.message_reactions
    SET conversation_id = v_survivor_conversation
    WHERE conversation_id = ANY(v_loser_conversations);

    UPDATE public.deals
    SET conversation_id = v_survivor_conversation
    WHERE conversation_id = ANY(v_loser_conversations);

    UPDATE public.flow_runs
    SET conversation_id = v_survivor_conversation
    WHERE conversation_id = ANY(v_loser_conversations);

    UPDATE public.notifications
    SET conversation_id = v_survivor_conversation
    WHERE conversation_id = ANY(v_loser_conversations);

    SELECT content_text, created_at
    INTO v_latest_text, v_latest_at
    FROM public.messages
    WHERE conversation_id = v_survivor_conversation
    ORDER BY created_at DESC, id DESC
    LIMIT 1;

    UPDATE public.conversations
    SET unread_count = v_conversation_group.total_unread,
        last_message_text = CASE WHEN v_latest_at IS NULL THEN last_message_text ELSE v_latest_text END,
        last_message_at = COALESCE(v_latest_at, last_message_at),
        updated_at = now()
    WHERE id = v_survivor_conversation;

    DELETE FROM public.conversations
    WHERE id = ANY(v_loser_conversations);
  END LOOP;

  -- Collapse any remaining replay duplicates already within one conversation.
  -- Reply links, Flow prompt pointers, and reactions all keep pointing at the
  -- oldest stored delivery before the redundant message row is removed.
  FOR v_message_group IN
    SELECT
      conversation_id,
      message_id,
      array_agg(id ORDER BY created_at ASC, id ASC) AS ids
    FROM public.messages
    WHERE message_id IS NOT NULL
    GROUP BY conversation_id, message_id
    HAVING count(*) > 1
  LOOP
    v_all_messages := v_message_group.ids;
    v_survivor_message := v_all_messages[1];
    v_loser_messages := v_all_messages[2:array_length(v_all_messages, 1)];

    DELETE FROM public.message_reactions reaction
    USING (
      SELECT id
      FROM (
        SELECT
          id,
          row_number() OVER (
            PARTITION BY actor_type, actor_id
            ORDER BY id ASC
          ) AS row_number
        FROM public.message_reactions
        WHERE message_id = ANY(v_all_messages)
      ) ranked
      WHERE ranked.row_number > 1
    ) duplicate_reaction
    WHERE reaction.id = duplicate_reaction.id;

    UPDATE public.message_reactions
    SET message_id = v_survivor_message
    WHERE message_id = ANY(v_all_messages);

    UPDATE public.messages
    SET reply_to_message_id = v_survivor_message
    WHERE reply_to_message_id = ANY(v_loser_messages);

    UPDATE public.flow_runs
    SET last_prompt_message_id = v_survivor_message
    WHERE last_prompt_message_id = ANY(v_loser_messages);

    DELETE FROM public.messages
    WHERE id = ANY(v_loser_messages);
  END LOOP;
END
$cleanup$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_account_contact
  ON public.conversations (account_id, contact_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_conversation_message_id
  ON public.messages (conversation_id, message_id);

-- The full idempotency key supersedes the referral-only backstop. Drop it only
-- after the broader unique index exists so there is never an unguarded window.
DROP INDEX IF EXISTS public.uniq_messages_referral_delivery;

CREATE OR REPLACE FUNCTION public.bump_conversation_on_inbound(
  p_conversation_id UUID,
  p_last_message_text TEXT
)
RETURNS VOID
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $function$
  UPDATE public.conversations
  SET unread_count = COALESCE(unread_count, 0) + 1,
      last_message_text = p_last_message_text,
      last_message_at = now(),
      updated_at = now()
  WHERE id = p_conversation_id;
$function$;

ALTER FUNCTION public.bump_conversation_on_inbound(UUID, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.bump_conversation_on_inbound(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bump_conversation_on_inbound(UUID, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.bump_conversation_on_inbound(UUID, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.bump_conversation_on_inbound(UUID, TEXT) TO service_role;
