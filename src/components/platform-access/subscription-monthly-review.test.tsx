// @vitest-environment jsdom
import {
  cleanup,
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const { rpc, checkout } = vi.hoisted(() => ({
  rpc: vi.fn(),
  checkout: vi.fn(),
}));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ rpc }) }));
vi.mock('@/hooks/use-pending-navigation', () => ({
  usePendingNavigation: () => ({ navigate: vi.fn(), pendingHref: null }),
}));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ isOrganizationOwner: true }),
}));
vi.mock('@/hooks/use-locale', () => ({
  useLocale: () => ({
    fmt: { money: (v: number) => `₹${v}`, dateTime: (v: string) => v },
  }),
}));
vi.mock('@/lib/subscriptions/live-checkout-client', () => ({
  openUsefulmadeLiveCheckout: checkout,
}));
import { SubscriptionMonthlyReview } from './subscription-monthly-review';
import { monthlyCatalogOffer } from '@/lib/subscriptions/monthly-contract';
export const organizationId = '11111111-1111-4111-8111-111111111111';
export const accountId = '22222222-2222-4222-8222-222222222222';
export const preview = {
  offerSetId: '33333333-3333-4333-8333-333333333333',
  organizationId,
  billingAccountId: accountId,
  contractVersion: 'monthly_first_v1',
  catalogVersion: 'monthly_inr_2026_10_v1',
  sourceSnapshot: 'source-a',
  activeBranches: [{ accountId, name: 'Billing branch' }],
  selectedOfferId: null,
  capabilitiesEnabled: true,
  openingEnabled: false,
  choices: ['starter', 'growth', 'ultimate'].map((tier, i) => ({
    available: true,
    offerId: `44444444-4444-4444-8444-44444444444${i}`,
    identity: monthlyCatalogOffer(tier as 'starter' | 'growth' | 'ultimate'),
    taxNote: 'GST not charged. Supplier unregistered.',
    termsNote: 'One calendar month from verified payment.',
    refundNote: 'Full first payment refund through local day 7.',
    documentTreatment: 'usefulmade_unregistered_invoice_receipt_v1',
  })),
};
beforeEach(() => {
  rpc.mockReset();
  rpc.mockImplementation(async (name: string) => ({
    data: name === 'subscription_monthly_offer_preview' ? preview : null,
    error: null,
  }));
  vi.stubEnv('NEXT_PUBLIC_USEFULDESK_MONTHLY_CHECKOUT_UI', 'true');
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
it('starts unchecked, resets consent on selection and posts only the exact selected offer', async () => {
  const fetchMock = vi.fn<typeof fetch>(async () =>
    Response.json({
      reviewed: true,
      reviewId: '55555555-5555-4555-8555-555555555555',
      offerId: preview.choices[2]!.offerId,
    })
  );
  vi.stubGlobal('fetch', fetchMock);
  render(
    <SubscriptionMonthlyReview
      organizationId={organizationId}
      accountId={accountId}
    />
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Choose Growth' }));
  const consent = screen.getByRole('checkbox', {
    name: /reviewed this Growth offer/i,
  });
  expect(consent.getAttribute('aria-checked')).toBe('false');
  fireEvent.click(consent);
  fireEvent.click(screen.getByRole('button', { name: 'Choose Ultimate' }));
  expect(
    screen
      .getByRole('checkbox', { name: /reviewed this Ultimate offer/i })
      .getAttribute('aria-checked')
  ).toBe('false');
  fireEvent.click(
    screen.getByRole('checkbox', { name: /reviewed this Ultimate offer/i })
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Approve Ultimate offer' })
  );
  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string)).toEqual({
    organizationId,
    accountId,
    offerSetId: preview.offerSetId,
    offerId: preview.choices[2]!.offerId,
    seenAmountMinor: 399900,
    termsAccepted: true,
  });
  expect(screen.queryByRole('button', { name: 'Choose Growth' })).toBeNull();
});
it('ignores an old organization response and never restores consent', async () => {
  let resolve!: (v: unknown) => void;
  rpc.mockImplementation((name: string, args: Record<string, string>) =>
    name === 'subscription_monthly_offer_preview' &&
    args.p_organization_id === organizationId
      ? new Promise((r) => {
          resolve = r;
        })
      : Promise.resolve({
          data:
            name === 'subscription_monthly_offer_preview'
              ? { ...preview, organizationId: 'other' }
              : null,
        })
  );
  const view = render(
    <SubscriptionMonthlyReview
      organizationId={organizationId}
      accountId={accountId}
    />
  );
  view.rerender(
    <SubscriptionMonthlyReview organizationId="other" accountId={accountId} />
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Choose Growth' }));
  await act(async () => resolve({ data: preview }));
  expect(
    screen
      .getByRole('checkbox', { name: /reviewed this Growth offer/i })
      .getAttribute('aria-checked')
  ).toBe('false');
});

it('archives separately, keeps billing and requires fresh preparation after success', async () => {
  const roster = {
    ...preview,
    activeBranches: [
      ...preview.activeBranches,
      {
        accountId: '66666666-6666-4666-8666-666666666666',
        name: 'Second branch',
      },
    ],
  };
  rpc.mockImplementation(async (name: string) => ({
    data: name === 'subscription_monthly_offer_preview' ? roster : null,
  }));
  const fetchMock = vi.fn<typeof fetch>(async () =>
    Response.json({ result: { archived_count: 1, preparation_stale: true } })
  );
  vi.stubGlobal('fetch', fetchMock);
  render(
    <SubscriptionMonthlyReview
      organizationId={organizationId}
      accountId={accountId}
    />
  );
  fireEvent.click(
    await screen.findByRole('button', { name: 'Review branches' })
  );
  expect(
    screen.getByText(
      'These branches will be archived now, even if you do not finish payment. Their history stays saved.'
    )
  ).toBeTruthy();
  expect(
    screen
      .getByRole('checkbox', { name: 'Billing branch' })
      .getAttribute('aria-disabled')
  ).toBe('true');
  fireEvent.click(screen.getByRole('checkbox', { name: 'Second branch' }));
  const archive = screen.getByRole('button', {
    name: 'Archive selected branches',
  });
  expect(archive.hasAttribute('disabled')).toBe(true);
  expect(fetchMock).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole('checkbox', {
      name: 'I understand these branches will be archived now.',
    })
  );
  fireEvent.click(archive);
  expect(await screen.findByText('Branches archived')).toBeTruthy();
  expect(
    screen
      .getByRole('button', { name: 'Refresh offers' })
      .hasAttribute('disabled')
  ).toBe(false);
  expect(screen.queryByRole('button', { name: /Approve/ })).toBeNull();
  expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string)).toEqual({
    organizationId,
    accountId,
    offerSetId: preview.offerSetId,
    accountIds: ['66666666-6666-4666-8666-666666666666'],
  });
});

it('locks selection during an uncertain saved review and recovers the same offer after 409', async () => {
  let resolve!: (r: Response) => void;
  const fetchMock = vi.fn<typeof fetch>(
    () =>
      new Promise((r) => {
        resolve = r;
      })
  );
  vi.stubGlobal('fetch', fetchMock);
  render(
    <SubscriptionMonthlyReview
      organizationId={organizationId}
      accountId={accountId}
    />
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Choose Growth' }));
  fireEvent.click(
    screen.getByRole('checkbox', { name: /reviewed this Growth/i })
  );
  const approve = screen.getByRole('button', { name: 'Approve Growth offer' });
  fireEvent.click(approve);
  fireEvent.click(approve);
  expect(approve.getAttribute('aria-busy')).toBe('true');
  expect(fetchMock).toHaveBeenCalledOnce();
  expect(screen.queryByRole('button', { name: 'Choose Ultimate' })).toBeNull();
  await act(async () =>
    resolve(
      Response.json(
        { error: 'Your review was saved. Contact support to open payment.' },
        { status: 409 }
      )
    )
  );
  expect(
    await screen.findByText(
      'Your review was saved. Contact support to open payment.'
    )
  ).toBeTruthy();
  expect(
    screen
      .getByRole('checkbox', { name: /reviewed this Growth/i })
      .getAttribute('aria-checked')
  ).toBe('false');
});

it.each(['review', 'quote'])(
  'retains the frozen offer and request through pending %s and an older manual refresh after failure',
  async (phase) => {
    let resolve!: (response: Response) => void;
    let delayed = true;
    const uuid = vi.spyOn(crypto, 'randomUUID');
    const fetchMock = vi.fn<typeof fetch>(async (url) => {
      if (
        delayed &&
        String(url).endsWith(
          phase === 'review' ? 'monthly-review' : 'monthly-quotes'
        )
      )
        return new Promise((r) => {
          resolve = r;
        });
      if (String(url).endsWith('monthly-review'))
        return Response.json({
          reviewed: true,
          reviewId: 'saved-review',
          offerId: preview.choices[1]!.offerId,
        });
      return Response.json(
        { error: 'Payment setup needs support.' },
        { status: 409 }
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    render(
      <SubscriptionMonthlyReview
        organizationId={organizationId}
        accountId={accountId}
      />
    );
    fireEvent.click(
      await screen.findByRole('button', { name: 'Choose Growth' })
    );
    fireEvent.click(
      screen.getByRole('checkbox', { name: /reviewed this Growth/i })
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Approve Growth offer' })
    );
    await waitFor(() => expect(resolve).toBeTypeOf('function'));
    const beforeRefresh = rpc.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Refresh offers' }));
    expect(rpc.mock.calls.length).toBe(beforeRefresh);
    expect(
      screen.queryByRole('button', { name: 'Choose Ultimate' })
    ).toBeNull();
    delayed = false;
    await act(async () =>
      resolve(
        Response.json(
          { error: 'Payment setup needs support.' },
          { status: 409 }
        )
      )
    );
    await screen.findByText('Payment setup needs support.');
    // The preview still reflects a read before the unknown write committed.
    fireEvent.click(screen.getByRole('button', { name: 'Refresh offers' }));
    await waitFor(() =>
      expect(rpc.mock.calls.length).toBeGreaterThan(beforeRefresh)
    );
    await waitFor(() =>
      expect(
        screen
          .getByRole('button', { name: 'Refresh offers' })
          .getAttribute('aria-busy')
      ).not.toBe('true')
    );
    expect(
      screen.queryByRole('button', { name: 'Choose Ultimate' })
    ).toBeNull();
    const consent = screen.getByRole('checkbox', {
      name: /reviewed this Growth/i,
    });
    expect(consent.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(consent);
    fireEvent.click(
      screen.getByRole('button', {
        name:
          phase === 'review' ? 'Approve Growth offer' : 'Continue to payment',
      })
    );
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.filter(([url]) =>
          String(url).endsWith('monthly-quotes')
        ).length
      ).toBe(phase === 'quote' ? 2 : 1)
    );
    const quotes = fetchMock.mock.calls
      .filter(([url]) => String(url).endsWith('monthly-quotes'))
      .map(([, init]) => JSON.parse(init!.body as string));
    expect(uuid).toHaveBeenCalledOnce();
    expect(
      quotes.every(
        (q) =>
          q.offerId === preview.choices[1]!.offerId &&
          q.requestId === quotes[0]!.requestId &&
          q.reviewId === 'saved-review'
      )
    ).toBe(true);
    uuid.mockRestore();
  }
);

it('keeps an uncertain offer frozen when refresh returns a different preparation', async () => {
  const fetchMock = vi.fn(async () =>
    Response.json({ error: 'Saved review outcome unknown.' }, { status: 409 })
  );
  vi.stubGlobal('fetch', fetchMock);
  render(
    <SubscriptionMonthlyReview
      organizationId={organizationId}
      accountId={accountId}
    />
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Choose Growth' }));
  fireEvent.click(
    screen.getByRole('checkbox', { name: /reviewed this Growth/i })
  );
  fireEvent.click(screen.getByRole('button', { name: 'Approve Growth offer' }));
  await screen.findByText('Saved review outcome unknown.');
  rpc.mockImplementation(async (name: string) => ({
    data:
      name === 'subscription_monthly_offer_preview'
        ? { ...preview, sourceSnapshot: 'source-b', offerSetId: 'fresh-set' }
        : null,
    error: null,
  }));
  fireEvent.click(screen.getByRole('button', { name: 'Refresh offers' }));
  await waitFor(() =>
    expect(
      screen
        .getByRole('button', { name: 'Refresh offers' })
        .getAttribute('aria-busy')
    ).not.toBe('true')
  );
  expect(screen.queryByRole('button', { name: 'Choose Ultimate' })).toBeNull();
  const consent = screen.getByRole('checkbox', {
    name: /reviewed this Growth/i,
  });
  expect(consent.getAttribute('aria-checked')).toBe('false');
  fireEvent.click(consent);
  fireEvent.click(screen.getByRole('button', { name: 'Approve Growth offer' }));
  expect(
    await screen.findByText('Your saved offer needs a review')
  ).toBeTruthy();
  expect(fetchMock).toHaveBeenCalledOnce();
});

it('requires exact monthly quote identity before handing off to checkout', async () => {
  const fetchMock = vi.fn<typeof fetch>(async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    return Response.json(
      String(_url).endsWith('monthly-review')
        ? {
            reviewed: true,
            reviewId: '55555555-5555-4555-8555-555555555555',
            offerId: preview.choices[1]!.offerId,
          }
        : {
            quote: {
              request_id: body.requestId,
              organization_id: organizationId,
              monthly_offer_id: preview.choices[1]!.offerId,
              offer_contract_version: 'monthly_first_v1',
              catalog_version: 'monthly_inr_2026_10_v1',
              tier: 'growth',
              amount_minor: 79900,
              currency: 'INR',
              included_branches: 1,
              paid_extra_branch_slots: 0,
              expires_at: '2099-01-01T00:00:00Z',
            },
          }
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  render(
    <SubscriptionMonthlyReview
      organizationId={organizationId}
      accountId={accountId}
    />
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Choose Growth' }));
  fireEvent.click(
    screen.getByRole('checkbox', { name: /reviewed this Growth/i })
  );
  fireEvent.click(screen.getByRole('button', { name: 'Approve Growth offer' }));
  expect(
    await screen.findByText(
      'Could not check the reviewed amount. Refresh billing or contact support.'
    )
  ).toBeTruthy();
  expect(checkout).not.toHaveBeenCalled();
  expect(JSON.parse(fetchMock.mock.calls[1]![1]!.body as string)).toEqual({
    organizationId,
    accountId,
    requestId: expect.any(String),
    reviewId: '55555555-5555-4555-8555-555555555555',
    offerId: preview.choices[1]!.offerId,
    seenAmountMinor: 149900,
  });
});

it('resets source-bound consent after refresh and ignores a late approval after branch change', async () => {
  let resolve!: (r: Response) => void;
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(
      () =>
        new Promise((r) => {
          resolve = r;
        })
    )
  );
  const view = render(
    <SubscriptionMonthlyReview
      organizationId={organizationId}
      accountId={accountId}
    />
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Choose Growth' }));
  fireEvent.click(
    screen.getByRole('checkbox', { name: /reviewed this Growth/i })
  );
  fireEvent.click(screen.getByRole('button', { name: 'Refresh offers' }));
  expect(
    (
      await screen.findByRole('checkbox', { name: /reviewed this Starter/i })
    ).getAttribute('aria-checked')
  ).toBe('false');
  fireEvent.click(
    screen.getByRole('checkbox', { name: /reviewed this Starter/i })
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Approve Starter offer' })
  );
  rpc.mockImplementation(async (name: string) => ({
    data:
      name === 'subscription_monthly_offer_preview'
        ? {
            ...preview,
            billingAccountId: 'new-branch',
            activeBranches: [
              { accountId: 'new-branch', name: 'New billing branch' },
            ],
          }
        : null,
  }));
  view.rerender(
    <SubscriptionMonthlyReview
      organizationId={organizationId}
      accountId="new-branch"
    />
  );
  await screen.findByText('Billing branch: New billing branch.');
  await act(async () =>
    resolve(
      Response.json({
        reviewed: true,
        reviewId: '55555555-5555-4555-8555-555555555555',
        offerId: preview.choices[0]!.offerId,
      })
    )
  );
  expect(
    screen
      .getByRole('checkbox', { name: /reviewed this Starter/i })
      .getAttribute('aria-checked')
  ).toBe('false');
  expect(
    screen.queryByText(
      'Your selected offer is saved for payment. Contact support to change it.'
    )
  ).toBeNull();
});

it('preserves an original saved Starter review even after monthly UI opens', async () => {
  rpc.mockImplementation(async (name: string) => ({
    data:
      name === 'subscription_monthly_offer_preview'
        ? preview
        : name === 'subscription_customer_review_preview'
          ? {
              preparation_id: '77777777-7777-4777-8777-777777777777',
              organization_id: organizationId,
              billing_account_id: accountId,
              amount_minor: 79900,
              currency: 'INR',
              branch_name: 'Billing branch',
              customer_tax_note: 'Original tax note',
              customer_terms_note: 'Original terms',
              owner_reviewed: true,
              checkout_open: false,
              opening_available: true,
            }
          : null,
  }));
  vi.stubEnv('NEXT_PUBLIC_USEFULDESK_CUSTOMER_CHECKOUT_UI', 'false');
  render(
    <SubscriptionMonthlyReview
      organizationId={organizationId}
      accountId={accountId}
    />
  );
  expect(
    await screen.findByText('Starter payment needs a review')
  ).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Choose Growth' })).toBeNull();
});
it('preserves original held quote recovery under original checkout flags', async () => {
  rpc.mockImplementation(async (name: string) => ({
    data:
      name === 'subscription_monthly_offer_preview'
        ? preview
        : name === 'subscription_live_owner_quote'
          ? {
              request_id: '88888888-8888-4888-8888-888888888888',
              tier: 'starter',
              amount_minor: 79900,
              currency: 'INR',
              expires_at: '2099-01-01T00:00:00Z',
              starter_reminder_reset_accepted: true,
              starter_reminder_policy_version: null,
              approved_starter_reminder_policy: null,
              payment_state: 'review_required',
            }
          : null,
  }));
  render(
    <SubscriptionMonthlyReview
      organizationId={organizationId}
      accountId={accountId}
    />
  );
  expect(
    await screen.findByText(
      'Your payment needs a review. Contact support before paying again.'
    )
  ).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Choose Growth' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Pay for plan' })).toBeNull();
});

it('keeps a selected monthly Starter preparation in monthly mode despite the legacy preview projection', async () => {
  const selected = { ...preview, selectedOfferId: preview.choices[0]!.offerId };
  rpc.mockImplementation(async (name: string) => ({
    data:
      name === 'subscription_monthly_offer_preview'
        ? selected
        : name === 'subscription_customer_review_preview'
          ? {
              preparation_id: '77777777-7777-4777-8777-777777777777',
              organization_id: organizationId,
              billing_account_id: accountId,
              amount_minor: 79900,
              currency: 'INR',
              branch_name: 'Billing branch',
              customer_tax_note: 'Monthly tax note',
              customer_terms_note: 'Monthly terms',
              owner_reviewed: true,
              checkout_open: false,
              opening_available: false,
            }
          : null,
  }));
  vi.stubEnv('NEXT_PUBLIC_USEFULDESK_CUSTOMER_CHECKOUT_UI', 'false');
  render(
    <SubscriptionMonthlyReview
      organizationId={organizationId}
      accountId={accountId}
    />
  );
  expect(await screen.findByText('Review UsefulDesk Starter')).toBeTruthy();
  expect(screen.queryByText('Starter payment needs a review')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Choose Growth' })).toBeNull();
  expect(
    screen.getByRole('button', { name: 'Approve Starter offer' })
  ).toBeTruthy();
});

it.each(['error', 'malformed', 'stale'])(
  'never uses a legacy amount projection as original authority when monthly preview is %s',
  async (state) => {
    const starter = {
      preparation_id: '77777777-7777-4777-8777-777777777777',
      organization_id: organizationId,
      billing_account_id: accountId,
      amount_minor: 79900,
      currency: 'INR',
      branch_name: 'Billing branch',
      customer_tax_note: 'Monthly tax note',
      customer_terms_note: 'Monthly terms',
      owner_reviewed: true,
      checkout_open: false,
      opening_available: false,
    };
    rpc.mockImplementation(async (name: string) =>
      name === 'subscription_monthly_offer_preview'
        ? {
            data:
              state === 'malformed'
                ? { ...preview, contractVersion: 'wrong' }
                : state === 'stale'
                  ? {
                      ...preview,
                      selectedOfferId: preview.choices[0]!.offerId,
                      choices: preview.choices.map((c) => ({
                        available: false,
                        tier: c.identity.tier,
                        reason:
                          'Your details changed. Ask support to review the offers again.',
                      })),
                    }
                  : null,
            error: state === 'error' ? new Error('synthetic error') : null,
          }
        : {
            data:
              name === 'subscription_customer_review_preview' ? starter : null,
          }
    );
    render(
      <SubscriptionMonthlyReview
        organizationId={organizationId}
        accountId={accountId}
      />
    );
    await waitFor(() => expect(rpc).toHaveBeenCalled());
    expect(screen.queryByText('Starter payment needs a review')).toBeNull();
    expect(screen.queryByRole('button', { name: /Approve|Pay/i })).toBeNull();
    expect(
      await screen.findByRole('button', { name: 'Refresh offers' })
    ).toBeTruthy();
  }
);
