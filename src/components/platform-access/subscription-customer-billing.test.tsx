// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ rpc }) }));
vi.mock('@/hooks/use-locale', () => ({
  useLocale: () => ({
    fmt: {
      dateTime: (value: string) => value,
      money: (value: number) => `₹${value}`,
    },
  }),
}));
import { SubscriptionCustomerReview } from './subscription-customer-review';
afterEach(cleanup);
it('preserves paid-term status and cancellation when first checkout is contained', async () => {
  rpc.mockImplementation(async (name: string) => ({
    error: null,
    data:
      name === 'subscription_live_owner_term'
        ? {
            request_id: '11111111-1111-4111-8111-111111111111',
            tier: 'starter',
            paid_through_end: '2099-11-02T12:24:56Z',
            expired: false,
            refunded: false,
            renewal_stopped: false,
          }
        : null,
  }));
  render(
    <SubscriptionCustomerReview
      organizationId="22222222-2222-4222-8222-222222222222"
      accountId="33333333-3333-4333-8333-333333333333"
    />
  );
  expect(
    await screen.findByText('Paid access ends 2099-11-02T12:24:56Z.')
  ).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Cancel renewal' })).toBeTruthy();
  expect(
    screen.queryByRole('button', { name: 'Approve Starter offer' })
  ).toBeNull();
});

it('dispatches durable monthly status after both new initiation flags close', async () => {
  vi.stubEnv('NEXT_PUBLIC_USEFULDESK_MONTHLY_CHECKOUT_UI', 'false');
  rpc.mockImplementation(async (name: string) => ({
    data:
      name === 'subscription_live_owner_term'
        ? {
            request_id: '11111111-1111-4111-8111-111111111111',
            tier: 'ultimate',
            paid_through_end: '2099-11-02T12:24:56Z',
            period_start: '2099-10-02T12:24:56Z',
            expired: false,
            refunded: false,
            renewal_stopped: false,
            renewal_available: false,
            monthly_offer_id: '44444444-4444-4444-8444-444444444444',
            offer_contract_version: 'monthly_first_v1',
            catalog_version: 'monthly_inr_2026_10_v1',
            included_branches: 5,
            paid_extra_branch_slots: 0,
            amount_minor: 399900,
            currency: 'INR',
            payment_state: 'verified',
          }
        : null,
    error: null,
  }));
  render(
    <SubscriptionCustomerReview
      organizationId="22222222-2222-4222-8222-222222222222"
      accountId="33333333-3333-4333-8333-333333333333"
    />
  );
  expect(await screen.findByText('UsefulDesk Ultimate')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /renew|pay/i })).toBeNull();
  vi.unstubAllEnvs();
});

it('shows monthly paid Growth even when the legacy preparation preview has non-Starter economics', async () => {
  rpc.mockImplementation(async (name: string) => ({
    data:
      name === 'subscription_live_owner_term'
        ? {
            request_id: '11111111-1111-4111-8111-111111111111',
            tier: 'growth',
            paid_through_end: '2099-11-02T12:24:56Z',
            period_start: '2099-10-02T12:24:56Z',
            expired: false,
            refunded: false,
            renewal_stopped: false,
            renewal_available: false,
            monthly_offer_id: '44444444-4444-4444-8444-444444444444',
            offer_contract_version: 'monthly_first_v1',
            catalog_version: 'monthly_inr_2026_10_v1',
            included_branches: 1,
            paid_extra_branch_slots: 0,
            amount_minor: 149900,
            currency: 'INR',
            payment_state: 'verified',
          }
        : name === 'subscription_customer_review_preview'
          ? { amount_minor: 149900, currency: 'INR' }
          : null,
    error: null,
  }));
  render(
    <SubscriptionCustomerReview
      organizationId="22222222-2222-4222-8222-222222222222"
      accountId="33333333-3333-4333-8333-333333333333"
    />
  );
  expect(await screen.findByText('UsefulDesk Growth')).toBeTruthy();
  expect(screen.queryByText('Could not load your offer')).toBeNull();
});
