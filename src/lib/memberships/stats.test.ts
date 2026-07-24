import { describe, expect, it } from 'vitest';

import { summarizeAttendanceRisk, summarizeCollections } from './stats';

describe('summarizeAttendanceRisk', () => {
  it('separates missed visits from members who never checked in', () => {
    expect(
      summarizeAttendanceRisk(
        [
          { last_visit_at: '2026-07-14T03:30:00.000Z' },
          { last_visit_at: '2026-07-15T03:30:00.000Z' },
          { last_visit_at: null },
        ],
        '2026-07-24',
        'Asia/Kolkata'
      )
    ).toEqual({
      missedVisitRisk: 1,
      neverVisitedRisk: 1,
    });
  });

  it('uses the account-local visit day at timezone boundaries', () => {
    expect(
      summarizeAttendanceRisk(
        [{ last_visit_at: '2026-07-14T20:00:00.000Z' }],
        '2026-07-24',
        'Asia/Kolkata'
      )
    ).toEqual({
      missedVisitRisk: 0,
      neverVisitedRisk: 0,
    });
  });
});

describe('summarizeCollections', () => {
  it('compares today with the average of the seven complete prior days', () => {
    expect(
      summarizeCollections(
        [
          { amount: 700, paid_at: '2026-07-17T06:30:00.000Z' },
          { amount: 350, paid_at: '2026-07-23T06:30:00.000Z' },
          { amount: 500, paid_at: '2026-07-24T06:30:00.000Z' },
          { amount: 999, paid_at: '2026-07-16T06:30:00.000Z' },
        ],
        '2026-07-24',
        'Asia/Kolkata'
      )
    ).toEqual({
      collectedToday: 500,
      collectionDailyAverage7d: 150,
    });
  });
});
