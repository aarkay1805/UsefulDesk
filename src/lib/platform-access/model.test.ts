import { describe, expect, it } from 'vitest';
import {
  resolveProductAccess,
  isProductAccessSnapshot,
  type OrganizationAccess,
} from './model';
const trial: OrganizationAccess = {
  organization_id: 'org',
  mode: 'trial',
  trial_started_at: '2026-09-01T00:00:00Z',
  trial_ends_at: '2026-09-15T00:00:00Z',
  access_starts_at: null,
  access_ends_at: null,
  suspended_at: null,
  version: 1,
};
describe('organization access', () => {
  it('expires at the exact deadline', () => {
    expect(
      resolveProductAccess(trial, Date.parse('2026-09-14T23:59:59.999Z'))
    ).toEqual({ status: 'trial', allowed: true });
    expect(
      resolveProductAccess(trial, Date.parse(trial.trial_ends_at!))
    ).toEqual({ status: 'expired', allowed: false });
  });
  it('does not grant an unverified or malformed trial', () => {
    expect(
      resolveProductAccess(
        { ...trial, trial_started_at: null, trial_ends_at: null },
        Date.now()
      ).allowed
    ).toBe(false);
    expect(
      resolveProductAccess({ ...trial, trial_ends_at: 'invalid' }, Date.now())
        .allowed
    ).toBe(false);
  });
  it('suspension overrides complimentary access and restore does not renew', () => {
    expect(
      resolveProductAccess(
        { ...trial, mode: 'complimentary', suspended_at: '2026-09-02' },
        Date.now()
      )
    ).toEqual({ status: 'suspended', allowed: false });
    expect(resolveProductAccess(trial, Date.parse('2026-10-01'))).toEqual({
      status: 'expired',
      allowed: false,
    });
  });
  it('existing complimentary organizations stay active without dates', () => {
    expect(
      resolveProductAccess(
        {
          ...trial,
          mode: 'complimentary',
          trial_started_at: null,
          trial_ends_at: null,
        },
        Date.parse('2030-01-01')
      )
    ).toEqual({ status: 'complimentary', allowed: true });
  });
  it('honors the manual access period, including a future start', () => {
    const manual = {
      ...trial,
      mode: 'manual' as const,
      access_starts_at: '2026-09-01T00:00:00Z',
      access_ends_at: '2026-10-01T00:00:00Z',
    };
    expect(resolveProductAccess(manual, Date.parse('2026-08-01')).status).toBe(
      'pending'
    );
    expect(resolveProductAccess(manual, Date.parse('2026-09-05')).status).toBe(
      'active'
    );
    expect(resolveProductAccess(manual, Date.parse('2026-10-01')).allowed).toBe(
      false
    );
  });
});

describe('product access RPC protocol', () => {
  const snapshot = {
    access: trial,
    status: 'trial',
    allowed: true,
    enforcement_enabled: true,
    support_email: null,
    support_whatsapp: null,
  };
  it('requires explicit decision booleans and complete valid fields', () => {
    expect(isProductAccessSnapshot(snapshot, 'org')).toBe(true);
    expect(isProductAccessSnapshot({})).toBe(false);
    expect(
      isProductAccessSnapshot({ ...snapshot, enforcement_enabled: undefined })
    ).toBe(false);
    expect(isProductAccessSnapshot({ ...snapshot, allowed: 1 })).toBe(false);
    expect(
      isProductAccessSnapshot({
        ...snapshot,
        access: { ...trial, trial_ends_at: 'bad-date' },
      })
    ).toBe(false);
    expect(
      isProductAccessSnapshot({ ...snapshot, access: { ...trial, version: 0 } })
    ).toBe(false);
    expect(
      isProductAccessSnapshot({ ...snapshot, support_email: undefined })
    ).toBe(false);
  });
  it('rejects mismatched organizations and retains valid denied snapshots', () => {
    expect(isProductAccessSnapshot(snapshot, 'other-org')).toBe(false);
    expect(
      isProductAccessSnapshot(
        { ...snapshot, allowed: false, enforcement_enabled: false },
        'org'
      )
    ).toBe(true);
  });
});
