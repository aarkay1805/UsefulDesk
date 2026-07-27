-- ============================================================
-- WhatsApp Click-to-WhatsApp referral attribution
--
-- Meta includes `message.referral` on inbound messages that begin from
-- a Click-to-WhatsApp ad or post. Keep that normalized attribution on
-- the message itself so every referral touch survives independently.
--
-- Tenancy and RLS need no new policy: messages are already isolated
-- through their conversation -> account relationship (migration 017).
-- The existing conversation index remains the Inbox read path.
-- ============================================================

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS referral JSONB;

ALTER TABLE public.messages
  DROP CONSTRAINT IF EXISTS messages_referral_object_check;
ALTER TABLE public.messages
  ADD CONSTRAINT messages_referral_object_check
  CHECK (referral IS NULL OR jsonb_typeof(referral) = 'object');

COMMENT ON COLUMN public.messages.referral IS
  'Normalized Meta message.referral attribution for this inbound WhatsApp message.';

-- Meta retries the same webhook delivery. Referral-bearing messages can
-- be made idempotent without changing historical non-referral message
-- semantics or assuming Meta message IDs are globally unique across
-- WhatsApp numbers: uniqueness is scoped to the conversation and only
-- applies when a referral is present.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_messages_referral_delivery
  ON public.messages (conversation_id, message_id)
  WHERE message_id IS NOT NULL AND referral IS NOT NULL;
