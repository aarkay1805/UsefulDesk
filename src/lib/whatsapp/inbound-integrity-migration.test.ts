import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/20260811043230_inbound_webhook_integrity.sql'
  ),
  'utf8'
);

describe('inbound webhook integrity migration', () => {
  it('cleans duplicate conversations transactionally and preserves children', () => {
    expect(migration).toContain('DO $cleanup$');
    for (const table of [
      'public.messages',
      'public.message_reactions',
      'public.deals',
      'public.flow_runs',
      'public.notifications',
    ]) {
      expect(migration).toContain(`UPDATE ${table}`);
    }
    expect(migration).toContain('SET reply_to_message_id = v_survivor_message');
    expect(migration).toContain(
      'SET last_prompt_message_id = v_survivor_message'
    );
  });

  it('installs the full unique keys before removing the referral-only key', () => {
    const conversationIndex = migration.indexOf(
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_account_contact'
    );
    const messageIndex = migration.indexOf(
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_conversation_message_id'
    );
    const referralDrop = migration.indexOf(
      'DROP INDEX IF EXISTS public.uniq_messages_referral_delivery'
    );

    expect(conversationIndex).toBeGreaterThan(-1);
    expect(messageIndex).toBeGreaterThan(conversationIndex);
    expect(referralDrop).toBeGreaterThan(messageIndex);
  });

  it('keeps the unread RPC invoker-safe and service-role-only', () => {
    expect(migration).toContain('SECURITY INVOKER');
    expect(migration).not.toContain('SECURITY DEFINER');
    expect(migration).toContain("SET search_path = ''");
    expect(migration).toContain('UPDATE public.conversations');
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION public.bump_conversation_on_inbound(UUID, TEXT) FROM PUBLIC'
    );
    expect(migration).toContain(
      'GRANT EXECUTE ON FUNCTION public.bump_conversation_on_inbound(UUID, TEXT) TO service_role'
    );
  });
});
