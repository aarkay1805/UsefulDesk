import { describe, expect, it, vi } from 'vitest';

import { mapWithConcurrency, runMetaLeadRecovery } from './recovery';

describe('Meta Lead Ads recovery orchestration', () => {
  it('runs events before Pages and still checks Pages after an event phase failure', async () => {
    const order: string[] = [];
    const result = await runMetaLeadRecovery({
      admin: {} as never,
      dependencies: {
        runEvents: vi.fn(async () => {
          order.push('events');
          throw new Error('event claim unavailable');
        }),
        runPages: vi.fn(async () => {
          order.push('pages');
          return {
            claimed: 1,
            healthy: 1,
            repaired: 0,
            attention: 0,
            failed: 0,
            notes: [],
          };
        }),
      },
    });

    expect(order).toEqual(['events', 'pages']);
    expect(result.ok).toBe(false);
    expect(result.body.events.failed).toBe(1);
    expect(result.body.pages.healthy).toBe(1);
    expect(JSON.stringify(result.body)).not.toContain(
      'event claim unavailable'
    );
  });

  it('never exceeds three concurrent operations', async () => {
    let active = 0;
    let maximum = 0;
    await mapWithConcurrency(
      Array.from({ length: 10 }, (_, index) => index),
      3,
      async () => {
        active += 1;
        maximum = Math.max(maximum, active);
        await Promise.resolve();
        await Promise.resolve();
        active -= 1;
      }
    );

    expect(maximum).toBe(3);
  });
});
