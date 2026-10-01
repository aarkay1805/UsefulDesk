import { describe, expect, it } from 'vitest';
import { evaluateWatchdogSnapshot } from './watchdog';

const now = '2026-10-01T16:00:00Z';
function snapshot(overrides = {}, group: 'ops' | 'renewals' = 'ops') {
  return {
    checked_at: now,
    groups: (['ops', 'renewals'] as const).map((name) => ({
      group: name,
      active: true,
      last_response_at: now,
      status_code: 200,
      timed_out: false,
      failed: 0,
      dispatched: name === 'ops' ? 10 : 3,
      ...(name === group ? overrides : {}),
    })),
  };
}

describe('read-only production watchdog', () => {
  it('accepts both complete healthy worker aggregates', () => {
    expect(
      evaluateWatchdogSnapshot(snapshot()).every((row) => row.healthy)
    ).toBe(true);
  });
  it.each([
    [{ active: false }, 'inactive'],
    [{ last_response_at: null }, 'missing'],
    [{ last_response_at: '2026-10-01T15:14:59Z' }, 'stale'],
    [{ last_response_at: 'invalid' }, 'invalid'],
    [{ last_response_at: '2026-10-01T16:00:01Z' }, 'invalid'],
    [{ status_code: 503 }, 'failed'],
    [{ timed_out: true }, 'failed'],
    [{ failed: 1 }, 'failed'],
    [{ failed: '0' }, 'failed'],
    [{ dispatched: 9 }, 'failed'],
    [{ dispatched: 0, skipped: 'disabled' }, 'failed'],
  ])('refuses unhealthy/incomplete evidence %j', (overrides, reason) => {
    expect(evaluateWatchdogSnapshot(snapshot(overrides))[0]).toEqual({
      group: 'ops',
      healthy: false,
      reason,
    });
  });
  it('uses the independent hourly renewal freshness window', () => {
    expect(
      evaluateWatchdogSnapshot(
        snapshot({ last_response_at: '2026-10-01T14:00:00Z' }, 'renewals')
      )[1].healthy
    ).toBe(true);
    expect(
      evaluateWatchdogSnapshot(
        snapshot({ last_response_at: '2026-10-01T13:59:59Z' }, 'renewals')
      )[1].reason
    ).toBe('stale');
  });
  it.each([
    null,
    {},
    { checked_at: now, groups: [] },
    { ...snapshot(), checked_at: 'invalid' },
  ])('fails closed on invalid database snapshots %j', (value) => {
    expect(evaluateWatchdogSnapshot(value).every((row) => !row.healthy)).toBe(
      true
    );
  });
  it('refuses duplicate groups and drops unexpected provider fields', () => {
    const value = snapshot({ provider_body: 'private', failed: 0 });
    expect(JSON.stringify(evaluateWatchdogSnapshot(value))).not.toContain(
      'private'
    );
    value.groups.push(value.groups[0]);
    expect(evaluateWatchdogSnapshot(value)[0].reason).toBe('invalid');
  });
});
