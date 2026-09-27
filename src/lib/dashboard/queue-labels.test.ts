import { describe, expect, it } from 'vitest';

import { expiryBadge, followUpContext, waitingLabel } from './queue-labels';

describe('waitingLabel', () => {
  it('names the unit in full at every scale', () => {
    expect(waitingLabel(0)).toBe('Waiting 1 minute');
    expect(waitingLabel(12)).toBe('Waiting 12 minutes');
    expect(waitingLabel(60)).toBe('Waiting 1 hour');
    expect(waitingLabel(5 * 60 + 59)).toBe('Waiting 5 hours');
    expect(waitingLabel(24 * 60)).toBe('Waiting 1 day');
    expect(waitingLabel(3 * 24 * 60 + 600)).toBe('Waiting 3 days');
  });
});

describe('expiryBadge', () => {
  it('warns only for today and tomorrow', () => {
    expect(expiryBadge(0)).toEqual({
      label: 'Expires today',
      variant: 'warning',
    });
    expect(expiryBadge(1)).toEqual({
      label: 'Expires tomorrow',
      variant: 'warning',
    });
    expect(expiryBadge(3)).toEqual({
      label: 'Expires in 3 days',
      variant: 'neutral',
    });
  });
});

describe('followUpContext', () => {
  const format = (date: string) => `on-${date}`;

  it('says when the open follow-up is due and who owns it', () => {
    expect(
      followUpContext(
        { dueDate: '2026-09-01', ownerName: 'Asha' },
        '2026-09-02',
        format
      )
    ).toBe('Follow-up overdue · Asha');
    expect(
      followUpContext(
        { dueDate: '2026-09-02', ownerName: null },
        '2026-09-02',
        format
      )
    ).toBe('Follow-up today');
    expect(
      followUpContext(
        { dueDate: '2026-09-03', ownerName: null },
        '2026-09-02',
        format
      )
    ).toBe('Follow-up tomorrow');
    expect(
      followUpContext(
        { dueDate: '2026-09-09', ownerName: 'Ravi' },
        '2026-09-02',
        format
      )
    ).toBe('Follow-up on on-2026-09-09 · Ravi');
  });
});
