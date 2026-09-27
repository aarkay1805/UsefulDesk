import { daysBetween } from '@/lib/memberships/expiry';
import type { DashboardOpenFollowUp } from './action-snapshot';

// Pure row copy for the Home queues. Every label is a whole word with its
// unit — "3 days", never "3d" — because the reader may use English as a
// second or third language (docs/ux-copy.md).

/** "Waiting 20 minutes" / "Waiting 5 hours" / "Waiting 3 days". */
export function waitingLabel(minutes: number): string {
  const unit = (count: number, word: string) =>
    `Waiting ${count} ${count === 1 ? word : `${word}s`}`;
  if (minutes < 60) return unit(Math.max(1, minutes), 'minute');
  if (minutes < 24 * 60) return unit(Math.floor(minutes / 60), 'hour');
  return unit(Math.floor(minutes / (24 * 60)), 'day');
}

export interface ExpiryBadge {
  label: string;
  variant: 'warning' | 'neutral';
}

/**
 * Only today and tomorrow are imminent. A warning on every day of the
 * seven-day window made a renewal due next week look as urgent as one due
 * tonight, so the rest of the window reads as a plain fact.
 */
export function expiryBadge(daysLeft: number): ExpiryBadge {
  if (daysLeft <= 0) return { label: 'Expires today', variant: 'warning' };
  if (daysLeft === 1) return { label: 'Expires tomorrow', variant: 'warning' };
  return { label: `Expires in ${daysLeft} days`, variant: 'neutral' };
}

/**
 * The open follow-up already covering this person, so the row shows the work
 * that exists instead of inviting a second, competing one.
 * "Follow-up overdue · Asha" / "Follow-up today" / "Follow-up on 30 Sep".
 */
export function followUpContext(
  followUp: DashboardOpenFollowUp,
  today: string,
  formatDate: (isoDate: string) => string
): string {
  const days = daysBetween(today, followUp.dueDate);
  const when =
    days < 0
      ? 'overdue'
      : days === 0
        ? 'today'
        : days === 1
          ? 'tomorrow'
          : `on ${formatDate(followUp.dueDate)}`;
  return followUp.ownerName
    ? `Follow-up ${when} · ${followUp.ownerName}`
    : `Follow-up ${when}`;
}
