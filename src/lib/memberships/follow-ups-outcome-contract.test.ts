import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  LEAD_FOLLOW_UP_OUTCOMES,
  MEMBER_FOLLOW_UP_OUTCOMES,
} from './follow-ups';

const REPAIR_MIGRATION = resolve(
  process.cwd(),
  'supabase/migrations/20260719220919_repair_follow_up_outcome_constraint.sql'
);

describe('follow-up outcome contract', () => {
  it('keeps every UI completion outcome in the database CHECK', () => {
    const sql = readFileSync(REPAIR_MIGRATION, 'utf8');
    const check = sql.match(
      /ADD CONSTRAINT follow_ups_outcome_check[\s\S]*?\n\s*\);/
    )?.[0];

    expect(check).toBeDefined();

    const databaseOutcomes = Array.from(
      check?.matchAll(/'([^']+)'/g) ?? [],
      (match) => match[1]
    ).sort();
    const uiOutcomes = Array.from(
      new Set([...MEMBER_FOLLOW_UP_OUTCOMES, ...LEAD_FOLLOW_UP_OUTCOMES])
    ).sort();

    expect(databaseOutcomes).toEqual(uiOutcomes);
  });
});
