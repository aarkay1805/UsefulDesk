// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SubscriptionConversionReviewDialog } from './subscription-conversion-review-dialog';
import type { BranchSlotPurchase } from '@/lib/subscriptions/branch-slots';

const branches = [
  ...Array.from({ length: 5 }, (_, index) => ({
    account_id: `branch-${index + 1}`,
    account_name: `Branch ${index + 1}`,
    organization_id: 'org-1',
    branch_status: 'active' as const,
  })),
  {
    account_id: 'archived',
    account_name: 'Old branch',
    organization_id: 'org-1',
    branch_status: 'archived' as const,
  },
  {
    account_id: 'other',
    account_name: 'Other gym',
    organization_id: 'org-2',
    branch_status: 'active' as const,
  },
];
afterEach(cleanup);

describe('SubscriptionConversionReviewDialog', () => {
  it('reviews an explicit four-branch selection without archiving or checkout', () => {
    const close = vi.fn();
    render(
      <SubscriptionConversionReviewDialog
        open
        onOpenChange={close}
        organizationId="org-1"
        organizationRole="owner"
        tier="starter"
        branches={branches}
        purchases={[]}
      />
    );
    expect(
      screen.getByText('Choose at least 4 branches to archive')
    ).toBeTruthy();
    expect(screen.queryByText('Old branch')).toBeNull();
    expect(screen.queryByText('Other gym')).toBeNull();
    for (let index = 1; index <= 4; index += 1) {
      fireEvent.click(
        screen.getByRole('checkbox', { name: `Branch ${index}` })
      );
    }
    expect(screen.getByText('This selection fits the plan')).toBeTruthy();
    expect(screen.getByText(/No branch has been archived/)).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Branch 5' }));
    expect(screen.getByText('Keep one active branch')).toBeTruthy();
    expect(
      screen.queryByRole('button', {
        name: /archive branch|pay|subscribe|checkout/i,
      })
    ).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Close review' }));
    expect(close).toHaveBeenCalledWith(false);
    expect(
      branches.filter(
        (branch) =>
          branch.branch_status === 'active' &&
          branch.organization_id === 'org-1'
      )
    ).toHaveLength(5);
  });

  it('shows a sufficient plan without asking for archive choices', () => {
    render(
      <SubscriptionConversionReviewDialog
        open
        onOpenChange={() => {}}
        organizationId="org-1"
        organizationRole="owner"
        tier="ultimate"
        branches={branches}
        purchases={[]}
      />
    );
    expect(screen.getByText('This selection fits the plan')).toBeTruthy();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('only allows the organization owner to make a selection', () => {
    render(
      <SubscriptionConversionReviewDialog
        open
        onOpenChange={() => {}}
        organizationId="org-1"
        organizationRole={null}
        tier="starter"
        branches={branches}
        purchases={[]}
      />
    );
    expect(screen.getByText('Ask the owner to review branches')).toBeTruthy();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('counts a Growth extra slot only after a verified purchase', () => {
    const two = branches.slice(0, 2);
    const purchase: BranchSlotPurchase = {
      purchaseId: 'purchase-1',
      organizationId: 'org-1',
      tier: 'growth',
      quantity: 1,
      state: 'pending',
      verifiedProviderPaymentId: null,
    };
    const view = render(
      <SubscriptionConversionReviewDialog
        open
        onOpenChange={() => {}}
        organizationId="org-1"
        organizationRole="owner"
        tier="growth"
        branches={two}
        purchases={[purchase]}
      />
    );
    expect(
      screen.getByText('Choose at least 1 branch to archive')
    ).toBeTruthy();
    view.rerender(
      <SubscriptionConversionReviewDialog
        open
        onOpenChange={() => {}}
        organizationId="org-1"
        organizationRole="owner"
        tier="growth"
        branches={two}
        purchases={[
          {
            ...purchase,
            state: 'verified',
            verifiedProviderPaymentId: 'pay-1',
          },
        ]}
      />
    );
    expect(screen.getByText('This selection fits the plan')).toBeTruthy();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });
});

it('requires separate archive consent and resets it when selected branches change', () => {
  const archive = vi.fn(async () => {});
  render(
    <SubscriptionConversionReviewDialog
      open
      onOpenChange={() => {}}
      organizationId="org-1"
      organizationRole="owner"
      tier="starter"
      branches={branches.slice(0, 3)}
      purchases={[]}
      keepAccountId="branch-1"
      archiveConsequence="These branches will be archived now, even if you do not finish payment. Their history stays saved."
      onArchive={archive}
    />
  );
  fireEvent.click(screen.getByRole('checkbox', { name: 'Branch 2' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Branch 3' }));
  const button = screen.getByRole('button', {
    name: 'Archive selected branches',
  });
  expect(button.hasAttribute('disabled')).toBe(true);
  fireEvent.click(
    screen.getByRole('checkbox', {
      name: 'I understand these branches will be archived now.',
    })
  );
  expect(button.hasAttribute('disabled')).toBe(false);
  fireEvent.click(screen.getByRole('checkbox', { name: 'Branch 2' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Branch 2' }));
  expect(
    screen
      .getByRole('checkbox', {
        name: 'I understand these branches will be archived now.',
      })
      .getAttribute('aria-checked')
  ).toBe('false');
  expect(archive).not.toHaveBeenCalled();
});
