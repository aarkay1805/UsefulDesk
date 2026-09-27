'use client';

import { useState } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { canManageOrganization, type OrganizationRole } from '@/lib/auth/roles';
import type { BranchSlotPurchase } from '@/lib/subscriptions/branch-slots';
import { reviewSubscriptionConversion } from '@/lib/subscriptions/conversion';
import {
  SUBSCRIPTION_PLANS,
  type SubscriptionBranch,
  type SubscriptionTier,
} from '@/lib/subscriptions/plans';

export interface ConversionReviewBranch extends SubscriptionBranch {
  account_name: string;
}

/** Review-only until the paid conversion transaction and commercial gate are ready. */
export function SubscriptionConversionReviewDialog({
  open,
  onOpenChange,
  organizationId,
  organizationRole,
  tier,
  branches,
  purchases,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  organizationRole: OrganizationRole | null;
  tier: SubscriptionTier;
  branches: readonly ConversionReviewBranch[];
  purchases: readonly BranchSlotPurchase[];
}) {
  const activeBranches = branches.filter(
    (branch) =>
      branch.organization_id === organizationId &&
      branch.branch_status === 'active'
  );
  const rosterKey = `${organizationId}:${tier}:${activeBranches
    .map((branch) => branch.account_id)
    .sort()
    .join(',')}`;
  const [selection, setSelection] = useState<{ key: string; ids: string[] }>({
    key: rosterKey,
    ids: [],
  });
  const selectedIds = selection.key === rosterKey ? selection.ids : [];
  const owner = canManageOrganization(organizationRole);
  const review = reviewSubscriptionConversion({
    organizationId,
    tier,
    branches,
    purchases,
    archiveAccountIds: selectedIds,
  });
  const selectedLabel = `${review.selectedForArchive} selected for archive`;

  function toggle(id: string, checked: boolean) {
    setSelection({
      key: rosterKey,
      ids: checked
        ? [...selectedIds, id]
        : selectedIds.filter((selected) => selected !== id),
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            Review branches for {SUBSCRIPTION_PLANS[tier].label}
          </DialogTitle>
          <DialogDescription>
            Choose any branches to archive before changing plans. Nothing
            changes here.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm">
            {review.activeBranches} active branches · {review.availableSlots}{' '}
            {review.availableSlots === 1 ? 'slot' : 'slots'} in this plan
          </p>
          {owner && review.minimumBranchesToArchive > 0 ? (
            <div className="space-y-2">
              <p className="text-sm font-medium">
                Choose at least {review.minimumBranchesToArchive}{' '}
                {review.minimumBranchesToArchive === 1 ? 'branch' : 'branches'}{' '}
                to archive
              </p>
              <div className="space-y-2">
                {activeBranches.map((branch) => (
                  <div
                    key={branch.account_id}
                    className="flex items-center gap-2"
                  >
                    <Checkbox
                      id={`archive-choice-${branch.account_id}`}
                      checked={selectedIds.includes(branch.account_id)}
                      onCheckedChange={(checked) =>
                        toggle(branch.account_id, checked === true)
                      }
                    />
                    <Label htmlFor={`archive-choice-${branch.account_id}`}>
                      {branch.account_name}
                    </Label>
                  </div>
                ))}
              </div>
              <p className="text-muted-foreground text-xs">
                {selectedLabel}. Archived branches keep their history.
              </p>
            </div>
          ) : null}
          <Alert>
            <AlertTitle>
              {!owner
                ? 'Ask the owner to review branches'
                : review.ready
                  ? 'This selection fits the plan'
                  : review.blocker === 'invalid_purchase_evidence'
                    ? 'Could not check extra branch payments'
                    : review.blocker === 'invalid_branch_selection'
                      ? 'Branch list changed'
                      : review.blocker === 'no_active_branch'
                        ? 'Keep one active branch'
                        : 'More branches than this plan allows'}
            </AlertTitle>
            <AlertDescription>
              {!owner
                ? 'Only the organization owner can choose branches to archive.'
                : review.ready
                  ? `${review.remainingActiveBranches} branches would stay active. No branch has been archived.`
                  : review.blocker === 'invalid_purchase_evidence'
                    ? 'Check the payment details before changing plans.'
                    : review.blocker === 'invalid_branch_selection'
                      ? 'Close this review and open it again.'
                      : review.blocker === 'no_active_branch'
                        ? 'Leave at least one branch active.'
                        : `Choose branches to archive or choose a plan with enough verified slots. ${review.remainingActiveBranches} would stay active.`}
            </AlertDescription>
          </Alert>
          <p className="text-muted-foreground text-xs">
            Plan changes are not available yet. Payment and tax details are
            still being checked.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close review
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
