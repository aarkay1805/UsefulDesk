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

function renderActions(memberValue: Membership | null = member) {
  render(
    <PaymentLinkActions
      invoice={{ id: 'invoice-id', reference: '#INVOICE', balance: 50 }}
      member={memberValue}
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

describe('PaymentLinkActions readiness', () => {
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

    const status = screen.getByText('Payment link active');
    const expiry = screen.getByText('Expires 2026-08-22T08:45:00.000Z');
    expect(status.parentElement).toBe(expiry.parentElement);
    expect(status.parentElement?.classList.contains('flex-col')).toBe(true);
    expect(status.parentElement?.lastElementChild).toBe(expiry);
  });

  it('opens payment setup when Razorpay is not connected', async () => {
    accountRole = 'admin';
    renderActions();
    await resolveReadiness({
      providerReady: false,
      providerReason: "Razorpay isn't connected",
    });

    const copy = screen.getByRole('button', { name: 'Copy link' });
    expect(copy.getAttribute('aria-disabled')).toBe('true');
    await userEvent.click(copy);

    expect(screen.getByText("Razorpay isn't connected")).toBeTruthy();
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
      name: 'Open payment setup',
    });
    expect(resolution.tagName).toBe('A');
    expect(resolution.getAttribute('href')).toBe('/settings?tab=payments');
  });

  it('explains an unsupported provider state without an unsafe destination', async () => {
    renderActions();
    await resolveReadiness({
      providerReady: false,
      providerReason: 'Payment Link status is unavailable',
    });

    await userEvent.click(screen.getByRole('button', { name: 'Copy link' }));

    const blocker = screen.getByRole('dialog', {
      name: 'Payment link unavailable',
    });
    expect(
      within(blocker).getByText('Payment Link status is unavailable')
    ).toBeTruthy();
    expect(within(blocker).queryByRole('button')).toBeNull();
  });

  it('prioritizes permission over all send-readiness blockers', async () => {
    accountRole = 'viewer';
    whatsappConnected = false;
    templateReady = false;
    renderActions(null);
    await resolveReadiness({
      providerReady: false,
      providerReason: "Razorpay isn't connected",
    });

    const send = screen.getByRole('button', { name: 'Send payment link' });
    await userEvent.click(send);

    const blocker = screen.getByRole('dialog', {
      name: 'Admin access required',
    });
    expect(within(blocker).queryByRole('button')).toBeNull();
  });

  it('prioritizes a missing phone over provider and template readiness', async () => {
    whatsappConnected = false;
    templateReady = false;
    renderActions(null);
    await resolveReadiness({
      providerReady: false,
      providerReason: "Razorpay isn't connected",
    });

    await userEvent.click(
      screen.getByRole('button', { name: 'Send payment link' })
    );

    const blocker = screen.getByRole('dialog', {
      name: 'Phone number required',
    });
    expect(within(blocker).queryByRole('button')).toBeNull();
  });

  it('prioritizes provider readiness over WhatsApp readiness', async () => {
    whatsappConnected = false;
    templateReady = false;
    renderActions();
    await resolveReadiness({
      providerReady: false,
      providerReason: "Razorpay isn't connected",
    });

    await userEvent.click(
      screen.getByRole('button', { name: 'Send payment link' })
    );

    expect(
      screen.getByRole('dialog', { name: "Razorpay isn't connected" })
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
      name: 'Open template setup',
    });
    expect(resolution.tagName).toBe('A');
    expect(resolution.getAttribute('href')).toBe('/settings?tab=templates');
  });

  it('does not promise Razorpay setup to an agent', async () => {
    accountRole = 'agent';
    renderActions();
    await resolveReadiness({
      providerReady: false,
      providerReason: "Razorpay isn't connected",
    });

    await userEvent.click(screen.getByRole('button', { name: 'Copy link' }));

    const blocker = screen.getByRole('dialog', {
      name: "Razorpay isn't connected",
    });
    expect(within(blocker).queryByRole('button')).toBeNull();
    expect(within(blocker).queryByRole('link')).toBeNull();
  });

  it.each([
    [false, true, "WhatsApp isn't connected"],
    [true, false, "Payment link template isn't ready"],
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
      expect(within(blocker).queryByRole('button')).toBeNull();
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
});
