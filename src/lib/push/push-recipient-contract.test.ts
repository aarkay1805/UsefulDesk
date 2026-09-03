import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/20260903120000_mobile_push_notifications.sql'
  ),
  'utf8'
);

const enqueue = sql.match(
  /CREATE OR REPLACE FUNCTION public\.enqueue_inbound_push_deliveries[\s\S]*?\$function\$;/
)?.[0];

describe('push recipient enqueue contract', () => {
  it('accepts only persisted inbound customer messages and derives tenant joins', () => {
    expect(enqueue).toBeDefined();
    expect(enqueue).toMatch(/message\.sender_type = 'customer'/);
    expect(enqueue).toMatch(/conversation\.id = message\.conversation_id/);
    expect(enqueue).toMatch(/contact\.id = conversation\.contact_id/);
    expect(enqueue).toMatch(/account\.id = conversation\.account_id/);
    expect(enqueue).toMatch(/account\.branch_status = 'active'/);
  });

  it('selects assigned-only or unassigned operational memberships', () => {
    expect(enqueue).toMatch(
      /conversation\.assigned_agent_id IS NOT NULL[\s\S]*?membership\.user_id = conversation\.assigned_agent_id/
    );
    expect(enqueue).toMatch(
      /conversation\.assigned_agent_id IS NULL[\s\S]*?membership\.role IN \('owner', 'admin', 'agent'\)/
    );
    expect(enqueue).toMatch(
      /membership\.account_id = conversation\.account_id/
    );
    expect(enqueue).not.toMatch(/'viewer'/);
  });

  it('fans out only to active installations and suppresses duplicates', () => {
    expect(enqueue).toMatch(/installation\.user_id = membership\.user_id/);
    expect(enqueue).toMatch(/installation\.revoked_at IS NULL/);
    expect(enqueue).toMatch(
      /ON CONFLICT \(message_id, installation_id\) DO NOTHING/
    );
  });

  it('stores approved presentation copy and only opaque routing data', () => {
    expect(enqueue).toMatch(
      /COALESCE\(NULLIF\(btrim\(contact\.name\), ''\), 'WhatsApp contact'\)/
    );
    expect(enqueue).toMatch(
      /WHEN message\.content_type = 'image' THEN 'Photo'/
    );
    expect(enqueue).toMatch(
      /WHEN message\.content_type = 'video' THEN 'Video'/
    );
    expect(enqueue).toMatch(
      /WHEN message\.content_type = 'audio' THEN 'Audio'/
    );
    expect(enqueue).toMatch(
      /WHEN message\.content_type = 'document' THEN 'Document'/
    );
    expect(enqueue).toMatch(
      /WHEN message\.content_type = 'location' THEN 'Location'/
    );
    expect(enqueue).toMatch(/ELSE 'New WhatsApp message'/);
    expect(enqueue).toMatch(
      /jsonb_build_object\([\s\S]*?'version'[\s\S]*?'accountId'[\s\S]*?'conversationId'[\s\S]*?'messageId'[\s\S]*?'deliveryId'/
    );

    const payloadExpression = enqueue?.match(
      /jsonb_build_object\([\s\S]*?\n\s*\)/
    )?.[0];
    expect(payloadExpression).not.toMatch(
      /expo_push_token|content_text|phone|access_token|title|body/
    );
  });
});
