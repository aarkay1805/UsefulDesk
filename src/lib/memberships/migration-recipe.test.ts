import { describe, expect, it } from 'vitest';
import {
  buildMigrationAnalysis,
  normalizeMemberMigrationStatus,
  splitPlanDuration,
  suggestMemberMigrationRecipe,
  validateMemberMigrationRecipe,
} from './migration-recipe';

const HEADERS = [
  'MEMBER ID',
  'MEMBER NAME',
  'CONTACT',
  'MEMBERSHIP',
  'START DATE',
  'END DATE',
  'BALANCE',
  'STATUS',
  'ACTUAL AMT',
  'DISCOUNTED AMT',
  'PAID AMP',
];

describe('member migration recipe', () => {
  it('builds only aggregate format metadata and never includes source values', () => {
    const analysis = buildMigrationAnalysis({
      headers: ['MEMBER NAME', 'CONTACT', 'START DATE', 'FEE'],
      rows: [
        ['Asha Kapoor', '9876543210', '01-Jan-2026', '12000'],
        ['Ravi Shah', '', '02-Feb-2026', '9000'],
      ],
    });

    expect(Object.keys(analysis)).toEqual([
      'headers',
      'rowCount',
      'inferredTypes',
      'blankCounts',
      'distinctCounts',
      'formatStatistics',
    ]);
    expect(analysis).toMatchObject({
      rowCount: 2,
      inferredTypes: {
        'MEMBER NAME': 'text',
        CONTACT: 'phone',
        'START DATE': 'date',
        FEE: 'number',
      },
      blankCounts: { CONTACT: 1 },
      distinctCounts: {
        'MEMBER NAME': 2,
        CONTACT: 1,
        'START DATE': 2,
        FEE: 2,
      },
    });
    const serialized = JSON.stringify(analysis);
    expect(serialized).not.toContain('Asha Kapoor');
    expect(serialized).not.toContain('9876543210');
    expect(serialized).not.toContain('12000');
  });

  it('only accepts allowlisted fields and real source columns', () => {
    const recipe = suggestMemberMigrationRecipe(HEADERS);
    expect(validateMemberMigrationRecipe(recipe, HEADERS).ok).toBe(true);
    expect(
      validateMemberMigrationRecipe(
        { ...recipe, mappings: { ...recipe.mappings, sql: 'MEMBER ID' } },
        HEADERS
      ).ok
    ).toBe(false);
    expect(
      validateMemberMigrationRecipe(
        { ...recipe, mappings: { phone: 'DOES NOT EXIST' } },
        HEADERS
      ).ok
    ).toBe(false);
  });

  it('classifies explicit membership and service headers separately', () => {
    const recipe = suggestMemberMigrationRecipe([
      'Phone',
      'Package',
      'Membership plan',
      'Service',
      'Service option',
    ]);
    expect(recipe.mappings).toMatchObject({
      phone: 'Phone',
      offering: 'Package',
      membership_plan: 'Membership plan',
      service: 'Service',
      service_option: 'Service option',
    });
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

  it('interprets inactive from the explicit expiry using the selected date order', () => {
    expect(
      normalizeMemberMigrationStatus(
        'INACTIVE',
        '31/12/2025',
        'DMY',
        '2026-07-26'
      )
    ).toBe('expired');
    expect(
      normalizeMemberMigrationStatus(
        'INACTIVE',
        '12/31/2026',
        'MDY',
        '2026-07-26'
      )
    ).toBe('cancelled');
    expect(
      normalizeMemberMigrationStatus(
        'FREEZED',
        '31/12/2025',
        'DMY',
        '2026-07-26'
      )
    ).toBe('FREEZED');
  });
});
