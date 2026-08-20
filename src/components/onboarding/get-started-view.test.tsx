// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { GetStartedView } from './get-started-view';

vi.mock('next/navigation', () => ({
  usePathname: () => '/get-started',
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    profileLoading: false,
    canEditSettings: true,
    account: { onboarding_dismissed_at: '2026-08-13T00:00:00.000Z' },
  }),
}));

vi.mock('@/hooks/use-onboarding-status', () => ({
  useOnboardingStatus: () => ({
    active: false,
    loading: false,
    steps: [],
    completedCount: 0,
    total: 7,
    allDone: false,
    recommended: null,
    refresh: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

afterEach(cleanup);

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
});
