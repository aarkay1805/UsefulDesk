// @vitest-environment jsdom

import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Membership } from '@/types';
import type { ActionBlocker } from '@/components/ui/resolvable-action';
import { TEMPLATE_CONTRACTS } from '@/lib/whatsapp/template-contracts';

const fetchPaymentLink = vi.hoisted(() => vi.fn());
const navigation = vi.hoisted(() => ({ pathname: '/invoices', push: vi.fn() }));

let accountRole: 'owner' | 'admin' | 'agent' | 'viewer' = 'owner';
let whatsappConnected = true;
let templateReady = true;

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));
vi.mock('next/navigation', () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({ push: navigation.push }),
}));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    accountId: 'account-id',
    accountRole,
  }),
}));
vi.mock('@/hooks/use-locale', () => ({
  useLocale: () => ({
    fmt: {
      dateTime: (value: string) => value,
      money: (value: number) => `₹${value}`,
    },
  }),
}));
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: (table: string) => {
      const builder = {
        select: () => builder,
        eq: () => builder,
        maybeSingle: () =>
          Promise.resolve(
            table === 'whatsapp_config'
              ? {
                  data: whatsappConnected ? { status: 'connected' } : null,
                  error: null,
                }
              : {
                  data: templateReady
                    ? {
                        ...TEMPLATE_CONTRACTS.payment_link.payload,
                        status: 'APPROVED',
                        parameter_format: 'POSITIONAL',
                      }
                    : null,
                  error: null,
                }
          ),
      };
      return builder;
    },
  }),
}));

const { PaymentLinkActions } = await import('./payment-link-actions');

let resolvePaymentLink: ((response: unknown) => void) | null = null;

const member = {
  contact_id: 'contact-id',
  contact: { name: 'Member', phone: '919999999999' },
} as Membership;

function renderActions(
  memberValue: Membership | null = member,
  collectionBlocker?: ActionBlocker | null
) {
  render(
    <PaymentLinkActions
      invoice={{ id: 'invoice-id', reference: '#INVOICE', balance: 50 }}
      member={memberValue}
      collectionBlocker={collectionBlocker}
    />
  );
}

async function resolveReadiness({
  providerReady = true,
  providerReason = null,
  link = null,
}: {
  providerReady?: boolean;
  providerReason?: string | null;
  link?: Record<string, unknown> | null;
} = {}) {
  await act(async () => {
    resolvePaymentLink?.({
      ok: true,
      json: async () => ({
        link,
        availability: { ready: providerReady, reason: providerReason },
      }),
    });
  });
  await waitFor(() =>
    expect(
      screen
        .getByRole('button', { name: 'Copy link' })
        .getAttribute('aria-busy')
    ).not.toBe('true')
  );
}

beforeEach(() => {
  accountRole = 'owner';
  whatsappConnected = true;
  templateReady = true;
  navigation.push.mockReset();
  fetchPaymentLink.mockReset().mockImplementation(
    () =>
      new Promise((resolve) => {
        resolvePaymentLink = resolve;
      })
  );
  vi.stubGlobal('fetch', fetchPaymentLink);
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  resolvePaymentLink = null;
});

/**
 * The controls a blocker actually offers. `ResolvableAction` renders a dismiss
 * affordance of its own, which is not a resolution and must not count as one.
 */
const blockerControls = (blocker: HTMLElement) =>
  within(blocker).queryAllByRole('button', {
    name: (name) => name !== 'Close',
  });

describe('PaymentLinkActions readiness', () => {
  it('applies an external collection blocker to Copy and Send without invoking either action', async () => {
    const onResolve = vi.fn();
    renderActions(member, {
      title: 'Sort out the refund first',
      description: 'Resolve the refund review before collecting again.',
      resolution: { label: 'Sort out refund', onResolve },
    });
    await resolveReadiness();

    const copy = screen.getByRole('button', { name: 'Copy link' });
    const send = screen.getByRole('button', { name: 'Send payment link' });
    expect(copy.getAttribute('aria-disabled')).toBe('true');
    expect(send.getAttribute('aria-disabled')).toBe('true');
    await userEvent.click(copy);
    expect(fetchPaymentLink).toHaveBeenCalledTimes(1);
    await userEvent.click(
      screen.getByRole('button', { name: 'Sort out refund' })
    );
    expect(onResolve).toHaveBeenCalledOnce();
  });

  it('keeps permission ahead of an external blocker and withholds its CTA', async () => {
    accountRole = 'viewer';
    renderActions(member, {
      title: 'Sort out the refund first',
      description: 'Resolve the refund review before collecting again.',
      resolution: { label: 'Sort out refund', onResolve: vi.fn() },
    });
    await resolveReadiness();

    await userEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    expect(screen.getByText('You do not have permission')).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: 'Sort out refund' })
    ).toBeNull();
  });

  it('shows busy spinners until payment-link readiness resolves', async () => {
    renderActions();

    const copy = screen.getByRole('button', { name: 'Copy link' });
    const send = screen.getByRole('button', { name: 'Send payment link' });

    expect(copy.hasAttribute('disabled')).toBe(true);
    expect(copy.getAttribute('aria-busy')).toBe('true');
    expect(copy.querySelector('.animate-spin')).toBeTruthy();
    expect(send.hasAttribute('disabled')).toBe(true);
    expect(send.getAttribute('aria-busy')).toBe('true');
    expect(send.querySelector('.animate-spin')).toBeTruthy();

    await act(async () => {
      resolvePaymentLink?.({
        ok: true,
        json: async () => ({
          link: {
            id: 'link-id',
            revision: 1,
            short_url: 'https://example.test/link',
            expires_at: '2026-08-22T08:45:00.000Z',
            status: 'created',
          },
          availability: { ready: true, reason: null },
        }),
      });
    });

    await waitFor(() =>
      expect(
        screen
          .getByRole('button', { name: 'Copy link' })
          .hasAttribute('disabled')
      ).toBe(false)
    );
    const readyCopy = screen.getByRole('button', { name: 'Copy link' });
    const readySend = screen.getByRole('button', {
      name: 'Send payment link',
    });
    expect(readyCopy.getAttribute('aria-busy')).toBeNull();
    expect(readyCopy.querySelector('.animate-spin')).toBeNull();
    expect(readySend.hasAttribute('disabled')).toBe(false);
    expect(readySend.getAttribute('aria-busy')).toBeNull();
    expect(readySend.querySelector('.animate-spin')).toBeNull();

    const status = screen.getByText('Payment link ready');
    const expiry = screen.getByText('Expires 2026-08-22T08:45:00.000Z');
    expect(status.parentElement).toBe(expiry.parentElement);
    // The caption claims its own line in the footer's collection band so the
    // badge and its expiry read as one label above the link buttons.
    expect(status.parentElement?.classList.contains('w-full')).toBe(true);
    expect(status.parentElement?.lastElementChild).toBe(expiry);
  });

  it('opens payment setup when Razorpay is not connected', async () => {
    accountRole = 'admin';
    renderActions();
    await resolveReadiness({
      providerReady: false,
      providerReason: "Razorpay is not connected",
    });

    const copy = screen.getByRole('button', { name: 'Copy link' });
    expect(copy.getAttribute('aria-disabled')).toBe('true');
    await userEvent.click(copy);

    expect(screen.getByText("Razorpay is not connected")).toBeTruthy();
    const resolution = screen.getByRole('button', {
      name: 'Connect Razorpay',
    });
    expect(resolution.tagName).toBe('A');
    expect(resolution.getAttribute('href')).toBe('/settings?tab=payments');
  });

  it('opens existing payment setup for a recoverable provider state', async () => {
    accountRole = 'admin';
    renderActions();
    await resolveReadiness({
      providerReady: false,
      providerReason: 'Reconnect Razorpay in Settings → Payments',
    });

    await userEvent.click(screen.getByRole('button', { name: 'Copy link' }));

    const resolution = screen.getByRole('button', {
      name: 'Open payment settings',
    });
    expect(resolution.tagName).toBe('A');
    expect(resolution.getAttribute('href')).toBe('/settings?tab=payments');
  });

  it('explains an unsupported provider state without an unsafe destination', async () => {
    renderActions();
    await resolveReadiness({
      providerReady: false,
      providerReason: 'Could not check the payment link',
    });

    await userEvent.click(screen.getByRole('button', { name: 'Copy link' }));

    const blocker = screen.getByRole('dialog', {
      name: 'Payment link not available',
    });
    expect(
      within(blocker).getByText('Could not check the payment link')
    ).toBeTruthy();
    expect(blockerControls(blocker)).toHaveLength(0);
  });

  it('prioritizes permission over all send-readiness blockers', async () => {
    accountRole = 'viewer';
    whatsappConnected = false;
    templateReady = false;
    renderActions(null);
    await resolveReadiness({
      providerReady: false,
      providerReason: "Razorpay is not connected",
    });

    const send = screen.getByRole('button', { name: 'Send payment link' });
    await userEvent.click(send);

    const blocker = screen.getByRole('dialog', {
      name: 'You do not have permission',
    });
    expect(blockerControls(blocker)).toHaveLength(0);
  });

  it('prioritizes a missing phone over provider and template readiness', async () => {
    whatsappConnected = false;
    templateReady = false;
    renderActions(null);
    await resolveReadiness({
      providerReady: false,
      providerReason: "Razorpay is not connected",
    });

    await userEvent.click(
      screen.getByRole('button', { name: 'Send payment link' })
    );

    const blocker = screen.getByRole('dialog', {
      name: 'No phone number',
    });
    expect(blockerControls(blocker)).toHaveLength(0);
  });

  it('prioritizes provider readiness over WhatsApp readiness', async () => {
    whatsappConnected = false;
    templateReady = false;
    renderActions();
    await resolveReadiness({
      providerReady: false,
      providerReason: "Razorpay is not connected",
    });

    await userEvent.click(
      screen.getByRole('button', { name: 'Send payment link' })
    );

    expect(
      screen.getByRole('dialog', { name: "Razorpay is not connected" })
    ).toBeTruthy();
  });

  it('resolves WhatsApp connection before template readiness', async () => {
    accountRole = 'admin';
    whatsappConnected = false;
    templateReady = false;
    renderActions();
    await resolveReadiness();

    await userEvent.click(
      screen.getByRole('button', { name: 'Send payment link' })
    );

    const resolution = screen.getByRole('button', {
      name: 'Connect WhatsApp',
    });
    expect(resolution.tagName).toBe('A');
    expect(resolution.getAttribute('href')).toBe('/settings?tab=whatsapp');
  });

  it('links an unavailable exact template to template setup', async () => {
    accountRole = 'admin';
    templateReady = false;
    renderActions();
    await resolveReadiness();

    await userEvent.click(
      screen.getByRole('button', { name: 'Send payment link' })
    );

    const resolution = screen.getByRole('button', {
      name: 'Open message templates',
    });
    expect(resolution.tagName).toBe('A');
    expect(resolution.getAttribute('href')).toBe('/settings?tab=templates');
  });

  it('does not promise Razorpay setup to an agent', async () => {
    accountRole = 'agent';
    renderActions();
    await resolveReadiness({
      providerReady: false,
      providerReason: "Razorpay is not connected",
    });

    await userEvent.click(screen.getByRole('button', { name: 'Copy link' }));

    const blocker = screen.getByRole('dialog', {
      name: "Razorpay is not connected",
    });
    expect(blockerControls(blocker)).toHaveLength(0);
    expect(within(blocker).queryByRole('link')).toBeNull();
  });

  it.each([
    [false, true, "WhatsApp is not connected"],
    [true, false, "Payment link message is not ready"],
  ])(
    'does not promise WhatsApp or template setup to an agent',
    async (connected, approved, title) => {
      accountRole = 'agent';
      whatsappConnected = connected;
      templateReady = approved;
      renderActions();
      await resolveReadiness();

      await userEvent.click(
        screen.getByRole('button', { name: 'Send payment link' })
      );

      const blocker = screen.getByRole('dialog', { name: title });
      expect(blockerControls(blocker)).toHaveLength(0);
      expect(within(blocker).queryByRole('link')).toBeNull();
    }
  );

  it('keeps Copy link available when only WhatsApp readiness is blocked', async () => {
    whatsappConnected = false;
    templateReady = false;
    renderActions();
    await resolveReadiness();
    fetchPaymentLink.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        link: {
          id: 'link-id',
          revision: 1,
          shortUrl: 'https://example.test/link',
          expiresAt: '2026-08-22T08:45:00.000Z',
          status: 'created',
        },
      }),
    });

    const copy = screen.getByRole('button', { name: 'Copy link' });
    expect(copy.getAttribute('aria-disabled')).toBeNull();
    await userEvent.click(copy);

    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        'https://example.test/link'
      )
    );
  });

  it('sends the Razorpay suffix as a dynamic URL-button parameter', async () => {
    renderActions();
    await resolveReadiness();
    fetchPaymentLink
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          link: {
            id: 'link-id',
            revision: 1,
            shortUrl: 'https://rzp.io/i/invoice-42',
            expiresAt: '2026-08-22T08:45:00.000Z',
            status: 'created',
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

    await userEvent.click(
      screen.getByRole('button', { name: 'Send payment link' })
    );

    await waitFor(() => expect(fetchPaymentLink).toHaveBeenCalledTimes(3));
    const sendRequest = fetchPaymentLink.mock.calls[2];
    expect(sendRequest[0]).toBe('/api/whatsapp/send');
    expect(JSON.parse(String(sendRequest[1]?.body))).toMatchObject({
      template_message_params: {
        body: ['Member', '₹50', '#INVOICE', '2026-08-22T08:45:00.000Z'],
        buttonParams: { 0: 'i/invoice-42' },
      },
    });
  });
});
