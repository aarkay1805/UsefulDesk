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
      'claim_public_broadcast_recipients'
    )
  );

if (!migrationName) {
  throw new Error('Missing public broadcast recovery migration');
}

const migration = readFileSync(join(migrationsDir, migrationName), 'utf8');
const core = readFileSync(
  join(root, 'src/lib/whatsapp/broadcast-core.ts'),
  'utf8'
);
const postRoute = readFileSync(
  join(root, 'src/app/api/v1/broadcasts/route.ts'),
  'utf8'
);
const cronRoute = readFileSync(
  join(root, 'src/app/api/v1/broadcasts/cron/route.ts'),
  'utf8'
);
const workflow = readFileSync(
  join(root, '.github/workflows/ops-crons.yml'),
  'utf8'
);

describe('public API broadcast durability contract', () => {
  it('persists the complete recipient payload before acknowledging 202', () => {
    expect(core).toContain('destination_phone: r.phone');
    expect(core).toContain('template_params: r.params');

    const createAt = postRoute.indexOf('await createBroadcast(');
    const afterAt = postRoute.indexOf('after(() => deliverBroadcast', createAt);
    const acknowledgeAt = postRoute.indexOf('return ok(', afterAt);
    expect(createAt).toBeGreaterThan(0);
    expect(afterAt).toBeGreaterThan(createAt);
    expect(acknowledgeAt).toBeGreaterThan(afterAt);
  });

  it('claims pending recipients atomically with an owner lease', () => {
    expect(migration).toMatch(
      /CREATE OR REPLACE FUNCTION public\.claim_public_broadcast_recipients[\s\S]*SECURITY INVOKER[\s\S]*SET search_path = ''[\s\S]*FOR UPDATE OF recipient SKIP LOCKED/
    );
    expect(migration).toContain('send_lease_owner = p_lease_owner');
    expect(migration).toContain(
      'send_attempt_count = recipient.send_attempt_count + 1'
    );
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.claim_public_broadcast_recipients[\s\S]*FROM PUBLIC, anon, authenticated;/
    );
  });

  it('uses lease-owner CAS to complete or fail and finalize only at the end', () => {
    expect(migration).toMatch(
      /complete_public_broadcast_recipient[\s\S]*recipient\.send_lease_owner = p_lease_owner/
    );
    expect(migration).toMatch(
      /fail_public_broadcast_recipient[\s\S]*recipient\.send_lease_owner = p_lease_owner/
    );
    expect(migration).toContain("recipient.status = 'pending'");
    expect(migration).toContain("broadcast.status = 'sending'");
  });

  it('schedules the same worker as the after() fast path', () => {
    expect(core).toContain('drainPublicBroadcastRecipients(db, {');
    expect(cronRoute).toContain('isAuthorizedCronRequest(request)');
    expect(cronRoute).toContain('drainPublicBroadcastRecipients(');
    expect(workflow).toContain('Recover public API broadcasts');
    expect(workflow).toContain(
      'https://desk.usefulmade.com/api/v1/broadcasts/cron'
    );
  });
});
