// @vitest-environment jsdom
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('@/hooks/use-pending-navigation', () => ({
  usePendingNavigation: () => ({ navigate: vi.fn(), pendingHref: null }),
}));
import { SubscriptionPlanCards } from './subscription-plan-cards';
import { monthlyCatalogOffer } from '@/lib/subscriptions/monthly-contract';
afterEach(cleanup);
it('shows only prepared monthly amounts, base branches and unavailable reasons', () => {
  const choose = vi.fn();
  render(
    <SubscriptionPlanCards
      purchaseMode="monthly"
      formatMoney={(v) => `₹${v}`}
      onSelect={choose}
      selectedTier="growth"
      offers={[
        {
          available: false,
          tier: 'starter',
          reason: 'Contact support to prepare Starter.',
        },
        {
          available: true,
          offerId: 'growth-offer',
          identity: monthlyCatalogOffer('growth'),
          taxNote: 'No GST',
          termsNote: 'One month',
          refundNote: 'Seven days',
          documentTreatment: 'usefulmade_unregistered_invoice_receipt_v1',
        },
      ]}
    />
  );
  expect(screen.getByText('₹1499/month')).toBeTruthy();
  expect(screen.queryByText('₹799/month')).toBeNull();
  expect(screen.queryByText(/add 1 more/)).toBeNull();
  expect(screen.getByText('Contact support to prepare Starter.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Choose Growth' }));
  expect(choose).toHaveBeenCalledWith('growth');
  expect(
    screen
      .getByRole('button', { name: 'Choose Growth' })
      .getAttribute('aria-pressed')
  ).toBe('true');
});
