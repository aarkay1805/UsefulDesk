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
    renewal_stopped_at: null,
  },
  change: null,
  claim: { amount_minor: 79900 },
  refund: null,
  payments: [],
  refunds_enabled: true,
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
});
