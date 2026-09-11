import { selectDueMilestone } from './policy';
import type { ReminderMilestone } from './types';

export const WIN_BACK_MILESTONES: readonly ReminderMilestone[] = [
  { key: 'win-back-14', offsetDays: 14 },
  { key: 'win-back-30', offsetDays: 30 },
  { key: 'win-back-60', offsetDays: 60 },
];

/** A pack is derived from the current cycle's attendance, never a counter. */
export function sessionPackMilestone(
  remaining: number
): ReminderMilestone | null {
  if (remaining <= 0) return { key: 'sessions-0', offsetDays: 0 };
  if (remaining <= 2) return { key: 'sessions-2', offsetDays: 0 };
  return null;
}

/** Zero is a higher-priority factual state and supersedes the low warning. */
export function isCurrentSessionPackMilestone(
  remaining: number,
  milestoneKey: string
): boolean {
  return sessionPackMilestone(remaining)?.key === milestoneKey;
}

export function selectWinBackMilestone(input: {
  endDate: string;
  today: string;
  activatedOn: string;
  handledKeys: readonly string[];
  catchUpDays: number;
}): ReminderMilestone | null {
  return selectDueMilestone({
    anchorDate: input.endDate,
    today: input.today,
    activatedOn: input.activatedOn,
    milestones: WIN_BACK_MILESTONES,
    handledKeys: input.handledKeys,
    catchUpDays: input.catchUpDays,
  });
}

/** The worker uses this before any handled-state filtering so an old leased or
 * blocked milestone can never send after a newer one is due. */
export function latestWinBackMilestone(input: {
  endDate: string;
  today: string;
  activatedOn: string;
  catchUpDays: number;
}): ReminderMilestone | null {
  return selectWinBackMilestone({ ...input, handledKeys: [] });
}

export function shouldStopWinBack({
  renewedOrReplaced,
  cancelled,
  replied,
  openCommitmentOrHold,
  shortSequencePending,
}: {
  renewedOrReplaced: boolean;
  cancelled: boolean;
  replied: boolean;
  openCommitmentOrHold: boolean;
  shortSequencePending: boolean;
}): boolean {
  return (
    renewedOrReplaced ||
    cancelled ||
    replied ||
    openCommitmentOrHold ||
    shortSequencePending
  );
}
