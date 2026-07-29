import { describe, expect, it } from 'vitest';

import {
  installmentAmounts,
  installmentReminderTargets,
  installmentSecondDueOn,
} from './installments';

describe('installmentAmounts', () => {
  it('splits an invoice 60/40 and preserves the exact total', () => {
    expect(installmentAmounts(11_999)).toEqual({
      now: 7_199.4,
      later: 4_799.6,
    });
  });

  it('assigns the rounding remainder to the later installment', () => {
    const split = installmentAmounts(999.99);
    expect(split).toEqual({ now: 599.99, later: 400 });
    expect(split.now + split.later).toBe(999.99);
  });

  it('returns a safe zero split for invalid totals', () => {
    expect(installmentAmounts(0)).toEqual({ now: 0, later: 0 });
    expect(installmentAmounts(Number.NaN)).toEqual({ now: 0, later: 0 });
  });
});

describe('installmentSecondDueOn', () => {
  it('sets the second payment 28 days after the sale day', () => {
    expect(installmentSecondDueOn('2026-07-29')).toBe('2026-08-26');
  });
});

describe('installmentReminderTargets', () => {
  it('targets 7, 3, and 1 day before the deadline and the due day', () => {
    expect(installmentReminderTargets('2026-08-19')).toEqual([
      { daysBefore: 7, dueOn: '2026-08-26' },
      { daysBefore: 3, dueOn: '2026-08-22' },
      { daysBefore: 1, dueOn: '2026-08-20' },
      { daysBefore: 0, dueOn: '2026-08-19' },
    ]);
  });
});
