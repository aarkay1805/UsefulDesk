// Due-date presets for the note composer's follow-up row —
// "In 3 days (Friday)" style, plain calendar days (gyms run 7 days a
// week, so no business-day skipping). All math is IST-first via the
// memberships date helpers ('YYYY-MM-DD' strings; no Date-object
// timezone traps).

import { daysBetween, istAddDays, istToday } from '@/lib/memberships/expiry';

/** Add calendar months, clamping the day (Jan 31 + 1m → Feb 28/29). */
export function addMonths(dateStr: string, months: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const targetMonth = m - 1 + months;
  const targetYear = y + Math.floor(targetMonth / 12);
  const monthIndex = ((targetMonth % 12) + 12) % 12;
  const daysInTarget = new Date(Date.UTC(targetYear, monthIndex + 1, 0)).getUTCDate();
  const day = Math.min(d, daysInTarget);
  const mm = String(monthIndex + 1).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${targetYear}-${mm}-${dd}`;
}

function weekdayName(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'long',
    timeZone: 'UTC',
  });
}

function shortDate(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

export interface DuePreset {
  id: string;
  /** e.g. "In 3 days (Friday)" / "In 1 week (Jul 14)". */
  label: string;
  /** Resolved IST due date, 'YYYY-MM-DD'. */
  date: string;
}

/** The preset list, resolved against today (IST). */
export function duePresets(today: string = istToday()): DuePreset[] {
  const d2 = istAddDays(today, 2);
  const d3 = istAddDays(today, 3);
  const w1 = istAddDays(today, 7);
  const w2 = istAddDays(today, 14);
  const m1 = addMonths(today, 1);
  const m3 = addMonths(today, 3);
  const m6 = addMonths(today, 6);
  return [
    { id: 'today', label: 'Today', date: today },
    { id: 'tomorrow', label: 'Tomorrow', date: istAddDays(today, 1) },
    { id: '2d', label: `In 2 days (${weekdayName(d2)})`, date: d2 },
    { id: '3d', label: `In 3 days (${weekdayName(d3)})`, date: d3 },
    { id: '1w', label: `In 1 week (${shortDate(w1)})`, date: w1 },
    { id: '2w', label: `In 2 weeks (${shortDate(w2)})`, date: w2 },
    { id: '1m', label: `In 1 month (${shortDate(m1)})`, date: m1 },
    { id: '3m', label: `In 3 months (${shortDate(m3)})`, date: m3 },
    { id: '6m', label: `In 6 months (${shortDate(m6)})`, date: m6 },
  ];
}

export const FOLLOW_UP_TASK_TYPES = [
  { value: 'call', label: 'Call' },
  { value: 'email', label: 'Email' },
  { value: 'todo', label: 'To-do' },
] as const;

export type FollowUpTaskType = (typeof FOLLOW_UP_TASK_TYPES)[number]['value'];

/** Reminder time slots (IST wall clock on the due date), hourly 8am–8pm. */
export const REMINDER_SLOTS: { value: string; label: string }[] = Array.from(
  { length: 13 },
  (_, i) => {
    const hour24 = 8 + i;
    const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
    const suffix = hour24 < 12 ? 'am' : 'pm';
    return {
      value: `${String(hour24).padStart(2, '0')}:00`,
      label: `${hour12}:00 ${suffix}`,
    };
  },
);

/**
 * Resolve a due date + IST slot ("2026-07-14" + "08:00") to an ISO
 * timestamp. IST is fixed UTC+5:30 (no DST), so the offset is safe to
 * hardcode.
 */
export function remindAtIST(dueDate: string, slot: string): string {
  return new Date(`${dueDate}T${slot}:00+05:30`).toISOString();
}

/**
 * Reverse of remindAtIST for prefilling the editor: an ISO timestamp
 * back to its IST wall-clock slot ('08:00'). Returns '' when the
 * timestamp isn't on a whole IST hour (not one of our slots).
 */
export function slotFromRemindAt(remindAt: string | null | undefined): string {
  if (!remindAt) return '';
  const d = new Date(remindAt);
  if (Number.isNaN(d.getTime())) return '';
  const istMinutes =
    (d.getUTCHours() * 60 + d.getUTCMinutes() + 330) % (24 * 60);
  if (istMinutes % 60 !== 0) return '';
  return `${String(istMinutes / 60).padStart(2, '0')}:00`;
}

/**
 * Note-card strip label: "Call due in 8 days (Friday, July 17)",
 * "To-do due today", "Email overdue by 2 days (Monday, July 6)".
 */
export function followUpDueLabel(
  taskType: string,
  dueDate: string,
  today: string = istToday(),
): string {
  const type =
    FOLLOW_UP_TASK_TYPES.find((t) => t.value === taskType)?.label ?? 'Task';
  const diff = daysBetween(today, dueDate);
  const pretty = new Date(`${dueDate}T00:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
  if (diff === 0) return `${type} due today`;
  if (diff === 1) return `${type} due tomorrow (${pretty})`;
  if (diff > 1) return `${type} due in ${diff} days (${pretty})`;
  const overdue = Math.abs(diff);
  return `${type} overdue by ${overdue} day${overdue === 1 ? '' : 's'} (${pretty})`;
}
