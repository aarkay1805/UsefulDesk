// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ rpc }) }));
vi.mock('@/hooks/use-locale', () => ({
  useLocale: () => ({ fmt: { money: (value: number) => `₹${value}` } }),
}));
vi.mock('./subscription-live-review', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./subscription-live-review')>()),
  SubscriptionLiveReview: () => (
    <div>Existing owner quote and payment flow</div>
  ),
}));
import { SubscriptionCustomerReview } from './subscription-customer-review';
const organizationId = 'f1000000-0000-4000-8000-000000000001';
const accountId = 'f2000000-0000-4000-8000-000000000001';
const offer = {
  preparation_id: 'f4000000-0000-4000-8000-000000000001',
  organization_id: organizationId,
  billing_account_id: accountId,
  amount_minor: 79900,
  currency: 'INR',
  branch_name: 'Old Ambala',
  customer_tax_note: 'GST not charged — supplier unregistered.',
  customer_terms_note: 'One calendar month. No automatic debit.',
  owner_reviewed: false,
  checkout_open: false,
  opening_available: true,
};
beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({ data: offer, error: null });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it('requires a deliberate owner checkbox and then hands off to amount/reminder/payment review', async () => {
  const fetchMock = vi.fn<typeof fetch>(async () => {
    rpc.mockResolvedValue({
      data: { ...offer, owner_reviewed: true, checkout_open: true },
    });
    return Response.json({ reviewed: true });
  });
  vi.stubGlobal('fetch', fetchMock);
  render(
    <SubscriptionCustomerReview
      organizationId={organizationId}
      accountId={accountId}
    />
  );
  const button = await screen.findByRole('button', {
    name: 'Approve Starter offer',
  });
  expect(button.hasAttribute('disabled')).toBe(true);
  expect(fetchMock).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(button);
  expect(
    await screen.findByText('Existing owner quote and payment flow')
  ).toBeTruthy();
  expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string)).toEqual({
    organizationId,
    accountId,
    preparationId: offer.preparation_id,
    seenAmountMinor: 79900,
    termsAccepted: true,
  });
});
it('shows no customer review or payment to an unprepared gym', async () => {
  rpc.mockResolvedValue({ data: null });
  const { container } = render(
    <SubscriptionCustomerReview
      organizationId={organizationId}
      accountId={accountId}
    />
  );
  await waitFor(() => expect(rpc).toHaveBeenCalled());
  expect(container.textContent).toBe('');
});
it('keeps an operator-contained review paused and never retries opening on load', async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  rpc.mockResolvedValue({
    data: { ...offer, owner_reviewed: true, opening_available: false },
  });
  render(
    <SubscriptionCustomerReview
      organizationId={organizationId}
      accountId={accountId}
    />
  );
  expect(await screen.findByText('Payment is paused')).toBeTruthy();
  expect(fetchMock).not.toHaveBeenCalled();
});
it('refuses a preview naming another billing branch', async () => {
  rpc.mockResolvedValue({
    data: { ...offer, billing_account_id: organizationId },
  });
  render(
    <SubscriptionCustomerReview
      organizationId={organizationId}
      accountId={accountId}
    />
  );
  expect(await screen.findByText('Could not load your offer')).toBeTruthy();
  expect(
    screen.queryByRole('button', { name: 'Approve Starter offer' })
  ).toBeNull();
});

it('resets original consent when a different branch replaces the preview', async () => {
  const view = render(
    <SubscriptionCustomerReview
      organizationId={organizationId}
      accountId={accountId}
    />
  );
  fireEvent.click(await screen.findByRole('checkbox'));
  expect(screen.getByRole('checkbox').getAttribute('aria-checked')).toBe(
    'true'
  );
  rpc.mockImplementation(async (name: string) => ({
    data:
      name === 'subscription_customer_review_preview'
        ? { ...offer, billing_account_id: 'new-branch' }
        : null,
  }));
  view.rerender(
    <SubscriptionCustomerReview
      organizationId={organizationId}
      accountId="new-branch"
    />
  );
  expect(
    (await screen.findByRole('checkbox')).getAttribute('aria-checked')
  ).toBe('false');
});

it('spins and blocks repeated original review refresh while the request is pending', async () => {
  rpc.mockResolvedValue({
    data: null,
    error: new Error('synthetic unavailable'),
  });
  render(
    <SubscriptionCustomerReview
      organizationId={organizationId}
      accountId={accountId}
    />
  );
  const retry = await screen.findByRole('button', { name: 'Try again' });
  let resolve!: (value: unknown) => void;
  rpc.mockImplementation((name: string) =>
    name === 'subscription_customer_review_preview'
      ? new Promise((r) => {
          resolve = r;
        })
      : Promise.resolve({ data: null })
  );
  fireEvent.click(retry);
  fireEvent.click(retry);
  expect(retry.getAttribute('aria-busy')).toBe('true');
  expect(retry.hasAttribute('disabled')).toBe(true);
  resolve({ data: offer, error: null });
  expect(
    await screen.findByRole('button', { name: 'Approve Starter offer' })
  ).toBeTruthy();
});
