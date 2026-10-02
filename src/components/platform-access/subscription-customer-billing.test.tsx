// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ rpc }) }));
vi.mock('@/hooks/use-locale', () => ({
  useLocale: () => ({ fmt: { dateTime: (value: string) => value } }),
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
