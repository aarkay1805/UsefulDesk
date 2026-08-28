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
    expect(authState.getContext).toHaveBeenCalledOnce();
    expect(redirectMock).not.toHaveBeenCalled();
  });
});
