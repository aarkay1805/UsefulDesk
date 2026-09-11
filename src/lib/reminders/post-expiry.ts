import { selectDueMilestone } from './policy';
import type { ReminderMilestone } from './types';

export const POST_EXPIRY_MILESTONES: readonly ReminderMilestone[] = [
  { key: 'expired-1', offsetDays: 1 },
  { key: 'expired-3', offsetDays: 3 },
  { key: 'expired-7', offsetDays: 7 },
];

/** Settings are intentionally constrained to the short, owner-approved chase.
 * The final milestone is the one that creates staff work, never a fourth send. */
export function selectPostExpiryMilestone({
  endDate,
  today,
  activatedOn,
  handledKeys,
  catchUpDays,
}: {
  endDate: string;
  today: string;
  activatedOn: string;
  handledKeys: readonly string[];
  catchUpDays: number;
}): ReminderMilestone | null {
  return selectDueMilestone({
    anchorDate: endDate,
    today,
    activatedOn,
    milestones: POST_EXPIRY_MILESTONES,
    handledKeys,
    catchUpDays,
  });
}

export function shouldEscalatePostExpiry({
  milestoneKey,
  state,
  hasCustomerReply,
}: {
  milestoneKey: string;
  state: string;
  hasCustomerReply: boolean;
}): boolean {
  return milestoneKey === 'expired-7' && ['accepted', 'delivered'].includes(state) && !hasCustomerReply;
}
