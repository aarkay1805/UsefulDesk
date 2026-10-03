// @vitest-environment jsdom
import {
  cleanup,
  act,
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
  vi.useRealTimers();
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
    const confirm = await screen.findByRole('button', {
      name: 'Confirm plan amount',
    });
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

  it('requires a separate free-to-paid acknowledgement for the pilot', async () => {
    rpc.mockImplementation(async (name: string) => ({
      data:
        name === 'subscription_live_owner_quote' ||
        name === 'subscription_live_owner_term'
          ? null
          : {
              approval_id: '44444444-4444-4444-8444-444444444444',
              tier: 'starter',
              amount_minor: 79900,
              currency: 'INR',
              customer_tax_note: 'Approved tax note',
              customer_terms_note: 'Approved monthly term',
              complimentary_conversion: true,
            },
      error: null,
    }));
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const submitted = JSON.parse(String(init.body)) as { requestId: string };
      return Response.json({
        quote: {
          request_id: submitted.requestId,
          amount_minor: 79900,
          currency: 'INR',
        },
      });
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
    const confirm = await screen.findByRole('button', {
      name: 'Confirm plan amount',
    });
    fireEvent.click(
      screen.getByRole('checkbox', {
        name: 'I reviewed this exact Live pilot amount.',
      })
    );
    expect(confirm.hasAttribute('disabled')).toBe(true);
    fireEvent.click(
      screen.getByRole('checkbox', {
        name: /I understand this payment replaces my free access/,
      })
    );
    fireEvent.click(confirm);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toMatchObject({
      complimentaryConversionAccepted: true,
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

describe('Live expiry-only renewal and cancellation', () => {
  const term = {
    request_id: quote.request_id,
    tier: 'starter',
    paid_through_end: '2026-09-28T00:00:00Z',
    renewal_stopped: false,
    refunded: false,
    expired: true,
  };
  const preview = {
    approval_id: '44444444-4444-4444-8444-444444444444',
    tier: 'starter',
    amount_minor: 79900,
    currency: 'INR',
    customer_tax_note: 'Tax reviewed',
    customer_terms_note: 'One capture-event month',
    renewal_of_request_id: term.request_id,
  };
  function fixture(overrides = {}) {
    rpc.mockImplementation(async (name: string) => ({
      data:
        name === 'subscription_live_owner_term'
          ? { ...term, ...overrides }
          : name === 'subscription_live_owner_quote'
            ? { ...quote, payment_state: 'verified' }
            : name === 'subscription_cancel_live_renewal'
              ? { ...term, renewal_stopped: true }
              : preview,
      error: null,
    }));
    render(
      <SubscriptionLiveReview
        organizationId={organizationId}
        accountId={accountId}
      />
    );
  }
  it('reviews a new amount only after expiry and sends the previous term identity', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const submitted = JSON.parse(String(init.body));
      return Response.json({
        quote: {
          request_id: submitted.requestId,
          amount_minor: 79900,
          currency: 'INR',
        },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    fixture();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Review renewal amount' })
    );
    expect(await screen.findByText('₹799.00 for one month')).toBeTruthy();
    expect(rpc).toHaveBeenCalledWith('subscription_live_renewal_preview', {
      p_organization_id: organizationId,
      p_billing_account_id: accountId,
      p_tier: 'starter',
    });
    fireEvent.click(
      screen.getByRole('checkbox', {
        name: 'I reviewed this exact Live pilot amount.',
      })
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Confirm plan amount' })
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toMatchObject({
      renewalOfRequestId: term.request_id,
      seenAmountMinor: 79900,
    });
  });
  it('keeps early renewal unavailable while retaining explicit cancellation', async () => {
    fixture({ expired: false, paid_through_end: '2099-10-01T00:00:00Z' });
    const cancel = await screen.findByRole('button', {
      name: 'Cancel renewal',
    });
    expect(
      screen.queryByRole('button', { name: 'Review renewal amount' })
    ).toBeNull();
    expect(cancel.hasAttribute('disabled')).toBe(true);
    fireEvent.click(
      screen.getByRole('checkbox', {
        name: 'Cancel renewal. Keep paid access until expiry. No refund is issued.',
      })
    );
    fireEvent.click(cancel);
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith('subscription_cancel_live_renewal', {
        p_organization_id: organizationId,
        p_seen_request_id: term.request_id,
      })
    );
    expect(
      await screen.findByText(
        'Renewal is cancelled. Contact support to buy again.'
      )
    ).toBeTruthy();
  });
  it('shows a payment review instead of another Checkout', async () => {
    vi.stubEnv('NEXT_PUBLIC_USEFULDESK_LIVE_CHECKOUT_UI', 'true');
    rpc.mockImplementation(async (name: string) => ({
      data:
        name === 'subscription_live_owner_term'
          ? term
          : { ...quote, payment_state: 'review_required' },
      error: null,
    }));
    render(
      <SubscriptionLiveReview
        organizationId={organizationId}
        accountId={accountId}
      />
    );
    expect(
      await screen.findByText(
        'Your payment needs a review. Contact support before paying again.'
      )
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Pay for plan' })).toBeNull();
  });
  it('does not offer renewal after a refund or cancellation', async () => {
    fixture({ renewal_stopped: true });
    await screen.findByText(
      'Renewal is cancelled. Contact support to buy again.'
    );
    expect(
      screen.queryByRole('button', { name: 'Review renewal amount' })
    ).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cancel renewal' })).toBeNull();
  });
  it('uses Starter alone for customer review and never offers expiry renewal', async () => {
    rpc.mockImplementation(async (name: string) => ({
      data:
        name === 'subscription_live_offer_preview'
          ? {
              approval_id: quote.request_id,
              tier: 'starter',
              amount_minor: 79900,
              currency: 'INR',
              customer_tax_note: 'Unissued tax review',
              customer_terms_note: 'One month',
            }
          : null,
      error: null,
    }));
    render(
      <SubscriptionLiveReview
        organizationId={organizationId}
        accountId={accountId}
        starterCustomer
      />
    );
    const review = await screen.findByRole('button', {
      name: 'Review plan amount',
    });
    expect(screen.queryByRole('combobox')).toBeNull();
    fireEvent.click(review);
    expect(await screen.findByText('₹799.00 for one month')).toBeTruthy();
    expect(rpc).toHaveBeenCalledWith(
      'subscription_live_offer_preview',
      expect.objectContaining({ p_tier: 'starter' })
    );
    cleanup();
    rpc.mockImplementation(async (name: string) => ({
      data:
        name === 'subscription_live_owner_term'
          ? {
              request_id: quote.request_id,
              tier: 'starter',
              paid_through_end: '2026-10-01T00:00:00Z',
              renewal_stopped: false,
              refunded: false,
              expired: true,
            }
          : null,
      error: null,
    }));
    render(
      <SubscriptionLiveReview
        organizationId={organizationId}
        accountId={accountId}
        starterCustomer
      />
    );
    expect(
      await screen.findByText('Contact support to renew after expiry.')
    ).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: 'Review renewal amount' })
    ).toBeNull();
  });

  it('refuses customer Checkout for a non-Starter or changed amount', async () => {
    vi.stubEnv('NEXT_PUBLIC_USEFULDESK_CUSTOMER_CHECKOUT_UI', 'true');
    render(
      <SubscriptionLiveReview
        organizationId={organizationId}
        accountId={accountId}
        starterCustomer
      />
    );
    expect(
      await screen.findByText('Could not load your plan amount. Try again.')
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Pay for plan' })).toBeNull();
    expect(openUsefulmadeLiveCheckout).not.toHaveBeenCalled();
  });

  it('reviews an expired customer term through the separate renewal gate', async () => {
    vi.stubEnv('NEXT_PUBLIC_USEFULDESK_CUSTOMER_RENEWALS_UI', 'true');
    const customerTerm = {
      request_id: quote.request_id,
      tier: 'starter',
      paid_through_end: '2026-10-01T00:00:00Z',
      renewal_stopped: false,
      refunded: false,
      expired: true,
      renewal_available: true,
    };
    rpc.mockImplementation(async (name: string) => ({
      data:
        name === 'subscription_live_owner_term'
          ? customerTerm
          : name === 'subscription_live_renewal_preview'
            ? {
                approval_id: quote.request_id,
                tier: 'starter',
                amount_minor: 79900,
                currency: 'INR',
                customer_tax_note: 'Reviewed tax note',
                customer_terms_note: 'One month',
                renewal_of_request_id: quote.request_id,
              }
            : null,
      error: null,
    }));
    render(
      <SubscriptionLiveReview
        organizationId={organizationId}
        accountId={accountId}
        starterCustomer
      />
    );
    fireEvent.click(
      await screen.findByRole('button', { name: 'Review renewal amount' })
    );
    expect(await screen.findByText('₹799.00 for one month')).toBeTruthy();
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('keeps an expired ambiguous order in recovery instead of offering another quote', async () => {
    rpc.mockImplementation(async (name: string) => ({
      data:
        name === 'subscription_live_owner_term'
          ? null
          : {
              ...quote,
              expires_at: '2026-01-01T00:00:00Z',
              order_state: 'claimed',
            },
      error: null,
    }));
    render(
      <SubscriptionLiveReview
        organizationId={organizationId}
        accountId={accountId}
      />
    );
    expect(await screen.findByText(/Payment setup needs a check/)).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: 'Review a new amount' })
    ).toBeNull();
    expect(screen.queryByRole('button', { name: 'Pay for plan' })).toBeNull();
  });
});

const monthlyQuote = {
  ...quote,
  tier: 'growth',
  amount_minor: 149900,
  monthly_offer_id: '66666666-6666-4666-8666-666666666666',
  offer_contract_version: 'monthly_first_v1',
  catalog_version: 'monthly_inr_2026_10_v1',
  included_branches: 1,
  paid_extra_branch_slots: 0,
};
it('rejects an expired monthly quote after deferred SDK loading without unmounting', async () => {
  const { openUsefulmadeLiveCheckout: actualCheckout } = await vi.importActual<
    typeof import('@/lib/subscriptions/live-checkout-client')
  >('@/lib/subscriptions/live-checkout-client');
  openUsefulmadeLiveCheckout.mockImplementation(actualCheckout);
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('NEXT_PUBLIC_USEFULDESK_MONTHLY_CHECKOUT_UI', 'true');
  vi.stubGlobal('Razorpay', undefined);
  vi.useFakeTimers();
  const now = Date.now();
  rpc.mockImplementation(async (name: string) => ({
    data:
      name === 'subscription_live_owner_quote'
        ? { ...monthlyQuote, expires_at: new Date(now + 1000).toISOString() }
        : null,
    error: null,
  }));
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({
        checkout: {
          requestId: quote.request_id,
          organizationId,
          orderId: 'order_Monthly123',
          keyId: 'rzp_live_Usefulmade',
          amountMinor: 149900,
          currency: 'INR',
        },
      })
    )
  );
  await act(async () => {
    render(
      <SubscriptionLiveReview
        monthlyCustomer
        organizationId={organizationId}
        accountId={accountId}
      />
    );
  });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Pay for plan' }));
  });
  const script = document.querySelector(
    'script[src="https://checkout.razorpay.com/v1/checkout.js"]'
  ) as HTMLScriptElement;
  expect(script).toBeTruthy();
  await act(async () => {
    vi.advanceTimersByTime(1100);
  });
  expect(
    screen.getByText(
      'This amount has expired. Contact support for a new amount.'
    )
  ).toBeTruthy();
  const create = vi.fn();
  vi.stubGlobal(
    'Razorpay',
    class {
      constructor(options: unknown) {
        create(options);
      }
      open = vi.fn();
    }
  );
  await act(async () => {
    script.onload!(new Event('load'));
  });
  expect(create).not.toHaveBeenCalled();
  script.remove();
});
it('opens monthly checkout with exact server amount and leaves callback verification pending', async () => {
  vi.stubEnv('NEXT_PUBLIC_USEFULDESK_MONTHLY_CHECKOUT_UI', 'true');
  vi.stubEnv('NEXT_PUBLIC_USEFULDESK_CUSTOMER_CHECKOUT_UI', 'false');
  vi.stubEnv('NEXT_PUBLIC_USEFULDESK_LIVE_CHECKOUT_UI', 'false');
  rpc.mockImplementation(async (name: string) => ({
    data: name === 'subscription_live_owner_quote' ? monthlyQuote : null,
    error: null,
  }));
  const fetchMock = vi.fn<typeof fetch>(async () =>
    Response.json({
      checkout: {
        requestId: quote.request_id,
        organizationId,
        orderId: 'order_Monthly123',
        keyId: 'rzp_live_Usefulmade',
        amountMinor: 149900,
        currency: 'INR',
      },
    })
  );
  vi.stubGlobal('fetch', fetchMock);
  render(
    <SubscriptionLiveReview
      monthlyCustomer
      organizationId={organizationId}
      accountId={accountId}
    />
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Pay for plan' }));
  await waitFor(() =>
    expect(openUsefulmadeLiveCheckout).toHaveBeenCalledOnce()
  );
  const input = openUsefulmadeLiveCheckout.mock.calls[0]![0];
  expect(input).toEqual(
    expect.objectContaining({
      planLabel: 'Growth',
      isCurrent: expect.any(Function),
      amountMinor: 149900,
      monthlyCustomer: {
        contractVersion: 'monthly_first_v1',
        catalogVersion: 'monthly_inr_2026_10_v1',
        tier: 'growth',
        amountMinor: 149900,
        currency: 'INR',
        includedBranches: 1,
        paidExtraBranchSlots: 0,
      },
    })
  );
  input.onPayment({
    razorpay_order_id: 'order_Monthly123',
    razorpay_payment_id: 'pay_Monthly123',
    razorpay_signature: 'synthetic',
  });
  expect(
    await screen.findByText(
      'Payment verification pending. Refresh billing to check your access.'
    )
  ).toBeTruthy();
  expect(
    rpc.mock.calls.every(([name]) =>
      [
        'subscription_live_owner_quote',
        'subscription_live_owner_term',
      ].includes(name)
    )
  ).toBe(true);
});
it.each(['expired', 'refunded', 'held', 'paid'])(
  'keeps %s monthly status visible with all initiation flags closed and no later purchase actions',
  async (state) => {
    vi.stubEnv('NEXT_PUBLIC_USEFULDESK_MONTHLY_CHECKOUT_UI', 'false');
    vi.stubEnv('NEXT_PUBLIC_USEFULDESK_CUSTOMER_CHECKOUT_UI', 'false');
    const term = {
      ...monthlyQuote,
      period_start: '2026-10-01T00:00:00Z',
      paid_through_end: '2026-11-01T00:00:00Z',
      renewal_stopped: false,
      refunded: state === 'refunded',
      expired: state === 'expired',
      renewal_available: false,
      payment_state: state === 'held' ? 'review_required' : 'verified',
      hold_reason: state === 'held' ? 'synthetic_hold' : null,
      refund_state: state === 'refunded' ? 'processed' : null,
    };
    rpc.mockImplementation(async (name: string) => ({
      data: name === 'subscription_live_owner_term' ? term : null,
      error: null,
    }));
    render(
      <SubscriptionLiveReview
        monthlyCustomer
        organizationId={organizationId}
        accountId={accountId}
      />
    );
    expect(await screen.findByText('UsefulDesk Growth')).toBeTruthy();
    expect(screen.getByText('₹1499.00')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Refresh billing' })
    ).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: /renew|pay|upgrade|restart|add/i })
    ).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
  }
);
it('refuses mixed original/monthly modes and a noncatalog monthly quote', async () => {
  rpc.mockImplementation(async (name: string) => ({
    data: name === 'subscription_live_owner_quote' ? monthlyQuote : null,
  }));
  render(
    <SubscriptionLiveReview
      monthlyCustomer
      starterCustomer
      organizationId={organizationId}
      accountId={accountId}
    />
  );
  expect(
    await screen.findByText('Could not load your plan amount. Try again.')
  ).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Pay for plan' })).toBeNull();
});

it('never treats monthly Starter as original Starter checkout authority', async () => {
  vi.stubEnv('NEXT_PUBLIC_USEFULDESK_CUSTOMER_CHECKOUT_UI', 'true');
  rpc.mockImplementation(async (name: string) => ({
    data:
      name === 'subscription_live_owner_quote'
        ? { ...monthlyQuote, tier: 'starter', amount_minor: 79900 }
        : null,
  }));
  render(
    <SubscriptionLiveReview
      starterCustomer
      organizationId={organizationId}
      accountId={accountId}
    />
  );
  expect(
    await screen.findByText('Could not load your plan amount. Try again.')
  ).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Pay for plan' })).toBeNull();
});

it('keeps explicit Starter reminder consent for monthly Starter before payment', async () => {
  vi.stubEnv('NEXT_PUBLIC_USEFULDESK_MONTHLY_CHECKOUT_UI', 'true');
  const starter = { ...monthlyQuote, tier: 'starter', amount_minor: 79900 };
  rpc.mockImplementation(async (name: string) => ({
    data: name === 'subscription_live_owner_quote' ? starter : null,
    error: null,
  }));
  render(
    <SubscriptionLiveReview
      monthlyCustomer
      organizationId={organizationId}
      accountId={accountId}
    />
  );
  const reminder = await screen.findByRole('button', {
    name: 'Save reminder choice',
  });
  expect(reminder.hasAttribute('disabled')).toBe(true);
  expect(
    screen
      .getByRole('button', { name: 'Pay for plan' })
      .hasAttribute('disabled')
  ).toBe(true);
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(reminder);
  await waitFor(() =>
    expect(rpc).toHaveBeenCalledWith(
      'subscription_acknowledge_live_starter_reminders',
      { p_request_id: quote.request_id }
    )
  );
});
