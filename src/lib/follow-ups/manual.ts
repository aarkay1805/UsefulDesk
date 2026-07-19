import type { FollowUpReason, Membership } from '@/types';
import { defaultReason } from '@/lib/memberships/follow-ups';

/**
 * The stored reason for a manual follow-up. Reasons are member context only;
 * lead tasks always use the neutral legacy sentinel required by the schema.
 */
export function defaultManualFollowUpReason(
  membership: Membership | undefined,
  selectedReason: FollowUpReason | undefined,
  today: string
): FollowUpReason {
  if (!membership) return 'other';
  return selectedReason ?? defaultReason(membership, today);
}

/** Prevent a hidden/stale member reason from leaking onto a lead task. */
export function manualFollowUpReasonForWrite(
  isMember: boolean,
  selectedReason: FollowUpReason
): FollowUpReason {
  return isMember ? selectedReason : 'other';
}
