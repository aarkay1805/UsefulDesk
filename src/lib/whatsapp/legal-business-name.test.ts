import { describe, expect, it } from 'vitest';

import {
  applyLegalBusinessNameParam,
  loadLegalBusinessName,
  resolveLegalBusinessName,
} from './legal-business-name';

describe('resolveLegalBusinessName', () => {
  it('prefers the legal name and trims provider whitespace', () => {
    expect(
      resolveLegalBusinessName({
        legal_name: '  FitZone Wellness Private Limited  ',
        name: 'FitZone',
      })
    ).toBe('FitZone Wellness Private Limited');
  });

  it('falls back only to the legal entity name', () => {
    expect(
      resolveLegalBusinessName({ legal_name: ' ', name: ' FitZone ' })
    ).toBe('FitZone');
    expect(
      resolveLegalBusinessName({ legal_name: null, name: ' ' })
    ).toBeNull();
  });
});

describe('applyLegalBusinessNameParam', () => {
  it('appends or replaces only the final canonical identity parameter', () => {
    expect(
      applyLegalBusinessNameParam(['Asha', '₹500'], 3, ' FitZone ')
    ).toEqual(['Asha', '₹500', 'FitZone']);
    expect(
      applyLegalBusinessNameParam(['Asha', '₹500', 'Old name'], 3, 'FitZone')
    ).toEqual(['Asha', '₹500', 'FitZone']);
  });

  it('leaves an invalid non-identity arity for the contract validator to reject', () => {
    expect(applyLegalBusinessNameParam(['Asha'], 3, 'FitZone')).toEqual([
      'Asha',
    ]);
  });
});

describe('loadLegalBusinessName', () => {
  it('loads the account legal entity through the shared account-scoped query', async () => {
    const calls: Array<[string, string]> = [];
    const db = {
      from(table: string) {
        expect(table).toBe('accounts');
        return {
          select(columns: string) {
            calls.push(['select', columns]);
            return {
              eq(column: string, value: string) {
                calls.push([column, value]);
                return {
                  maybeSingle: async () => ({
                    data: {
                      legal_entity: {
                        legal_name: 'FitZone Wellness Private Limited',
                        name: 'FitZone',
                      },
                    },
                    error: null,
                  }),
                };
              },
            };
          },
        };
      },
    };

    await expect(loadLegalBusinessName(db, 'account-1')).resolves.toEqual({
      ok: true,
      name: 'FitZone Wellness Private Limited',
    });
    expect(calls).toEqual([
      ['select', 'legal_entity:legal_entities(legal_name, name)'],
      ['id', 'account-1'],
    ]);
  });

  it('distinguishes a missing identity from an unavailable lookup', async () => {
    const db = (result: { data: unknown; error: unknown }) => ({
      from: () => ({
        select: () => ({
          eq: () => ({ maybeSingle: async () => result }),
        }),
      }),
    });

    await expect(
      loadLegalBusinessName(
        db({ data: { legal_entity: null }, error: null }),
        'account-1'
      )
    ).resolves.toEqual({ ok: false, code: 'legal_business_identity_missing' });
    await expect(
      loadLegalBusinessName(
        db({ data: null, error: { message: 'database offline' } }),
        'account-1'
      )
    ).resolves.toEqual({
      ok: false,
      code: 'legal_business_identity_lookup_unavailable',
    });
  });
});
