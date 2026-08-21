// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GetStartedView } from './get-started-view';

const ACCOUNT_ID = '00000000-0000-4000-8000-000000000001';

const viewState = vi.hoisted(() => ({
  accountId: null as string | null,
  dismissedAt: '2026-08-13T00:00:00.000Z' as string | null,
  onboarding: {
    active: false,
    loading: false,
    steps: [] as Array<{
      id: 'whatsapp';
      title: string;
      subtitle: string;
      href: string;
      group: 'messaging';
      done: boolean;
    }>,
    completedCount: 0,
    total: 7,
    allDone: false,
    recommended: null as null | {
      id: 'whatsapp';
      title: string;
      subtitle: string;
      href: string;
      group: 'messaging';
      done: boolean;
    },
    refresh: vi.fn(),
    dismiss: vi.fn(),
  },
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/get-started',
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    profileLoading: false,
    canEditSettings: true,
    accountId: viewState.accountId,
    account: { onboarding_dismissed_at: viewState.dismissedAt },
  }),
}));

vi.mock('@/hooks/use-onboarding-status', () => ({
  useOnboardingStatus: () => viewState.onboarding,
}));

afterEach(cleanup);

beforeEach(() => {
  viewState.accountId = null;
  viewState.dismissedAt = '2026-08-13T00:00:00.000Z';
  viewState.onboarding.steps = [];
  viewState.onboarding.completedCount = 0;
  viewState.onboarding.total = 7;
  viewState.onboarding.allDone = false;
  viewState.onboarding.recommended = null;
});

describe('GetStartedView dismissed state', () => {
  it('uses integration-safe seven-step copy without a readiness gate', () => {
    render(<GetStartedView />);

    expect(screen.getByText('Core checklist complete')).toBeTruthy();
    expect(
      screen.getByText(/The seven-step checklist is complete/)
    ).toBeTruthy();
    expect(
      screen.getByText(
        /integrations separately before relying on them operationally/
      )
    ).toBeTruthy();
    expect(screen.queryByText(/payments are ready to run/)).toBeNull();
  });

  it('keeps the selected branch in the dismissed dashboard handoff', () => {
    viewState.accountId = ACCOUNT_ID;

    render(<GetStartedView />);

    expect(
      screen
        .getByRole('button', { name: 'Go to dashboard' })
        .getAttribute('href')
    ).toBe('/dashboard?branch=00000000-0000-4000-8000-000000000001');
  });

  it('keeps the selected branch in setup links and pending navigation', () => {
    const whatsappStep = {
      id: 'whatsapp' as const,
      title: 'Connect WhatsApp',
      subtitle: 'Link your WhatsApp Business number',
      href: '/settings?tab=whatsapp',
      group: 'messaging' as const,
      done: false,
    };
    viewState.accountId = ACCOUNT_ID;
    viewState.dismissedAt = null;
    viewState.onboarding.steps = [whatsappStep];
    viewState.onboarding.total = 1;
    viewState.onboarding.recommended = whatsappStep;

    render(<GetStartedView />);

    const expectedHref =
      '/settings?tab=whatsapp&branch=00000000-0000-4000-8000-000000000001';
    expect(
      screen
        .getByRole('link', {
          name: /Connect WhatsApp.*Link your WhatsApp Business number/,
        })
        .getAttribute('href')
    ).toBe(expectedHref);

    const setup = screen.getByRole('button', { name: 'Set up' });
    expect(setup.getAttribute('href')).toBe(expectedHref);

    setup.addEventListener('click', (event) => event.preventDefault());
    fireEvent.click(setup);

    expect(setup.getAttribute('aria-busy')).toBe('true');
  });
});
