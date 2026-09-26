import { beforeEach, describe, expect, it, vi } from 'vitest';

const authState = vi.hoisted(() => ({
  user: null as { id: string } | null,
  getContext: vi.fn(),
}));

const redirectMock = vi.hoisted(() =>
  vi.fn((path: string): never => {
    throw new Error(`redirect:${path}`);
  })
);

vi.mock('next/navigation', () => ({
  redirect: redirectMock,
}));

vi.mock('./dashboard-shell', () => ({
  DashboardShell: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('@/components/auth/complete-signup-access-error', () => ({
  CompleteSignupAccessError: (props: Record<string, unknown>) => ({
    type: 'complete-signup-access-error',
    props,
  }),
}));

vi.mock('@/lib/auth/dashboard-request-context', () => ({
  getDashboardRequestContext: authState.getContext,
}));

const { default: DashboardLayout } = await import('./layout');

describe('dashboard server layout authentication backstop', () => {
  beforeEach(() => {
    authState.user = null;
    authState.getContext.mockReset();
  });

  it('redirects an anonymous request before rendering dashboard content', async () => {
    const { UnauthorizedError } = await import('@/lib/auth/account');
    authState.getContext.mockRejectedValue(new UnauthorizedError());
    await expect(
      DashboardLayout({ children: 'protected content' })
    ).rejects.toThrow('redirect:/login');
    expect(redirectMock).toHaveBeenCalledWith('/login');
  });

  it('renders dashboard content for a server-validated user', async () => {
    authState.user = { id: 'user-1' };
    const initialBootstrap = {
      profile: null,
      account: null,
      branches: [],
      branchAccessError: null,
      accountStatusDetail: null,
      organizationNameSetupState: 'complete',
      branchAccessStatus: 'ready',
    };
    authState.getContext.mockResolvedValue({
      user: authState.user,
      bootstrap: initialBootstrap,
      account: null,
    });

    const result = await DashboardLayout({ children: 'protected content' });

    expect(result.props.children).toBe('protected content');
    expect(result.props.initialUser).toEqual({ id: 'user-1' });
    expect(result.props.initialBootstrap).toBe(initialBootstrap);
    expect(result.props.initialProductAccess).toBeNull();
    expect(authState.getContext).toHaveBeenCalledOnce();
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it('passes a validated account access snapshot to the client shell', async () => {
    const productAccess = { allowed: true };
    authState.getContext.mockResolvedValue({
      user: { id: 'user-1' },
      bootstrap: {
        profile: null,
        account: null,
        branches: [],
        branchAccessError: null,
        accountStatusDetail: null,
        organizationNameSetupState: 'complete',
        branchAccessStatus: 'ready',
      },
      account: {
        accountId: 'branch-1',
        account: { organizationId: 'org-1' },
        productAccess,
      },
    });

    const result = await DashboardLayout({ children: 'protected content' });

    expect(result.props.initialProductAccess).toEqual({
      accountId: 'branch-1',
      organizationId: 'org-1',
      snapshot: productAccess,
    });
  });

  it('redirects a pending selected organization before rendering the shell', async () => {
    authState.getContext.mockResolvedValue({
      user: { id: 'user-1' },
      bootstrap: {
        profile: { account_id: 'branch-1' },
        account: { id: 'branch-1' },
        branches: [],
        branchAccessError: null,
        accountStatusDetail: null,
        organizationNameSetupState: 'pending',
        branchAccessStatus: 'ready',
      },
      account: null,
    });

    await expect(
      DashboardLayout({ children: 'protected content' })
    ).rejects.toThrow('redirect:/complete-signup?branch=branch-1');
    expect(redirectMock).toHaveBeenCalledWith(
      '/complete-signup?branch=branch-1'
    );
  });

  it('renders a full-route retry before the shell when setup state is unavailable', async () => {
    authState.getContext.mockResolvedValue({
      user: { id: 'user-1' },
      bootstrap: {
        profile: { account_id: 'branch-1' },
        account: null,
        branches: [],
        branchAccessError: 'We could not check your gym setup. Try again.',
        accountStatusDetail: 'missing completion state',
        organizationNameSetupState: 'unavailable',
        branchAccessStatus: 'ready',
      },
      account: null,
    });

    const result = await DashboardLayout({ children: 'protected content' });

    expect(result.props).toMatchObject({ retryCurrent: true });
  });

  it('offers an accessible branch when the requested selection is forbidden', async () => {
    authState.getContext.mockResolvedValue({
      user: { id: 'user-1' },
      bootstrap: {
        profile: { account_id: null },
        account: null,
        branches: [
          {
            account_id: 'branch-2',
            account_name: 'Accessible Gym',
            branch_status: 'active',
          },
        ],
        branchAccessError: 'You do not have access to this branch.',
        accountStatusDetail: 'not in memberships',
        organizationNameSetupState: 'unavailable',
        branchAccessStatus: 'forbidden',
      },
      account: null,
    });

    const result = await DashboardLayout({ children: 'protected content' });

    expect(result.props).toMatchObject({
      message: 'You do not have access to this branch.',
      retryHref: '/dashboard?branch=branch-2',
      retryCurrent: false,
      actionLabel: 'Open Accessible Gym',
    });
  });
});
