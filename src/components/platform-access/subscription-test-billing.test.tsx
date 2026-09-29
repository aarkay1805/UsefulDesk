// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/hooks/use-locale', () => ({
  useLocale: () => ({
    fmt: { dateTime: (v: string) => v, money: (v: number) => `₹${v}` },
  }),
}));
vi.mock('@/lib/subscriptions/test-checkout-client', () => ({
  openUsefulDeskTestCheckout: vi.fn(),
}));
import { SubscriptionTestBilling } from './subscription-test-billing';
const org = '11111111-1111-4111-8111-111111111111';
const billing = {
  organization_id: org,
  grant: {
    tier: 'starter',
    paid_through_end: '2099-10-28T00:00:00Z',
    refund_confirmed_at: null,
    current_term_refunded_at: null,
    term_generation: 1,
    renewal_stopped_at: null,
  },
  change: null,
  claim: { amount_minor: 79900 },
  refund: null,
  payments: [],
  refunds_enabled: true,
  advanced_available: false,
  active_branches: [],
  paid_slots: [],
  slot_renewal_review: null,
  starter_reminder_policy: null,
};
const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockImplementation(async () => Response.json({ billing }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
function mount() {
  render(
    <SubscriptionTestBilling
      organizationId={org}
      accountId="branch-1"
      onChanged={() => {}}
    />
  );
}
describe('owner Test billing recovery', () => {
  it('requires review of full amount and access effect before the refund POST', async () => {
    mount();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Refund Test payment' })
    );
    expect(screen.getByText('Refund the full Test payment?')).toBeTruthy();
    expect(
      screen.getByText(/Paid access ends after confirmation/)
    ).toBeTruthy();
    expect(
      fetchMock.mock.calls.every(([, init]) => init?.method !== 'POST')
    ).toBe(true);
    fireEvent.click(
      screen.getAllByRole('button', { name: 'Refund Test payment' }).at(-1)!
    );
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/subscriptions/test-refunds',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ organizationId: org }),
        })
      )
    );
  });
  it('hides refund execution when the second gate is off', async () => {
    fetchMock.mockImplementation(async () =>
      Response.json({ billing: { ...billing, refunds_enabled: false } })
    );
    mount();
    expect(
      await screen.findByText(
        'Test refund execution is not enabled. Contact support.'
      )
    ).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: 'Refund Test payment' })
    ).toBeNull();
  });
  it('retains plan comparison after refund without offering another trial or unimplemented payment', async () => {
    fetchMock.mockImplementation(async () =>
      Response.json({
        billing: {
          ...billing,
          grant: {
            ...billing.grant,
            refund_confirmed_at: '2026-09-28',
            current_term_refunded_at: '2026-09-28',
            renewal_stopped_at: '2026-09-28',
          },
        },
      })
    );
    mount();
    expect(await screen.findByText('Choose a plan to return')).toBeTruthy();
    expect(screen.getByText(/Your gym data is saved/)).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: 'Renew Test plan' })
    ).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Refund Test payment' })
    ).toBeNull();
    expect(
      fetchMock.mock.calls.every(([, init]) => init?.method !== 'POST')
    ).toBe(true);
  });
  it('shows the frozen Test amount before opening an upgrade order', async () => {
    let reviewedRequestId = '';
    fetchMock.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path.endsWith('/advanced-reviews')) {
        reviewedRequestId = JSON.parse(String(init?.body)).requestId;
        return Response.json({ review: { state: 'awaiting_policy' } });
      }
      if (path.endsWith('/advanced-quotes'))
        return Response.json({
          quote: {
            organizationId: org,
            requestId: reviewedRequestId,
            kind: 'upgrade',
            tier: 'growth',
            amountMinor: 35000,
            currency: 'INR',
            expiresAt: '2099-10-28T00:00:00Z',
          },
        });
      if (path.endsWith('/advanced-orders'))
        return Response.json({ checkout: { tier: 'growth' } });
      return Response.json({
        billing: {
          ...billing,
          advanced_available: true,
          active_branches: [
            {
              id: '22222222-2222-4222-8222-222222222222',
              name: 'Main',
              owned: true,
            },
          ],
        },
      });
    });
    mount();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Review Growth' })
    );
    expect(await screen.findByText('₹350')).toBeTruthy();
    expect(screen.getByText(/for Growth plan/)).toBeTruthy();
    expect(
      fetchMock.mock.calls.some(([path]) =>
        String(path).endsWith('/advanced-orders')
      )
    ).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Pay Test amount' }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([path]) =>
          String(path).endsWith('/advanced-orders')
        )
      ).toBe(true)
    );
  });
  it('shows the scheduled lower-tier price when reviewing a paid slot cancellation', async () => {
    fetchMock.mockImplementation(async () =>
      Response.json({
        billing: {
          ...billing,
          advanced_available: true,
          grant: { ...billing.grant, tier: 'growth' },
          change: {
            target_tier: 'starter',
            source_period_end: billing.grant.paid_through_end,
            archive_account_ids: [],
          },
          active_branches: [
            {
              id: '22222222-2222-4222-8222-222222222222',
              name: 'Main',
              owned: true,
            },
          ],
          paid_slots: [
            {
              id: '33333333-3333-4333-8333-333333333333',
              paid_through_end: billing.grant.paid_through_end,
            },
          ],
        },
      })
    );
    mount();
    expect(await screen.findByText('₹1298')).toBeTruthy();
    expect(
      screen
        .getByRole('button', { name: 'Save renewal choice' })
        .hasAttribute('disabled')
    ).toBe(true);
    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Stop extra branch 1' })
    );
    expect(screen.getByText(/Next Test renewal:/).textContent).toContain(
      '₹799'
    );
    expect(
      screen
        .getByRole('button', { name: 'Save renewal choice' })
        .hasAttribute('disabled')
    ).toBe(false);
  });
});
