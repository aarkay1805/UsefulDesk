import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

const migration = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/20260901090000_mobile_inbox_private_broadcast.sql'
  ),
  'utf8'
);

it('authorizes private account topics through real membership', () => {
  expect(migration).toContain('ON realtime.messages');
  expect(migration).toContain('FOR SELECT');
  expect(migration).toContain("realtime.messages.extension = 'broadcast'");
  expect(migration).toContain('private.can_receive_mobile_inbox_topic(');
  expect(migration).toContain("'account:' || membership.account_id::text");
  expect(migration).toContain('membership.user_id = (SELECT auth.uid())');
});

it('broadcasts identifiers from both Inbox tables without message content', () => {
  expect(migration).toContain('PERFORM realtime.send(');
  expect(migration).toContain("'conversationId'");
  expect(migration).toContain("'messageId'");
  expect(migration).toContain('ON public.conversations');
  expect(migration).toContain('ON public.messages');
  expect(migration).not.toContain("'contentText'");
  expect(migration).not.toContain("'content_text'");
  expect(migration).not.toContain("'media_url'");
});
