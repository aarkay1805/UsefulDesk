// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OnboardingRawStatus } from '@/lib/onboarding/steps';

const onboardingState = vi.hoisted(() => ({
  templateApproved: false,
  failRequest: false,
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/get-started',
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    accountId: '00000000-0000-4000-8000-000000000001',
    account: { onboarding_dismissed_at: null },
    profileLoading: false,
    canEditSettings: true,
    refreshProfile: vi.fn(),
  }),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: vi.fn(),
}));

const { OnboardingProvider, useOnboardingStatus } =
  await import('./use-onboarding-status');

function TemplateStepProbe() {
  const { loading, steps } = useOnboardingStatus();
  const template = steps.find((step) => step.id === 'template');
  return (
    <output data-testid="template-step">
      {loading ? 'loading' : String(template?.done)}
    </output>
  );
}

const baseStatus = (): OnboardingRawStatus => ({
  whatsappConnected: false,
  templateApproved: onboardingState.templateApproved,
  hasActivePlanPricing: false,
  membershipCount: 0,
  razorpayConnected: false,
  paidPaymentCount: 0,
  teamSize: 1,
  pendingInvites: 0,
});

describe('OnboardingProvider consolidated status request', () => {
  beforeEach(() => {
    onboardingState.templateApproved = false;
    onboardingState.failRequest = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url !== '/api/onboarding/status') {
          throw new Error(`Unexpected fetch: ${url}`);
        }
        if (onboardingState.failRequest) {
          return Response.json({ error: 'unavailable' }, { status: 503 });
        }
        return Response.json({ status: baseStatus() });
      })
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('keeps an incomplete server signal incomplete', async () => {
    render(
      <OnboardingProvider>
        <TemplateStepProbe />
      </OnboardingProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('template-step').textContent).toBe('false');
    });
  });

  it('uses the approved template signal returned by the consolidated endpoint', async () => {
    onboardingState.templateApproved = true;

    render(
      <OnboardingProvider>
        <TemplateStepProbe />
      </OnboardingProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('template-step').textContent).toBe('true');
    });
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith('/api/onboarding/status', {
      cache: 'no-store',
    });
  });

  it('fails closed when the consolidated endpoint is unavailable', async () => {
    onboardingState.templateApproved = true;
    onboardingState.failRequest = true;
    vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <OnboardingProvider>
        <TemplateStepProbe />
      </OnboardingProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('template-step').textContent).toBe('false');
    });
  });
});
