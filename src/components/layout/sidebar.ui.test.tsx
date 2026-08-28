// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import type { AnchorHTMLAttributes } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  usePathname: () => '/settings',
}));

vi.mock('next/link', () => ({
  default: (
    props: AnchorHTMLAttributes<HTMLAnchorElement> & { prefetch?: boolean }
  ) => {
    const anchorProps = { ...props };
    delete anchorProps.prefetch;
    return <a {...anchorProps} />;
  },
  useLinkStatus: () => ({ pending: true }),
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    profile: { full_name: 'Rajat Kashyap', email: 'rajat@example.com' },
    profileLoading: false,
    account: { id: 'branch-1', name: 'Rajat Kashyap' },
    accountId: 'branch-1',
    accountRole: 'owner',
    signOut: vi.fn(),
  }),
}));

vi.mock('@/hooks/use-onboarding-status', () => ({
  useOnboardingStatus: () => ({
    active: false,
    allDone: true,
    loading: false,
    completedCount: 6,
    total: 6,
  }),
}));

vi.mock('@/hooks/use-total-unread', () => ({
  useTotalUnread: () => 0,
}));

vi.mock('@/hooks/use-unread-notifications', () => ({
  useUnreadNotifications: () => 0,
}));

vi.mock('@/hooks/use-local-storage', () => ({
  useLocalStorage: () => [true, vi.fn()],
}));

vi.mock('@/hooks/use-match-media', () => ({
  useMatchMedia: () => true,
}));

vi.mock('@/components/layout/branch-switcher', () => ({
  BranchSwitcher: () => null,
}));

vi.mock('@/components/layout/mode-toggle', () => ({
  ModeToggle: () => null,
}));

const { Sidebar } = await import('./sidebar');

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Sidebar navigation spacing', () => {
  it('uses eight-pixel outer padding and group spacing', () => {
    render(<Sidebar />);

    const navigation = screen.getByRole('navigation');
    expect(navigation.classList.contains('py-2')).toBe(true);
    expect(navigation.classList.contains('py-4')).toBe(false);

    const groupSeparators = screen.getAllByRole('separator');
    expect(groupSeparators).toHaveLength(2);
    for (const separator of groupSeparators) {
      expect(separator.classList.contains('my-2')).toBe(true);
      expect(separator.classList.contains('my-4')).toBe(false);
    }
  });

  it('shows immediate feedback while a destination is pending', () => {
    render(<Sidebar />);

    const membersLink = screen.getByRole('link', { name: /Members/ });
    expect(membersLink.querySelector('[data-pending="true"]')).not.toBeNull();
    expect(screen.getAllByText('Opening…').length).toBeGreaterThan(0);
  });
});
