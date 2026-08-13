import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = process.cwd();
const migrationsDir = join(root, 'supabase/migrations');
const migrationNames = readdirSync(migrationsDir)
  .filter((name) => name.endsWith('.sql'))
  .sort()
  .filter((name) =>
    readFileSync(join(migrationsDir, name), 'utf8').includes(
      'capture_meta_lead_webhook_event'
    )
  );

if (migrationNames.length === 0) {
  throw new Error('Missing retry-safe Meta lead capture migration');
}

const migration = migrationNames
  .map((name) => readFileSync(join(migrationsDir, name), 'utf8'))
  .join('\n');
const route = readFileSync(
  join(root, 'src/app/api/meta/leads/webhook/route.ts'),
  'utf8'
);

describe('Meta lead capture retry contract', () => {
  it('atomically retains the contact, one note, and original creation state', () => {
    expect(migration).toContain(
      'ADD COLUMN IF NOT EXISTS processing_context JSONB'
    );
    expect(migration).toMatch(
      /CREATE OR REPLACE FUNCTION public\.capture_meta_lead_webhook_event[\s\S]*SECURITY INVOKER[\s\S]*SET search_path = ''/
    );
    expect(migration).toContain('INSERT INTO public.contacts');
    expect(migration).toContain('INSERT INTO public.contact_notes');
    expect(migration).toContain("'{meta_lead}'");
    expect(migration).toContain("'created_contact', v_created");
    expect(migration).toContain("'note_id', v_note_id");
    expect(migration).toContain(
      "COALESCE(NULLIF(btrim(COALESCE(p_name, '')), ''), v_phone)"
    );
  });

  it('leases failed deliveries and keeps its RPCs service-only', () => {
    expect(migration).toMatch(
      /CREATE OR REPLACE FUNCTION public\.claim_meta_lead_webhook_event[\s\S]*processing_status IN \('pending', 'failed'\)/
    );
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION public.fail_meta_lead_webhook_event'
    );
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.capture_meta_lead_webhook_event[\s\S]*FROM PUBLIC, anon, authenticated;/
    );
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.capture_meta_lead_webhook_event[\s\S]*TO service_role;/
    );
  });

  it('resumes the durable capture before completing the event', () => {
    const claimAt = route.indexOf(
      ".rpc(\n        'claim_meta_lead_webhook_event'"
    );
    const captureAt = route.indexOf(
      ".rpc('capture_meta_lead_webhook_event'",
      claimAt
    );
    const automationAt = route.indexOf(
      'await runAutomationsForTrigger',
      captureAt
    );
    const markAt = route.indexOf(
      "'mark_meta_lead_automation_dispatched'",
      automationAt
    );
    const completeAt = route.indexOf(
      "'complete_meta_lead_webhook_event'",
      markAt
    );

    expect(claimAt).toBeGreaterThan(0);
    expect(captureAt).toBeGreaterThan(claimAt);
    expect(automationAt).toBeGreaterThan(captureAt);
    expect(markAt).toBeGreaterThan(automationAt);
    expect(completeAt).toBeGreaterThan(markAt);
    expect(route).not.toContain('findOrCreateContact');
    expect(route).not.toContain("from('contact_notes')");
    expect(route).not.toContain("from('webhook_events').delete()");
  });
});
