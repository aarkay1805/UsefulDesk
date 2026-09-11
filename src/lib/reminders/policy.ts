import { istAddDays } from '@/lib/memberships/expiry';

import type { DueMilestoneInput, ReminderMilestone } from './types';

export type CollectibleInvoice = {
  state: string;
  balance: number;
  requiresRefundReview: boolean;
};

/**
 * Pick exactly one schedule event: the newest event that is due, was not
 * already handled, is not older than the bounded catch-up period, and is not
 * before the account enabled this lifecycle. Dates are account-local.
 */
export function selectDueMilestone(
  input: DueMilestoneInput
): ReminderMilestone | null {
  const candidates = input.milestones
    .map((milestone) => ({
      milestone,
      dueOn: istAddDays(input.anchorDate, milestone.offsetDays),
    }))
    .filter(
      ({ dueOn }) =>
        dueOn <= input.today &&
        dueOn >= input.activatedOn &&
        istAddDays(dueOn, Math.max(0, input.catchUpDays)) >= input.today
    )
    .sort((left, right) => right.dueOn.localeCompare(left.dueOn));

  const latest = candidates[0]?.milestone;
  // A later schedule event supersedes every earlier one. Once it has been
  // handled, never resurrect an older missed reminder on a later cron run.
  return latest && !input.handledKeys.includes(latest.key) ? latest : null;
}

export function isCollectibleInvoice(invoice: CollectibleInvoice): boolean {
  return (
    invoice.state === 'open' &&
    !invoice.requiresRefundReview &&
    Number.isFinite(invoice.balance) &&
    invoice.balance > 0
  );
}

/** An AutoPay mandate owns only the membership explicitly attached to it. */
export function isCoveredByActiveMandate({
  membershipId,
  activeMandateMembershipIds,
}: {
  membershipId: string | null;
  activeMandateMembershipIds: ReadonlySet<string>;
}): boolean {
  return membershipId !== null && activeMandateMembershipIds.has(membershipId);
}

/** A fixed installment owns only its invoice's *pre-due* collection nudge. */
export function shouldSuppressGeneralPreDue({
  invoiceId,
  milestone,
  installmentInvoiceIds,
}: {
  invoiceId: string;
  milestone: ReminderMilestone;
  installmentInvoiceIds: ReadonlySet<string>;
}): boolean {
  void milestone;
  // The installment's fixed second_due_on is the sole payment promise for its
  // invoice. General issued-at milestones would otherwise call it due/overdue
  // weeks early and later duplicate the dedicated sequence.
  return installmentInvoiceIds.has(invoiceId);
}

/**
 * An active mandate identifies a membership, not a future invoice allocation.
 * If a current invoice has a line for that membership, the automated amount is
 * ambiguous; hold it for reconciliation instead of silently skipping a mixed
 * invoice or charging/reminding its whole balance.
 */
export function requiresAutoPayReconciliation({
  activeMandateMembershipIds,
  lineMembershipIds,
}: {
  activeMandateMembershipIds: ReadonlySet<string>;
  lineMembershipIds: readonly (string | null)[];
}): boolean {
  return lineMembershipIds.some(
    (membershipId) =>
      membershipId !== null && activeMandateMembershipIds.has(membershipId)
  );
}

export function invoiceMilestones(
  beforeDueDays: readonly number[],
  overdueDays: readonly number[]
): ReminderMilestone[] {
  const before = beforeDueDays.map((days) => ({
    key: days === 0 ? 'due' : `before-${days}`,
    offsetDays: -Math.abs(days),
  }));
  const overdue = overdueDays.map((days) => ({
    key: `overdue-${Math.abs(days)}`,
    offsetDays: Math.abs(days),
  }));
  return [...before, ...overdue];
}

/** A renewal invitation is only meaningful while the same cycle remains
 * expired and manually collectible. Dates, rather than a fictional persisted
 * "expired" status, are the source of truth. */
export function isExpiredRenewalCandidate({
  status,
  endDate,
  today,
  renewable,
  activeAutoPay = false,
}: {
  status: string;
  endDate: string;
  today: string;
  renewable: boolean;
  activeAutoPay?: boolean;
}): boolean {
  return status === 'active' && endDate < today && renewable && !activeAutoPay;
}
