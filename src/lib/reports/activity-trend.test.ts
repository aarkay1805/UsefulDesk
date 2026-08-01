import { describe, expect, it } from 'vitest';

import type { ActivityTrendPoint } from './activity-trend';
import { weeklyActivityTrend } from './activity-trend';

function point(
  date: string,
  overrides: Partial<ActivityTrendPoint> = {}
): ActivityTrendPoint {
  return {
    date,
    revenue: 0,
    visits: 0,
    newMembers: 0,
    acquired: 0,
    converted: 0,
    ...overrides,
  };
}

describe('weekly activity trend', () => {
  it('sums each seven-day reporting bucket and keeps its first date', () => {
    const data = Array.from({ length: 10 }, (_, index) =>
      point(`2026-07-${String(index + 1).padStart(2, '0')}`, {
        revenue: 100,
        visits: 2,
        newMembers: index === 8 ? 1 : 0,
        acquired: 1,
        converted: index === 9 ? 1 : 0,
      })
    );

    expect(weeklyActivityTrend(data)).toEqual([
      point('2026-07-01', {
        revenue: 700,
        visits: 14,
        acquired: 7,
      }),
      point('2026-07-08', {
        revenue: 300,
        visits: 6,
        newMembers: 1,
        acquired: 3,
        converted: 1,
      }),
    ]);
  });
});
