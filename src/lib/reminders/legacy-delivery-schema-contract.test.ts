import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const migrationsDir = path.resolve(process.cwd(), 'supabase/migrations');

function migration() {
  const file = fs
    .readdirSync(migrationsDir)
    .find((name) => name.endsWith('_legacy_reminder_provider_attempts.sql'));
  expect(file).toBeDefined();
  return fs.readFileSync(path.join(migrationsDir, file!), 'utf8');
}

describe('legacy reminder provider-attempt durability schema', () => {
  it('records claimed, attempting, accepted, and ambiguous membership and installment outcomes', () => {
    const sql = migration();
    expect(sql).toMatch(
      /ALTER TABLE public\.renewal_reminders_sent[\s\S]*delivery_state/
    );
    expect(sql).toMatch(
      /ALTER TABLE public\.installment_reminders_sent[\s\S]*delivery_state/
    );
    expect(sql).toMatch(
      /'claimed'[\s\S]*'attempting'[\s\S]*'accepted'[\s\S]*'ambiguous'/
    );
    expect(sql).toContain('provider_attempted_at');
    expect(sql).toContain('last_error');
  });

  it('never reclaims a service reminder after its provider boundary was crossed', () => {
    const sql = migration();
    expect(sql).toMatch(
      /service_renewal_reminders_sent\.status = 'failed'[\s\S]*provider_attempted_at IS NULL/
    );
    expect(sql).toMatch(/status = 'ambiguous'/);
  });

  it('reports known provider ids as accepted and unknown attempted outcomes as ambiguous in Activity', () => {
    const sql = migration();
    expect(sql).toMatch(/wa_message_id IS NOT NULL THEN 'accepted'/);
    expect(sql).toMatch(
      /delivery_state IN \('attempting', 'ambiguous'\) THEN 'ambiguous'/
    );
    expect(sql).toMatch(
      /ledger\.status IN \('attempting', 'ambiguous'\) THEN 'ambiguous'/
    );
  });
});
