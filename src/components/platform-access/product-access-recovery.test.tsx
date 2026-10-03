// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ProductAccessSnapshot } from '@/lib/platform-access/model';
import { monthlyCatalogOffer } from '@/lib/subscriptions/monthly-contract';
const { rpc, checkout, auth, router } = vi.hoisted(() => ({
  rpc: vi.fn(),
  checkout: vi.fn(),
  router: { refresh: vi.fn() },
  auth: {
    accountId: 'branch-1',
    organizationId: 'org-1',
    accountStatus: 'ready',
    user: { id: 'owner-1' },
    isOrganizationOwner: true,
    branches: [],
    signOut: vi.fn(),
    switchBranch: vi.fn(),
  },
}));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ rpc }) }));
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => auth }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('@/hooks/use-locale', () => ({
  useLocale: () => ({
    fmt: { money: (v: number) => `₹${v}`, dateTime: (v: string) => v },
  }),
}));
vi.mock('@/lib/subscriptions/live-checkout-client', () => ({
  openUsefulmadeLiveCheckout: checkout,
}));
import { ProductAccessGate } from './product-access-gate';
const expired = (
  organizationId = auth.organizationId
): ProductAccessSnapshot => ({
  access: {
    organization_id: organizationId,
    mode: 'trial',
    trial_started_at: '2026-09-01T00:00:00Z',
    trial_ends_at: '2026-09-15T00:00:00Z',
    access_starts_at: null,
    access_ends_at: null,
    suspended_at: null,
    version: 1,
  },
  allowed: false,
  status: 'expired',
  enforcement_enabled: true,
  support_email: 'support@example.test',
  support_whatsapp: null,
});
function monthlyQuote(paymentState: 'review_required' | null = null) {
  const identity = monthlyCatalogOffer('growth');
  return {
    request_id: 'request-frozen',
    tier: identity.tier,
    amount_minor: identity.amountMinor,
    currency: identity.currency,
    monthly_offer_id: 'offer-frozen',
    offer_contract_version: identity.contractVersion,
    catalog_version: identity.catalogVersion,
    included_branches: identity.includedBranches,
    paid_extra_branch_slots: 0,
    expires_at: '2026-10-03T12:30:00Z',
    starter_reminder_reset_accepted: false,
    order_state: 'bound',
    payment_state: paymentState,
    customer_tax_note: 'Saved tax terms.',
    customer_terms_note: 'Saved payment terms.',
  };
}
function gate() {
  return (
    <ProductAccessGate
      initialAccess={{
        accountId: auth.accountId,
        organizationId: auth.organizationId,
        snapshot: expired(),
      }}
    >
      Operations
    </ProductAccessGate>
  );
}
function load(quote: unknown = null) {
  rpc.mockImplementation(async (name: string) => ({
    data:
      name === 'subscription_live_owner_quote'
        ? quote
        : name === 'product_access_for_account'
          ? expired()
          : null,
    error: null,
  }));
}
function noInitiation() {
  expect(
    screen.queryByRole('button', {
      name: /Choose|Approve|Continue to payment|Pay for plan|Review branches/i,
    })
  ).toBeNull();
  expect(checkout).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
  expect(rpc).not.toHaveBeenCalledWith(
    'subscription_monthly_offer_preview',
    expect.anything()
  );
}
beforeEach(() => {
  rpc.mockReset();
  checkout.mockReset();
  auth.accountId = 'branch-1';
  auth.organizationId = 'org-1';
  auth.user.id = 'owner-1';
  auth.isOrganizationOwner = true;
  for (const flag of [
    'MONTHLY_CHECKOUT_UI',
    'CUSTOMER_CHECKOUT_UI',
    'CUSTOMER_RENEWALS_UI',
    'LIVE_REVIEW_UI',
    'LIVE_CHECKOUT_UI',
    'TEST_BILLING_UI',
  ])
    vi.stubEnv(`NEXT_PUBLIC_USEFULDESK_${flag}`, 'false');
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-03T12:00:00Z'));
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
it.each([null, 'review_required'] as const)(
  'shows the actual frozen monthly status from the closed expired-trial root: %s',
  async (state) => {
    load(monthlyQuote(state));
    render(gate());
    expect(await screen.findByText('UsefulDesk Growth')).toBeTruthy();
    expect(screen.getByText('₹1499 for one month')).toBeTruthy();
    expect(screen.getByText('Saved payment terms.')).toBeTruthy();
    expect(
      screen.getByRole('link', { name: 'Email support' }).getAttribute('href')
    ).toContain('org-1');
    if (state)
      expect(
        screen.getByText(
          'Your payment needs a review. Contact support before paying again.'
        )
      ).toBeTruthy();
    else expect(screen.getByText(/Payment setup needs a check/)).toBeTruthy();
    noInitiation();
    const prior = rpc.mock.calls.filter(
      ([name]) => name === 'subscription_live_owner_quote'
    ).length;
    fireEvent.click(screen.getByRole('button', { name: 'Refresh billing' }));
    await waitFor(() =>
      expect(
        rpc.mock.calls.filter(
          ([name]) => name === 'subscription_live_owner_quote'
        ).length
      ).toBeGreaterThan(prior)
    );
    noInitiation();
  }
);
it('finds a later durable hold through Check again without enabling initiation', async () => {
  load();
  render(gate());
  await act(async () => {});
  expect(screen.queryByRole('button', { name: 'Refresh billing' })).toBeNull();
  load(monthlyQuote('review_required'));
  fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
  expect(await screen.findByText('UsefulDesk Growth')).toBeTruthy();
  noInitiation();
});
it('keeps a closed root with no obligation on comparison/support only', async () => {
  load();
  render(gate());
  await act(async () => {});
  expect(screen.getByText('Starter')).toBeTruthy();
  expect(
    screen.getByText(/Plan prices and payment are not available yet/)
  ).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Refresh billing' })).toBeNull();
  noInitiation();
});
it.each(['organization', 'account', 'owner', 'actor'] as const)(
  'ignores delayed durable discovery after a %s switch',
  async (context) => {
    let finish!: (v: unknown) => void;
    rpc.mockImplementation((name: string) =>
      name === 'subscription_live_owner_quote'
        ? new Promise((r) => {
            finish = r;
          })
        : Promise.resolve({ data: null, error: null })
    );
    const view = render(gate());
    await act(async () => {});
    expect(rpc).toHaveBeenCalledWith('subscription_live_owner_quote', {
      p_organization_id: 'org-1',
    });
    if (context === 'organization') auth.organizationId = 'org-2';
    if (context === 'account') auth.accountId = 'branch-2';
    if (context === 'owner') auth.isOrganizationOwner = false;
    if (context === 'actor') auth.user.id = 'owner-2';
    load();
    view.rerender(gate());
    await act(async () => {
      finish({ data: monthlyQuote('review_required'), error: null });
    });
    expect(screen.queryByText('UsefulDesk Growth')).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Refresh billing' })
    ).toBeNull();
    noInitiation();
  }
);
it('cancels a delayed production status refresh on organization switch', async () => {
  load(monthlyQuote());
  const view = render(gate());
  await screen.findByText('UsefulDesk Growth');
  let finish!: (v: unknown) => void;
  rpc.mockImplementation((name: string) =>
    name === 'subscription_live_owner_quote'
      ? new Promise((r) => {
          finish = r;
        })
      : Promise.resolve({ data: null, error: null })
  );
  fireEvent.click(screen.getByRole('button', { name: 'Refresh billing' }));
  auth.organizationId = 'org-2';
  load();
  view.rerender(gate());
  await act(async () => {
    finish({ data: monthlyQuote('review_required'), error: null });
  });
  expect(screen.queryByText('UsefulDesk Growth')).toBeNull();
  noInitiation();
});
it.each([
  {},
  { ...monthlyQuote(), amount_minor: 100 },
  { ...monthlyQuote(), offer_contract_version: 'unknown' },
])('does not dispatch malformed or noncatalog discovery: %j', async (quote) => {
  load(quote);
  render(gate());
  await act(async () => {});
  expect(screen.queryByRole('button', { name: 'Refresh billing' })).toBeNull();
  noInitiation();
});
it('does not discover owner obligations for staff', async () => {
  auth.isOrganizationOwner = false;
  load(monthlyQuote());
  render(gate());
  await act(async () => {});
  expect(rpc).not.toHaveBeenCalled();
  noInitiation();
});
it('preserves original customer quote dispatch under its original presentation switch', async () => {
  vi.stubEnv('NEXT_PUBLIC_USEFULDESK_CUSTOMER_CHECKOUT_UI', 'true');
  const original = {
    request_id: 'original-request',
    tier: 'starter',
    amount_minor: 79900,
    currency: 'INR',
    expires_at: '2026-10-03T12:30:00Z',
    starter_reminder_reset_accepted: false,
    order_state: 'bound',
    payment_state: 'review_required',
  };
  rpc.mockImplementation(async (name: string) => ({
    error: null,
    data:
      name === 'subscription_live_owner_quote'
        ? original
        : name === 'subscription_customer_review_preview'
          ? {
              preparation_id: 'original-preparation',
              organization_id: 'org-1',
              billing_account_id: 'branch-1',
              amount_minor: 79900,
              currency: 'INR',
              customer_tax_note: 'Original tax.',
              customer_terms_note: 'Original terms.',
              branch_name: 'Original branch',
              owner_reviewed: true,
              checkout_open: true,
              opening_available: true,
            }
          : null,
  }));
  render(gate());
  expect(await screen.findByText('UsefulDesk Starter')).toBeTruthy();
  expect(await screen.findByText('₹799 for one month')).toBeTruthy();
  expect(
    screen.getByText(
      'Your payment needs a review. Contact support before paying again.'
    )
  ).toBeTruthy();
  expect(checkout).not.toHaveBeenCalled();
});

it('keeps discovered recovery mounted during a failed root refresh', async () => {
  load(monthlyQuote('review_required'));
  render(gate());
  await screen.findByText('UsefulDesk Growth');
  rpc.mockImplementation(async (name: string) => ({
    data: name === 'product_access_for_account' ? expired() : null,
    error:
      name === 'subscription_live_owner_quote' ? { message: 'Offline' } : null,
  }));
  fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
  await act(async () => {});
  expect(screen.getByText('UsefulDesk Growth')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Refresh billing' })).toBeTruthy();
  noInitiation();
});
it.each(['original', 'monthly'] as const)(
  'preserves closed %s manual paid, expired and refunded billing',
  async (contract) => {
    for (const state of ['paid', 'expired', 'refunded']) {
      const manual: ProductAccessSnapshot = {
        ...expired(),
        allowed: state === 'paid',
        status: state === 'paid' ? 'active' : 'expired',
        access: {
          ...expired().access,
          mode: 'manual',
          access_starts_at: '2026-09-01T00:00:00Z',
          access_ends_at:
            state === 'paid' ? '2026-11-01T00:00:00Z' : '2026-09-30T00:00:00Z',
        },
      };
      const term = {
        request_id: 'paid-request',
        tier: contract === 'monthly' ? 'growth' : 'starter',
        paid_through_end: manual.access.access_ends_at,
        period_start: manual.access.access_starts_at,
        expired: state !== 'paid',
        refunded: state === 'refunded',
        renewal_stopped: state === 'refunded',
        renewal_available: false,
        ...(contract === 'monthly'
          ? { ...monthlyQuote(), request_id: 'paid-request', tier: 'growth' }
          : {}),
      };
      rpc.mockImplementation(async (name: string) => ({
        data:
          name === 'subscription_live_owner_term'
            ? term
            : name === 'product_access_for_account'
              ? manual
              : null,
        error: null,
      }));
      const view = render(
        <ProductAccessGate
          initialAccess={{
            accountId: auth.accountId,
            organizationId: auth.organizationId,
            snapshot: manual,
          }}
        >
          Operations
        </ProductAccessGate>
      );
      if (state === 'paid')
        fireEvent.click(
          await screen.findByRole('button', { name: 'Open billing' })
        );
      expect(
        await screen.findByText(
          contract === 'monthly' ? 'UsefulDesk Growth' : 'UsefulDesk Starter'
        )
      ).toBeTruthy();
      if (state !== 'refunded')
        expect(
          await screen.findByText(
            `Paid access ends ${manual.access.access_ends_at}.`
          )
        ).toBeTruthy();
      if (state === 'refunded')
        expect(
          await screen.findByText('Your payment was refunded.')
        ).toBeTruthy();
      expect(
        screen.getByRole('button', { name: 'Refresh billing' })
      ).toBeTruthy();
      noInitiation();
      view.unmount();
    }
  }
);
it('preserves closed internal pilot manual billing dispatch', async () => {
  auth.organizationId = '8826d9aa-03f2-4ad7-ae91-0553052131f8';
  const manual: ProductAccessSnapshot = {
    ...expired(),
    access: {
      ...expired().access,
      mode: 'manual',
      access_starts_at: '2026-09-01T00:00:00Z',
      access_ends_at: '2026-09-30T00:00:00Z',
    },
  };
  rpc.mockImplementation(async (name: string) => ({
    data:
      name === 'subscription_live_owner_term'
        ? {
            request_id: 'internal-request',
            tier: 'starter',
            paid_through_end: '2026-09-30T00:00:00Z',
            expired: true,
            refunded: false,
            renewal_stopped: false,
            renewal_available: false,
          }
        : null,
    error: null,
  }));
  render(
    <ProductAccessGate
      initialAccess={{
        accountId: auth.accountId,
        organizationId: auth.organizationId,
        snapshot: manual,
      }}
    >
      Operations
    </ProductAccessGate>
  );
  expect(await screen.findByText('Usefulmade Live pilot')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Refresh billing' })).toBeTruthy();
  noInitiation();
});
