// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Membership } from '@/types';

const fetchPaymentLink = vi.hoisted(() => vi.fn());

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    accountId: 'account-id',
    accountRole: 'owner',
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
              ? { data: { status: 'connected' }, error: null }
              : {
                  data: { language: 'en_US', status: 'APPROVED' },
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

beforeEach(() => {
  fetchPaymentLink.mockReset().mockImplementation(
    () =>
      new Promise((resolve) => {
        resolvePaymentLink = resolve;
      })
  );
  vi.stubGlobal('fetch', fetchPaymentLink);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  resolvePaymentLink = null;
});

describe('PaymentLinkActions readiness', () => {
  it('shows busy spinners until payment-link readiness resolves', async () => {
    render(
      <PaymentLinkActions
        invoice={{ id: 'invoice-id', reference: '#INVOICE', balance: 50 }}
        member={member}
      />
    );

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

    await waitFor(() => expect(copy.hasAttribute('disabled')).toBe(false));
    expect(copy.getAttribute('aria-busy')).toBe('false');
    expect(copy.querySelector('.animate-spin')).toBeNull();
    expect(send.hasAttribute('disabled')).toBe(false);
    expect(send.getAttribute('aria-busy')).toBe('false');
    expect(send.querySelector('.animate-spin')).toBeNull();

    const status = screen.getByText('Payment link active');
    const expiry = screen.getByText('Expires 2026-08-22T08:45:00.000Z');
    expect(status.parentElement).toBe(expiry.parentElement);
    expect(status.parentElement?.classList.contains('flex-col')).toBe(true);
    expect(status.parentElement?.lastElementChild).toBe(expiry);
  });
});
