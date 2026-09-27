import { describe, expect, it } from 'vitest';
import {
  branchChangeFitsVerifiedSlots,
  countActiveBranches,
  projectActiveBranchCount,
} from './plans';
import {
  applyBranchSlotPurchaseEvent,
  paidBranchChangeAllowed,
  subscriptionBranchChangeAllowed,
  verifiedExtraBranchSlots,
  type BranchSlotPurchase,
} from './branch-slots';

const pending: BranchSlotPurchase = {
  purchaseId: 'purchase-1',
  organizationId: 'org-1',
  tier: 'growth',
  quantity: 1,
  state: 'pending',
  verifiedProviderPaymentId: null,
};
const branches = [
  {
    account_id: 'branch-1',
    organization_id: 'org-1',
    branch_status: 'active' as const,
  },
  {
    account_id: 'branch-2',
    organization_id: 'org-1',
    branch_status: 'archived' as const,
  },
];

describe('branch add-on purchase contract', () => {
  it('applies the trial limit while preserving complimentary and manual access', () => {
    const fiveActive = [
      ...Array.from({ length: 5 }, (_, index) => ({
        account_id: `active-${index}`,
        organization_id: 'org-1',
        branch_status: 'active' as const,
      })),
      {
        account_id: 'archived',
        organization_id: 'org-1',
        branch_status: 'archived' as const,
      },
    ];
    const restore = { kind: 'restore' as const, accountId: 'archived' };
    expect(
      subscriptionBranchChangeAllowed(
        'org-1',
        { status: 'trial', grant: null },
        fiveActive,
        [],
        restore
      )
    ).toBe(false);
    expect(
      subscriptionBranchChangeAllowed(
        'org-1',
        { status: 'complimentary', grant: null },
        fiveActive,
        [],
        restore
      )
    ).toBe(true);
    expect(
      subscriptionBranchChangeAllowed(
        'org-1',
        { status: 'active', grant: { kind: 'legacy_manual' } },
        fiveActive,
        [],
        restore
      )
    ).toBe(true);
    expect(
      subscriptionBranchChangeAllowed(
        'org-1',
        { status: 'expired', grant: null },
        fiveActive,
        [],
        restore
      )
    ).toBe(false);
    expect(countActiveBranches(fiveActive, 'org-1')).toBe(5);
  });

  it('does not grant a create or restore slot for pending or failed payment', () => {
    const projectedCreate = projectActiveBranchCount(branches, 'org-1', {
      kind: 'create',
    });
    const projectedRestore = projectActiveBranchCount(branches, 'org-1', {
      kind: 'restore',
      accountId: 'branch-2',
    });
    const failed = applyBranchSlotPurchaseEvent(pending, {
      kind: 'payment_failed',
      purchaseId: 'purchase-1',
    });
    for (const purchase of [pending, failed]) {
      const slots = verifiedExtraBranchSlots('org-1', 'growth', [purchase]);
      expect(slots).toBe(0);
      expect(
        branchChangeFitsVerifiedSlots('growth', slots, projectedCreate)
      ).toBe(false);
      expect(
        branchChangeFitsVerifiedSlots('growth', slots, projectedRestore)
      ).toBe(false);
      expect(
        paidBranchChangeAllowed('org-1', 'growth', branches, [purchase], {
          kind: 'restore',
          accountId: 'branch-2',
        })
      ).toBe(false);
    }
  });

  it('grants one slot only after trusted confirmation and handles replay once', () => {
    const failed = applyBranchSlotPurchaseEvent(pending, {
      kind: 'payment_failed',
      purchaseId: 'purchase-1',
    });
    const confirmation = {
      kind: 'server_verified_payment' as const,
      purchaseId: 'purchase-1',
      providerPaymentId: 'pay-1',
    };
    const verified = applyBranchSlotPurchaseEvent(failed, confirmation);
    expect(verifiedExtraBranchSlots('org-1', 'growth', [verified])).toBe(1);
    expect(applyBranchSlotPurchaseEvent(verified, confirmation)).toBe(verified);
    expect(
      applyBranchSlotPurchaseEvent(verified, {
        kind: 'payment_failed',
        purchaseId: 'purchase-1',
      })
    ).toBe(verified);
    expect(
      branchChangeFitsVerifiedSlots(
        'growth',
        1,
        projectActiveBranchCount(branches, 'org-1', {
          kind: 'restore',
          accountId: 'branch-2',
        })
      )
    ).toBe(true);
    expect(
      paidBranchChangeAllowed('org-1', 'growth', branches, [verified], {
        kind: 'create',
      })
    ).toBe(true);
    expect(() =>
      applyBranchSlotPurchaseEvent(verified, {
        ...confirmation,
        providerPaymentId: 'pay-2',
      })
    ).toThrow('already verified');
  });

  it('keeps purchased slots after archive, while only active branches use capacity', () => {
    const verified = applyBranchSlotPurchaseEvent(pending, {
      kind: 'server_verified_payment',
      purchaseId: 'purchase-1',
      providerPaymentId: 'pay-1',
    });
    expect(countActiveBranches(branches, 'org-1')).toBe(1);
    expect(verifiedExtraBranchSlots('org-1', 'growth', [verified])).toBe(1);
    expect(branchChangeFitsVerifiedSlots('growth', 1, 1)).toBe(true);
  });

  it('rejects mismatched, missing, duplicated, and excessive confirmations', () => {
    expect(() =>
      applyBranchSlotPurchaseEvent(pending, {
        kind: 'server_verified_payment',
        purchaseId: 'other',
        providerPaymentId: 'pay-1',
      })
    ).toThrow('does not match');
    expect(() =>
      applyBranchSlotPurchaseEvent(pending, {
        kind: 'server_verified_payment',
        purchaseId: 'purchase-1',
        providerPaymentId: ' ',
      })
    ).toThrow('required');
    const verified = applyBranchSlotPurchaseEvent(pending, {
      kind: 'server_verified_payment',
      purchaseId: 'purchase-1',
      providerPaymentId: 'pay-1',
    });
    expect(() =>
      verifiedExtraBranchSlots('org-1', 'growth', [verified, verified])
    ).toThrow('Invalid verified');
    expect(() =>
      verifiedExtraBranchSlots('org-1', 'growth', [
        { ...verified, verifiedProviderPaymentId: null },
      ])
    ).toThrow('Invalid verified');
    expect(
      verifiedExtraBranchSlots('org-1', 'growth', [
        { ...pending, verifiedProviderPaymentId: 'pay-untrusted' },
      ])
    ).toBe(0);
    expect(() =>
      verifiedExtraBranchSlots('org-1', 'growth', [
        verified,
        { ...verified, purchaseId: 'purchase-2' },
      ])
    ).toThrow('Invalid verified');
    expect(() =>
      verifiedExtraBranchSlots('org-1', 'growth', [
        verified,
        {
          ...verified,
          purchaseId: 'purchase-2',
          verifiedProviderPaymentId: 'pay-2',
        },
      ])
    ).toThrow('exceed');
    expect(verifiedExtraBranchSlots('org-2', 'growth', [verified])).toBe(0);
    expect(verifiedExtraBranchSlots('org-1', 'starter', [verified])).toBe(0);
  });
});
