import { describe, expect, it } from 'vitest';
import {
  applyMemberMigrationRecipe,
  splitPlanDuration,
  suggestMemberMigrationRecipe,
  validateMemberMigrationRecipe,
} from './migration-recipe';

const HEADERS = [
  'MEMBER ID', 'MEMBER NAME', 'CONTACT', 'MEMBERSHIP', 'START DATE',
  'END DATE', 'BALANCE', 'STATUS', 'ACTUAL AMT', 'DISCOUNTED AMT', 'PAID AMP',
];

describe('member migration recipe', () => {
  it('only accepts allowlisted fields and real source columns', () => {
    const recipe = suggestMemberMigrationRecipe(HEADERS);
    expect(validateMemberMigrationRecipe(recipe, HEADERS).ok).toBe(true);
    expect(validateMemberMigrationRecipe(
      { ...recipe, mappings: { ...recipe.mappings, sql: 'MEMBER ID' } },
      HEADERS
    ).ok).toBe(false);
    expect(validateMemberMigrationRecipe(
      { ...recipe, mappings: { phone: 'DOES NOT EXIST' } },
      HEADERS
    ).ok).toBe(false);
  });

  it('splits common plan families and terms deterministically', () => {
    expect(splitPlanDuration('FITNESS 12M')).toEqual({
      plan: 'FITNESS',
      option: '12 month',
    });
    expect(splitPlanDuration('Boxing Competition 6M')).toEqual({
      plan: 'Boxing Competition',
      option: '6 month',
    });
    expect(splitPlanDuration('Personal Training PER SESSION')).toEqual({
      plan: 'Personal Training',
      option: 'Per session',
    });
  });

  it('selects latest by date, excludes footer, preserves expiry semantics, and blocks unsafe payments', () => {
    const recipe = suggestMemberMigrationRecipe(HEADERS);
    const transformed = applyMemberMigrationRecipe(
      {
        headers: HEADERS,
        rows: [
          ['7', 'Asha old', '9876543210', 'FITNESS 6M', '01-Jan-2025', '30-Jun-2025', '0', 'INACTIVE', '10000', '9000', '9000'],
          ['8', 'Ravi', '9876543210', 'Boxing Competition 6M', '01-Jul-2025', '31-Dec-2025', '2000', 'INACTIVE', '10000', '9000', '8000'],
          ['7', 'Asha latest', '', 'FITNESS 12M', '01-Jan-2026', '31-Dec-2026', '0', 'ACTIVE', '12000', '10000', '11000'],
          ['Number of records: 3'],
        ],
      },
      recipe,
      { today: '2026-07-26', dialCode: '+91' }
    );
    expect(transformed.raw.rows).toHaveLength(2);
    expect(transformed.counts.excluded).toBe(2);
    expect(transformed.issues.map((issue) => issue.code)).toContain('missing-phone');
    expect(transformed.issues.map((issue) => issue.code)).toContain('payment-mismatch');
    expect(transformed.raw.rows[0][2]).toBe('FITNESS');
    expect(transformed.raw.rows[0][3]).toBe('12 month');
    expect(transformed.raw.rows[0][8]).toBe('');
    expect(transformed.raw.rows[1][6]).toBe('expired');
  });

  it('never silently merges distinct IDs sharing a phone', () => {
    const recipe = suggestMemberMigrationRecipe(HEADERS);
    const rows = [
      ['1', 'One', '9999999999', 'FITNESS 1M', '01-Jan-2026', '31-Jan-2026', '0', 'ACTIVE', '1000', '1000', '1000'],
      ['2', 'Two', '9999999999', 'FITNESS 1M', '01-Feb-2026', '28-Feb-2026', '0', 'ACTIVE', '1000', '1000', '1000'],
    ];
    const result = applyMemberMigrationRecipe(
      { headers: HEADERS, rows },
      recipe,
      { today: '2026-07-26', dialCode: '+91' }
    );
    expect(result.issues.filter((issue) => issue.code === 'shared-phone')).toHaveLength(2);
    expect(result.raw.rows.every((row) => row[0] === '')).toBe(true);
  });
});
