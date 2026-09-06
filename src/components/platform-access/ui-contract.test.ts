import { describe, expect, it } from 'vitest';
import type { OrganizationAccess } from '@/lib/platform-access/model';
import {
  availableAccessActions,
  validAccessReason,
  accessSupportMessage,
  accessSupportWhatsApp,
} from './ui-contract';
const access: OrganizationAccess = {
  organization_id: 'org-1',
  mode: 'trial',
  trial_started_at: null,
  trial_ends_at: null,
  access_starts_at: null,
  access_ends_at: null,
  suspended_at: null,
  version: 1,
};
describe('Access controls', () => {
  it('offers only restore while suspended, including expired trials', () => {
    expect(
      availableAccessActions(
        { ...access, suspended_at: '2026-09-06T00:00:00Z' },
        'expired'
      )
    ).toEqual(['restore']);
    expect(availableAccessActions(access, 'suspended')).toEqual(['restore']);
  });
  it('offers extension only for unsuspended trials and never offers restore', () => {
    expect(availableAccessActions(access, 'trial')).toEqual([
      'extend_trial',
      'activate',
      'suspend',
    ]);
    expect(availableAccessActions(access, 'expired')).toEqual([
      'extend_trial',
      'activate',
      'suspend',
    ]);
    expect(
      availableAccessActions({ ...access, mode: 'manual' }, 'active')
    ).toEqual(['activate', 'suspend']);
    expect(
      availableAccessActions(
        { ...access, mode: 'complimentary' },
        'complimentary'
      )
    ).toEqual(['activate', 'suspend']);
  });
  it('matches the database trimmed reason length contract', () => {
    expect(validAccessReason(' ab ')).toBe(false);
    expect(validAccessReason(' abc ')).toBe(true);
    expect(validAccessReason(` ${'a'.repeat(1000)} `)).toBe(true);
    expect(validAccessReason('a'.repeat(1001))).toBe(false);
  });
  it('encodes organization context and support reference in WhatsApp links', () => {
    const message = accessSupportMessage('Gym & Fitness', 'org-1');
    const url = new URL(accessSupportWhatsApp('+91 90562 08861', message));
    expect(url.pathname).toBe('/919056208861');
    expect(url.searchParams.get('text')).toContain('Gym & Fitness');
    expect(url.searchParams.get('text')).toContain('Support reference: org-1');
  });
});
