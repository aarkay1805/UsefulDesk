import { describe, expect, it } from 'vitest';

import {
  createReminderBusinessKey,
  decideDailyBudget,
  isWithinReminderSendWindow,
  postExpiryReplyStartAt,
} from './worker';

describe('reminder worker policy', () => {
  it('uses immutable invoice and cycle identity, not mutable balance, for a job key', () => {
    expect(
      createReminderBusinessKey({
        kind: 'invoice_overdue',
        invoiceId: 'invoice-1',
        subjectCycleId: 'invoice-1',
        milestoneKey: 'overdue-3',
      })
    ).toBe('invoice_overdue:invoice-1:invoice-1:overdue-3');
  });

  it('never permits a second chasing message after any daily claim', () => {
    expect(
      decideDailyBudget({
        existingKind: 'invoice_overdue',
        candidateKind: 'invoice_due',
      })
    ).toBe('defer');
    expect(
      decideDailyBudget({
        existingKind: 'invoice_due',
        candidateKind: 'installment_overdue',
      })
    ).toBe('defer');
  });

  it('uses the configured inclusive account-local send window', () => {
    expect(isWithinReminderSendWindow(9, 9, 19)).toBe(true);
    expect(isWithinReminderSendWindow(19, 9, 19)).toBe(true);
    expect(isWithinReminderSendWindow(8, 9, 19)).toBe(false);
  });

  it('starts post-expiry reply suppression at account-local midnight', () => {
    // 00:15 in India on 11 September is still 18:45 UTC on 10 September.
    // Starting at UTC midnight would incorrectly permit that reply's chase.
    expect(postExpiryReplyStartAt('2026-09-11', 'Asia/Kolkata')).toBe(
      '2026-09-10T18:30:00.000Z'
    );
  });
});
