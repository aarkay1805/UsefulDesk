import {
  accessDeadline,
  canMountProduct,
  parseProductAccess,
  type ProductAccessSnapshot,
} from './product-access-service';
jest.mock('../../data/supabase', () => ({ mobileSupabase: {} }));
const now = Date.parse('2026-09-06T00:00:00Z');
const value: ProductAccessSnapshot = {
  access: {
    organization_id: 'org',
    mode: 'trial',
    trial_started_at: '2026-09-01T00:00:00Z',
    trial_ends_at: '2026-09-06T00:00:00Z',
    access_starts_at: null,
    access_ends_at: null,
    suspended_at: null,
    version: 1,
  },
  status: 'trial',
  allowed: true,
  enforcement_enabled: true,
  support_email: null,
  support_whatsapp: null,
};
it('rejects unknown payloads, wrong organization and malformed access', () => {
  for (const candidate of [
    null,
    {},
    { ...value, access: { ...value.access, organization_id: 'another' } },
    { ...value, allowed: 'true' },
    { ...value, access: { ...value.access, trial_ends_at: 'broken' } },
  ]) {
    expect(() => parseProductAccess(candidate, 'org')).toThrow();
  }
});
it('closes at the exact deadline despite a previously allowed server response', () => {
  expect(canMountProduct(null, now)).toBe(false);
  expect(canMountProduct(value, now - 1)).toBe(true);
  expect(canMountProduct(value, now)).toBe(false);
  expect(accessDeadline(value)).toBe(now);
});
it('honors explicit rollout bypass while still requiring the server decision', () => {
  expect(canMountProduct({ ...value, enforcement_enabled: false }, now)).toBe(
    true
  );
  expect(
    canMountProduct(
      { ...value, enforcement_enabled: false, allowed: false },
      now
    )
  ).toBe(false);
});
it('suspension overrides complimentary access', () => {
  expect(
    canMountProduct(
      {
        ...value,
        access: {
          ...value.access,
          mode: 'complimentary',
          suspended_at: '2026-09-05T00:00:00Z',
        },
      },
      now
    )
  ).toBe(false);
});
