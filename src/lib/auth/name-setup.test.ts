import { describe, expect, it } from 'vitest';

import { readOrganizationNameSetupState } from './name-setup';

describe('readOrganizationNameSetupState', () => {
  it.each([
    '2026-09-21T12:30:00.000Z',
    '2026-09-21T12:30:00+00:00',
    '2026-09-21T18:00:00.123456+05:30',
    '2024-02-29T23:59:59-04:00',
  ])('treats a valid PostgREST completion timestamp as complete (%s)', (timestamp) => {
    expect(
      readOrganizationNameSetupState({
        organization_name_setup_completed_at: timestamp,
      })
    ).toBe('complete');
  });

  it('preserves an explicit database null as pending', () => {
    expect(
      readOrganizationNameSetupState({
        organization_name_setup_completed_at: null,
      })
    ).toBe('pending');
  });

  it.each([
    undefined,
    {},
    { organization_name_setup_completed_at: undefined },
    { organization_name_setup_completed_at: '' },
    { organization_name_setup_completed_at: 'not-a-timestamp' },
    { organization_name_setup_completed_at: '1' },
    { organization_name_setup_completed_at: '2026' },
    { organization_name_setup_completed_at: '09/21/2026' },
    { organization_name_setup_completed_at: '2026-02-30T00:00:00Z' },
    { organization_name_setup_completed_at: '2025-02-29T00:00:00Z' },
    { organization_name_setup_completed_at: '2026-09-21T24:00:00Z' },
    { organization_name_setup_completed_at: '2026-09-21T12:60:00Z' },
    { organization_name_setup_completed_at: '2026-09-21T12:30:60Z' },
    { organization_name_setup_completed_at: '2026-09-21T12:30:00' },
    { organization_name_setup_completed_at: '2026-09-21 12:30:00+00:00' },
    { organization_name_setup_completed_at: '2026-09-21T12:30:00+14:01' },
    { organization_name_setup_completed_at: '2026-09-21T12:30:00+15:00' },
    { organization_name_setup_completed_at: ' 2026-09-21T12:30:00Z ' },
    { organization_name_setup_completed_at: 123 },
  ])('fails closed when the completion state is unavailable (%j)', (row) => {
    expect(readOrganizationNameSetupState(row)).toBe('unavailable');
  });
});
