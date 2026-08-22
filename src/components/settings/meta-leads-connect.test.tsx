import { describe, expect, it } from 'vitest';

import { resolveMetaLeadPageDisplay } from './meta-leads-health';

const base = {
  status: 'connected',
  health_lease_until: null,
  health_checked_at: '2026-08-22T08:00:00.000Z',
  last_healthy_at: '2026-08-22T08:00:00.000Z',
  last_repair_at: null,
  health_error_code: null,
  health_error_resolution: null,
  consecutive_health_failures: 0,
};

describe('Meta Page health presentation', () => {
  it.each([
    [{ ...base, health_lease_until: '2026-08-22T09:05:00.000Z' }, 'Checking'],
    [base, 'Healthy'],
    [{ ...base, last_repair_at: '2026-08-22T08:00:00.000Z' }, 'Repaired'],
    [
      {
        ...base,
        status: 'error',
        health_error_code: 'meta_transient',
        consecutive_health_failures: 3,
      },
      'Needs attention',
    ],
    [
      { ...base, status: 'error', health_error_code: 'token_invalid' },
      'Reconnect required',
    ],
  ])('maps stored health to %s', (page, label) => {
    expect(
      resolveMetaLeadPageDisplay(page, new Date('2026-08-22T09:00:00.000Z'))
        .label
    ).toBe(label);
  });
});
