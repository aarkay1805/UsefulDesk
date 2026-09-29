// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { rpc, openUsefulmadeLiveCheckout } = vi.hoisted(() => ({
  rpc: vi.fn(),
  openUsefulmadeLiveCheckout: vi.fn(),
}));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ rpc }) }));
vi.mock('@/lib/subscriptions/live-checkout-client', () => ({
  openUsefulmadeLiveCheckout,
}));
vi.mock('@/hooks/use-locale', () => ({
  useLocale: () => ({
    fmt: {
      money: (amount: number) => `₹${amount.toFixed(2)}`,
      dateTime: (value: string) => value,
    },
  }),
}));
import { SubscriptionLiveReview } from './subscription-live-review';

const organizationId = '11111111-1111-4111-8111-111111111111';
const accountId = '33333333-3333-4333-8333-333333333333';
const quote = {
  request_id: '22222222-2222-4222-8222-222222222222',
  tier: 'starter',
  amount_minor: 79947,
  currency: 'INR',
  expires_at: '2099-09-29T00:00:00Z',
  starter_reminder_reset_accepted: false,
  starter_reminder_policy_version: null,
  approved_starter_reminder_policy: {
    version: 'approved-v1',
    days_before: [7, 3, 1],
    hour_local: 9,
  },
};

beforeEach(() => {
  rpc.mockReset();
  openUsefulmadeLiveCheckout.mockReset();
  rpc.mockImplementation(async (name: string) => ({
    data:
      name === 'subscription_live_owner_quote'
        ? quote
        : { request_id: quote.request_id, policy_version: 'approved-v1' },
    error: null,
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('owner Live pilot review', () => {
  it('shows the frozen amount with pilot labeling and no payment action', async () => {
    render(
      <SubscriptionLiveReview
        organizationId={organizationId}
        accountId={accountId}
      />
    );
    expect(await screen.findByText('Usefulmade Live pilot')).toBeTruthy();
    expect(screen.getByText('₹799.47 for one month')).toBeTruthy();
    expect(
      screen.getByText('Payment for this Live pilot is not available yet.')
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: /pay/i })).toBeNull();
  });

  it('saves Starter reminder acceptance only after the owner checks it', async () => {
    render(
      <SubscriptionLiveReview
        organizationId={organizationId}
        accountId={accountId}
      />
    );
    const button = await screen.findByRole('button', {
      name: 'Save reminder choice',
    });
    expect(button.hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(button);
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith(
        'subscription_acknowledge_live_starter_reminders',
        { p_request_id: quote.request_id }
      )
    );
  });

  it('requires the exact preview amount before issuing an owner quote', async () => {
    const preview = {
      approval_id: '44444444-4444-4444-8444-444444444444',
      tier: 'starter',
      amount_minor: 79947,
      currency: 'INR',
      customer_tax_note: 'Approved tax note',
      customer_terms_note: 'Approved monthly term',
    };
    rpc.mockImplementation(async (name: string) => ({
      data: name === 'subscription_live_owner_quote' ? null : preview,
      error: null,
    }));
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const submitted = JSON.parse(String(init.body)) as {
        requestId: string;
      };
      return Response.json(
        {
          quote: {
            request_id: submitted.requestId,
            amount_minor: 79947,
            currency: 'INR',
          },
        },
        { status: 202 }
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    render(
      <SubscriptionLiveReview
        organizationId={organizationId}
        accountId={accountId}
      />
    );
    fireEvent.click(
      await screen.findByRole('button', { name: 'Review plan amount' })
    );
    expect(await screen.findByText('₹799.47 for one month')).toBeTruthy();
    expect(screen.getByText('Approved tax note')).toBeTruthy();
    const confirm = screen.getByRole('button', { name: 'Confirm plan amount' });
    expect(confirm.hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(confirm);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(String(init.body))).toMatchObject({
      organizationId,
      accountId,
      approvalId: preview.approval_id,
      seenAmountMinor: 79947,
      tier: 'starter',
    });
  });

  it('refuses Checkout when the order amount differs from the frozen quote', async () => {
    vi.stubEnv('NEXT_PUBLIC_USEFULDESK_LIVE_CHECKOUT_UI', 'true');
    rpc.mockResolvedValue({
      data: { ...quote, tier: 'growth' },
      error: null,
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          checkout: {
            requestId: quote.request_id,
            organizationId,
            orderId: 'order_Live123',
            amountMinor: 79948,
            currency: 'INR',
            keyId: 'rzp_live_Usefulmade',
          },
        })
      )
    );
    render(
      <SubscriptionLiveReview
        organizationId={organizationId}
        accountId={accountId}
      />
    );
    fireEvent.click(
      await screen.findByRole('button', { name: 'Pay for plan' })
    );
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    expect(openUsefulmadeLiveCheckout).not.toHaveBeenCalled();
  });
});
