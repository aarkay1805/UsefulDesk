import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  join(
    process.cwd(),
    'supabase/migrations/20260727200000_whatsapp_referral_attribution.sql'
  ),
  'utf8'
);

const webhook = readFileSync(
  join(process.cwd(), 'src/app/api/whatsapp/webhook/route.ts'),
  'utf8'
);

const integrityMigration = readFileSync(
  join(
    process.cwd(),
    'supabase/migrations/20260811043230_inbound_webhook_integrity.sql'
  ),
  'utf8'
);

describe('WhatsApp referral persistence contract', () => {
  it('stores referral JSON on messages under the existing conversation RLS path', () => {
    expect(migration).toMatch(
      /ALTER TABLE public\.messages[\s\S]*ADD COLUMN IF NOT EXISTS referral JSONB/
    );
    expect(migration).toMatch(
      /CHECK \(referral IS NULL OR jsonb_typeof\(referral\) = 'object'\)/
    );
    expect(migration).not.toMatch(/CREATE TABLE/);
  });

  it('supersedes referral-only dedupe with full inbound delivery idempotency', () => {
    expect(migration).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS uniq_messages_referral_delivery[\s\S]*ON public\.messages \(conversation_id, message_id\)[\s\S]*WHERE message_id IS NOT NULL AND referral IS NOT NULL/
    );
    expect(integrityMigration).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_conversation_message_id[\s\S]*ON public\.messages \(conversation_id, message_id\)/
    );
    expect(integrityMigration).toMatch(
      /DROP INDEX IF EXISTS public\.uniq_messages_referral_delivery/
    );
    expect(webhook).toMatch(
      /onConflict: 'conversation_id,message_id'[\s\S]*ignoreDuplicates: true/
    );
  });

  it('keeps received_via as WhatsApp and compare-and-sets only an absent contact source', () => {
    expect(webhook).toMatch(/received_via: 'whatsapp'/);
    expect(webhook).toMatch(/if \(observed\?\.trim\(\)\) return/);
    expect(webhook).toMatch(
      /observed === null[\s\S]*query\.is\('source', null\)[\s\S]*query\.eq\('source', observed\)/
    );
  });
});
