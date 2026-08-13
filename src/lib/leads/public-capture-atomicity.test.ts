import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = process.cwd();
const migrationsDir = join(root, 'supabase/migrations');
const migrationName = readdirSync(migrationsDir)
  .filter((name) => name.endsWith('.sql'))
  .sort()
  .findLast((name) =>
    readFileSync(join(migrationsDir, name), 'utf8').includes(
      'capture_public_lead_form_submission'
    )
  );

if (!migrationName) {
  throw new Error('Missing atomic public lead capture migration');
}

const migration = readFileSync(join(migrationsDir, migrationName), 'utf8');
const consentMigrationName = readdirSync(migrationsDir)
  .filter((name) => name.endsWith('.sql'))
  .sort()
  .findLast((name) =>
    readFileSync(join(migrationsDir, name), 'utf8').includes(
      "v_request_role <> 'service_role'"
    )
  );

if (!consentMigrationName) {
  throw new Error('Missing service-role consent authorization repair');
}

const consentMigration = readFileSync(
  join(migrationsDir, consentMigrationName),
  'utf8'
);
const route = readFileSync(
  join(root, 'src/app/api/lead-forms/[token]/submit/route.ts'),
  'utf8'
);

describe('public lead capture atomicity contract', () => {
  it('commits contact, note, submission, and consent trigger in one RPC', () => {
    expect(migration).toMatch(
      /CREATE OR REPLACE FUNCTION public\.capture_public_lead_form_submission[\s\S]*SECURITY INVOKER[\s\S]*SET search_path = ''/
    );
    expect(migration).toContain('INSERT INTO public.contacts');
    expect(migration).toContain('INSERT INTO public.contact_notes');
    expect(migration).toContain('INSERT INTO public.lead_capture_submissions');
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.capture_public_lead_form_submission[\s\S]*FROM PUBLIC, anon, authenticated;/
    );
  });

  it('authorizes service-role consent through request claims, not definer identity', () => {
    expect(consentMigration).toContain("auth.jwt()->>'role'");
    expect(consentMigration).toContain("v_request_role <> 'service_role'");
    expect(consentMigration).not.toContain("current_user <> 'service_role'");
    expect(consentMigration).toMatch(
      /SECURITY DEFINER[\s\S]*SET search_path = pg_catalog, public/
    );
  });

  it('uses only the atomic RPC before scheduling new-contact automation', () => {
    const captureAt = route.indexOf(
      ".rpc('capture_public_lead_form_submission'"
    );
    const afterAt = route.indexOf('after(() =>', captureAt);
    const acknowledgeAt = route.indexOf(
      'return NextResponse.json(SUCCESS)',
      afterAt
    );

    expect(captureAt).toBeGreaterThan(0);
    expect(afterAt).toBeGreaterThan(captureAt);
    expect(acknowledgeAt).toBeGreaterThan(afterAt);
    expect(route).not.toContain("from('contact_notes')");
    expect(route).not.toContain("from('lead_capture_submissions')");
  });
});
