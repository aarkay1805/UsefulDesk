'use client';

import { X } from 'lucide-react';
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { canManageOrganization, type OrganizationRole } from '@/lib/auth/roles';
import {
  branchExpansionForCount,
  SUBSCRIPTION_PLANS,
  type SubscriptionTier,
} from '@/lib/subscriptions/plans';

/** Informational preview. Do not use as the branch creation permission check. */
export function BranchExpansionPrompt({
  tier,
  requestedActiveBranchCount,
  organizationRole,
  formatMoney,
  onDismiss,
}: {
  tier: SubscriptionTier;
  requestedActiveBranchCount: number;
  organizationRole: OrganizationRole | null;
  formatMoney: (amount: number, currency: string) => string;
  onDismiss: () => void;
}) {
  const result = branchExpansionForCount(tier, requestedActiveBranchCount);
  if (result.kind === 'included') return null;
  const isOwner = canManageOrganization(organizationRole);
  const amount = result.monthlySoftwareInr;
  const growthOption =
    tier === 'starter'
      ? branchExpansionForCount('growth', requestedActiveBranchCount)
      : null;
  const ultimateOption =
    tier === 'ultimate'
      ? null
      : branchExpansionForCount('ultimate', requestedActiveBranchCount);
  return (
    <Alert>
      <AlertTitle>
        {result.kind === 'upgrade_required'
          ? `${SUBSCRIPTION_PLANS[tier].label} cannot add this branch`
          : 'This branch needs a paid option'}
      </AlertTitle>
      <AlertDescription>
        {tier === 'starter' ? (
          <p>
            Starter includes 1 branch. Growth permits one paid extra branch.
            Ultimate includes 5 branches.
          </p>
        ) : tier === 'growth' ? (
          <p>
            Growth allows 2 branches with its paid extra branch. Ultimate
            includes 5 branches.
          </p>
        ) : (
          <p>
            Ultimate includes 5 branches. Each extra branch has a monthly
            charge.
          </p>
        )}
        <p>
          {growthOption?.monthlySoftwareInr != null
            ? `Growth with ${requestedActiveBranchCount} branches: ${formatMoney(growthOption.monthlySoftwareInr, 'INR')}/month in listed software charges. `
            : null}
          {ultimateOption?.monthlySoftwareInr != null
            ? `Ultimate: ${formatMoney(ultimateOption.monthlySoftwareInr, 'INR')}/month in listed software charges.`
            : null}
          {amount !== null
            ? `${formatMoney(amount, 'INR')}/month in listed software charges.`
            : null}
        </p>
        <p>
          The final amount and tax treatment are still being checked. Plan
          changes are not available yet.{' '}
          {isOwner
            ? 'Contact support to review the options.'
            : 'Ask the owner to review the options.'}
        </p>
      </AlertDescription>
      <AlertAction>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Dismiss branch plan information"
          onClick={onDismiss}
        >
          <X aria-hidden="true" />
        </Button>
      </AlertAction>
    </Alert>
  );
}
