import { daysBetween } from '@/lib/memberships/expiry';
import type { FollowUp } from '@/types';

export interface FollowUpDueState {
  label: string;
  variant: 'danger' | 'warning';
}

/**
 * Urgency of an OPEN follow-up, using the product's established due buckets:
 * `danger` Overdue, `warning` Due today, and nothing for Upcoming — the same
 * mapping `lead-accountability-view` uses, which deliberately has no Upcoming
 * badge. A done or cancelled task never claims urgency.
 *
 * Shared so the profile timeline card and the standalone create dialog read
 * one definition of "late" instead of each deciding for itself.
 */
export function followUpDueState(
  status: FollowUp['status'],
  dueDate: string,
  today: string
): FollowUpDueState | null {
  if (status !== 'open') return null;
  const diff = daysBetween(today, dueDate);
  if (Number.isNaN(diff)) return null;
  if (diff < 0) return { label: 'Overdue', variant: 'danger' };
  if (diff === 0) return { label: 'Due today', variant: 'warning' };
  return null;
}
