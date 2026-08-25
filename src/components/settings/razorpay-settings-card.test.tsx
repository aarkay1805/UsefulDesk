// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    accountId: 'account-id',
    accountRole: 'owner',
    profileLoading: false,
  }),
}));

vi.mock('@/hooks/use-locale', () => ({
  useLocale: () => ({
    locale: { currency: 'INR' },
    fmt: { dateTime: (value: string) => value },
  }),
}));

const disconnectedConnection = {
  authenticationMode: 'oauth',
  connectionStatus: 'disconnected',
  merchantStatus: 'unknown',
  providerMode: 'live',
  merchantAccountSuffix: null,
  configured: false,
  connectedAt: '2026-08-20T18:46:27.988Z',
  disconnectedAt: '2026-08-25T18:11:15.257Z',
  activationVerifiedAt: null,
  lastVerifiedAt: '2026-08-25T18:11:15.257Z',
  lastError: null,
  oauthEnabled: true,
};

const connectionResponse = {
  connection: disconnectedConnection,
  health: {
    failedEventCount: 0,
    missingLedgerCount: 0,
    unappliedChargeCount: 0,
    setupExceptionCount: 0,
    paymentLinkExceptionCount: 0,
    paymentLinkSetupExceptionCount: 0,
    latestPaymentLinkReason: null,
    unappliedCharges: [],
  },
};

const { RazorpaySettingsCard } = await import('./razorpay-settings-card');

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('RazorpaySettingsCard', () => {
  it('shows only the reconnect path after OAuth credentials were disconnected', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => connectionResponse,
      })
    );

    render(<RazorpaySettingsCard />);

    expect(
      await screen.findByRole('button', { name: 'Reconnect Razorpay' })
    ).toBeTruthy();
    expect(screen.queryByText('Readiness verified')).toBeNull();
    expect(screen.queryByText('Merchant identity unavailable')).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Verify connection' })
    ).toBeNull();
    expect(screen.queryByRole('button', { name: 'Disconnect' })).toBeNull();
  });
});
