import type { OwnerReport } from './types';

export type ActivityTrendPoint = OwnerReport['trend'][number];

export function weeklyActivityTrend(
  data: ActivityTrendPoint[]
): ActivityTrendPoint[] {
  const result: ActivityTrendPoint[] = [];

  for (let index = 0; index < data.length; index += 7) {
    const days = data.slice(index, index + 7);
    result.push({
      date: days[0].date,
      revenue: days.reduce((sum, day) => sum + day.revenue, 0),
      visits: days.reduce((sum, day) => sum + day.visits, 0),
      newMembers: days.reduce((sum, day) => sum + day.newMembers, 0),
      acquired: days.reduce((sum, day) => sum + day.acquired, 0),
      converted: days.reduce((sum, day) => sum + day.converted, 0),
    });
  }

  return result;
}
