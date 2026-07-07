import { describe, expect, it } from 'vitest';

import {
  addMonths,
  duePresets,
  followUpDueLabel,
  remindAtIST,
  REMINDER_SLOTS,
  slotFromRemindAt,
} from './follow-up-dates';

describe('followUpDueLabel', () => {
  const today = '2026-07-09';

  it('phrases upcoming, today, tomorrow, and overdue', () => {
    expect(followUpDueLabel('call', '2026-07-17', today)).toBe(
      'Call due in 8 days (Friday, July 17)',
    );
    expect(followUpDueLabel('todo', '2026-07-09', today)).toBe(
      'To-do due today',
    );
    expect(followUpDueLabel('email', '2026-07-10', today)).toBe(
      'Email due tomorrow (Friday, July 10)',
    );
    expect(followUpDueLabel('call', '2026-07-07', today)).toBe(
      'Call overdue by 2 days (Tuesday, July 7)',
    );
  });

  it('falls back to "Task" for unknown types', () => {
    expect(followUpDueLabel('mystery', '2026-07-09', today)).toBe(
      'Task due today',
    );
  });
});

describe('reminders', () => {
  it('offers hourly slots from 8am to 8pm', () => {
    expect(REMINDER_SLOTS[0]).toEqual({ value: '08:00', label: '8:00 am' });
    expect(REMINDER_SLOTS.at(-1)).toEqual({ value: '20:00', label: '8:00 pm' });
    expect(REMINDER_SLOTS.map((s) => s.label)).toContain('12:00 pm');
    expect(REMINDER_SLOTS).toHaveLength(13);
  });

  it('resolves an IST slot on the due date to UTC', () => {
    // 08:00 IST = 02:30 UTC.
    expect(remindAtIST('2026-07-14', '08:00')).toBe('2026-07-14T02:30:00.000Z');
    expect(remindAtIST('2026-07-14', '20:00')).toBe('2026-07-14T14:30:00.000Z');
  });

  it('round-trips a stored remind_at back to its slot', () => {
    expect(slotFromRemindAt('2026-07-14T02:30:00.000Z')).toBe('08:00');
    expect(slotFromRemindAt('2026-07-14T14:30:00.000Z')).toBe('20:00');
    expect(slotFromRemindAt(null)).toBe('');
    expect(slotFromRemindAt('2026-07-14T14:45:00.000Z')).toBe(''); // off-slot
    expect(slotFromRemindAt('garbage')).toBe('');
  });
});

describe('addMonths', () => {
  it('adds calendar months', () => {
    expect(addMonths('2026-07-07', 1)).toBe('2026-08-07');
    expect(addMonths('2026-07-07', 6)).toBe('2027-01-07');
  });

  it('clamps the day when the target month is shorter', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29'); // leap year
    expect(addMonths('2026-08-31', 1)).toBe('2026-09-30');
  });
});

describe('duePresets', () => {
  const presets = duePresets('2026-07-07'); // a Tuesday

  it('resolves every preset to a concrete IST date', () => {
    const byId = Object.fromEntries(presets.map((p) => [p.id, p.date]));
    expect(byId.today).toBe('2026-07-07');
    expect(byId.tomorrow).toBe('2026-07-08');
    expect(byId['2d']).toBe('2026-07-09'); // Thu
    expect(byId['3d']).toBe('2026-07-10'); // Fri
    expect(byId['1w']).toBe('2026-07-14');
    expect(byId['1m']).toBe('2026-08-07');
  });

  it('counts plain calendar days — weekends are not skipped', () => {
    // 2026-07-10 is a Friday: +2 days lands on Sunday, +3 on Monday.
    const fromFriday = duePresets('2026-07-10');
    const byId = Object.fromEntries(fromFriday.map((p) => [p.id, p.date]));
    expect(byId['2d']).toBe('2026-07-12'); // Sun
    expect(byId['3d']).toBe('2026-07-13'); // Mon
  });

  it('labels day presets with the weekday and longer ones with the date', () => {
    const d3 = presets.find((p) => p.id === '3d')!;
    expect(d3.label).toBe('In 3 days (Friday)');
    const w1 = presets.find((p) => p.id === '1w')!;
    expect(w1.label).toBe('In 1 week (Jul 14)');
  });
});
