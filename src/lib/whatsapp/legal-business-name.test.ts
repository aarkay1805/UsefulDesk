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

  it('does not treat the gym brand as a legal business name', () => {
    expect(
      resolveLegalBusinessName({ legal_name: ' ', name: ' FitZone ' })
    ).toBeNull();
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
  it('uses the authenticated branch listing when legal-entity RLS hides the row', async () => {
    const db = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: { legal_entity: null },
              error: null,
            }),
          }),
        }),
      }),
      rpc: async (name: string) => {
        expect(name).toBe('my_branch_accounts');
        return {
          data: [
            {
              account_id: 'akash-account',
              legal_entity_legal_name: 'valiance boxing & fitness',
            },
            {
              account_id: 'rajat-account',
              legal_entity_legal_name: 'rajat Kashyap',
            },
          ],
          error: null,
        };
      },
    };

    await expect(loadLegalBusinessName(db, 'akash-account')).resolves.toEqual({
      ok: true,
      name: 'valiance boxing & fitness',
    });
    await expect(loadLegalBusinessName(db, 'rajat-account')).resolves.toEqual({
      ok: true,
      name: 'rajat Kashyap',
    });
  });

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
      ['select', 'legal_entity:legal_entities(legal_name)'],
      ['id', 'account-1'],
    ]);
  });

  it('does not turn a branch-list brand label into a legal identity', async () => {
    const db = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: { legal_entity: null },
              error: null,
            }),
          }),
        }),
      }),
      rpc: async () => ({
        data: [
          {
            account_id: 'account-1',
            legal_entity_name: 'Iron House',
            legal_entity_legal_name: null,
          },
        ],
        error: null,
      }),
    };

    await expect(loadLegalBusinessName(db, 'account-1')).resolves.toEqual({
      ok: false,
      code: 'legal_business_identity_missing',
    });
  });

  it('accepts the old RPC legal-name projection during app-first rollout', async () => {
    const db = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: { legal_entity: null },
              error: null,
            }),
          }),
        }),
      }),
      rpc: async () => ({
        data: [
          { account_id: 'account-1', legal_entity_name: 'Old legal name' },
        ],
        error: null,
      }),
    };

    await expect(loadLegalBusinessName(db, 'account-1')).resolves.toEqual({
      ok: true,
      name: 'Old legal name',
    });
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
