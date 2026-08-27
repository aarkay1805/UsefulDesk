import { beforeEach, describe, expect, it, vi } from 'vitest';

const authState = vi.hoisted(() => ({
  user: null as { id: string } | null,
  loadBootstrap: vi.fn(),
}));

const redirectMock = vi.hoisted(() =>
  vi.fn((path: string): never => {
    throw new Error(`redirect:${path}`);
  })
);

vi.mock('next/navigation', () => ({
  redirect: redirectMock,
}));

vi.mock('next/headers', () => ({
  headers: async () =>
    new Headers([
      ['x-usefuldesk-account-id', '00000000-0000-4000-8000-000000000001'],
    ]),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: authState.user } }),
    },
  }),
}));

vi.mock('./dashboard-shell', () => ({
  DashboardShell: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('@/lib/auth/dashboard-bootstrap', () => ({
  loadDashboardAuthBootstrap: authState.loadBootstrap,
}));

const { default: DashboardLayout } = await import('./layout');

describe('dashboard server layout authentication backstop', () => {
  beforeEach(() => {
    authState.user = null;
    authState.loadBootstrap.mockReset().mockResolvedValue({
      profile: null,
      account: null,
      branches: [],
      branchAccessError: null,
      accountStatusDetail: null,
    });
  });

  it('redirects an anonymous request before rendering dashboard content', async () => {
    await expect(
      DashboardLayout({ children: 'protected content' })
    ).rejects.toThrow('redirect:/login');
    expect(redirectMock).toHaveBeenCalledWith('/login');
  });

  it('renders dashboard content for a server-validated user', async () => {
    authState.user = { id: 'user-1' };

    const result = await DashboardLayout({ children: 'protected content' });

    expect(result.props.children).toBe('protected content');
    expect(result.props.initialUser).toEqual({ id: 'user-1' });
    expect(authState.loadBootstrap).toHaveBeenCalledWith(
      expect.any(Object),
      'user-1',
      '00000000-0000-4000-8000-000000000001'
    );
    expect(redirectMock).not.toHaveBeenCalled();
  });
});
