import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = process.cwd();
const migrationsDir = join(root, 'supabase/migrations');
const migrations = readdirSync(migrationsDir)
  .filter((name) => name.endsWith('.sql'))
  .sort();

function latestMigrationContaining(fragment: string) {
  const name = migrations
    .filter((migration) =>
      readFileSync(join(migrationsDir, migration), 'utf8').includes(fragment)
    )
    .at(-1);
  if (!name) throw new Error(`No migration contains ${fragment}`);
  return readFileSync(join(migrationsDir, name), 'utf8');
}

const receiptSql = latestMigrationContaining('record_whatsapp_webhook_receipt');
const route = readFileSync(
  join(root, 'src/app/api/whatsapp/webhook/route.ts'),
  'utf8'
);
const workflow = readFileSync(
  join(root, '.github/workflows/ops-crons.yml'),
  'utf8'
);

describe('WhatsApp webhook durable receipt contract', () => {
  it('records a verified payload before registering work or acknowledging Meta', () => {
    const recordAt = route.indexOf("'record_whatsapp_webhook_receipt'");
    const afterAt = route.indexOf('after(async () =>', recordAt);
    const acknowledgeAt = route.indexOf(
      "NextResponse.json({ status: 'received' }",
      recordAt
    );

    expect(recordAt).toBeGreaterThan(0);
    expect(afterAt).toBeGreaterThan(recordAt);
    expect(acknowledgeAt).toBeGreaterThan(afterAt);
    expect(route).toContain("{ error: 'Webhook receipt unavailable' }");
    expect(route).toContain('{ status: 503 }');
  });

  it('keeps receipts service-only and claims recovery work atomically', () => {
    expect(receiptSql).toContain(
      'CREATE TABLE IF NOT EXISTS public.whatsapp_webhook_receipts'
    );
    expect(receiptSql).toContain(
      'ALTER TABLE public.whatsapp_webhook_receipts ENABLE ROW LEVEL SECURITY'
    );
    expect(receiptSql).toMatch(
      /REVOKE ALL ON public\.whatsapp_webhook_receipts\s+FROM PUBLIC, anon, authenticated;/
    );
    expect(receiptSql).toMatch(
      /CREATE OR REPLACE FUNCTION public\.claim_whatsapp_webhook_receipts[\s\S]*?SECURITY INVOKER[\s\S]*?SET search_path = ''[\s\S]*?FOR UPDATE OF receipt SKIP LOCKED/
    );
    expect(receiptSql).toContain("receipt.processing_status = 'processing'");
    expect(receiptSql).toContain(
      "next_attempt_at = clock_timestamp() + INTERVAL '5 minutes'"
    );
  });

  it('erases processed payloads and schedules the authenticated recovery drain', () => {
    expect(receiptSql).toMatch(
      /CREATE OR REPLACE FUNCTION public\.complete_whatsapp_webhook_receipt[\s\S]*?processing_status = 'processed'[\s\S]*?payload = NULL/
    );
    expect(workflow).toContain('Recover WhatsApp webhook receipts');
    expect(workflow).toContain(
      'https://desk.usefulmade.com/api/whatsapp/webhook'
    );
  });
});
