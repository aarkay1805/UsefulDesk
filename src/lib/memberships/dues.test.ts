import { describe, it, expect } from 'vitest';
import { daysOverdue, bucketForDue, DUE_BUCKETS } from './dues';

describe('daysOverdue', () => {
  it('is 0 when the fee is due today', () => {
    expect(daysOverdue('2026-07-05', '2026-07-05')).toBe(0);
  });
  it('is positive when the period started in the past', () => {
    expect(daysOverdue('2026-07-01', '2026-07-05')).toBe(4);
  });
  it('is negative for a future period start (not owed yet)', () => {
    expect(daysOverdue('2026-07-10', '2026-07-05')).toBe(-5);
  });
});

describe('bucketForDue', () => {
  const today = '2026-07-05';

  it('puts only payments due on the current date in due_today', () => {
    expect(bucketForDue('2026-07-05', today)).toBe('due_today');
  });

  it('puts every payment past its due date in overdue', () => {
    expect(bucketForDue('2026-07-04', today)).toBe('overdue');
    expect(bucketForDue('2026-06-28', today)).toBe('overdue');
    expect(bucketForDue('2026-06-04', today)).toBe('overdue');
  });

  it('does not classify future-dated payments as urgent', () => {
    expect(bucketForDue('2026-07-20', today)).toBeNull();
  });
});

describe('DUE_BUCKETS', () => {
  it('exposes only the finalized payment urgency filters', () => {
    expect(DUE_BUCKETS).toEqual([
      { key: 'due_today', label: 'Due today' },
      { key: 'overdue', label: 'Overdue' },
    ]);
  });
});
