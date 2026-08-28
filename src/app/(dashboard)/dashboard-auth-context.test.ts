import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  createClient: vi.fn(),
  getUser: vi.fn(),
  loadBootstrap: vi.fn(),
}));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    cache: <T extends (...args: never[]) => unknown>(loader: T) => {
      let result: ReturnType<T> | undefined;
      return ((...args: Parameters<T>) => {
        result ??= loader(...args) as ReturnType<T>;
        return result;
      }) as T;
    },
  };
});

vi.mock('next/headers', () => ({
  headers: async () =>
    new Headers([
      ['x-usefuldesk-account-id', '00000000-0000-4000-8000-000000000001'],
    ]),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: h.createClient,
}));

vi.mock('@/lib/auth/dashboard-bootstrap', () => ({
  loadDashboardAuthBootstrap: h.loadBootstrap,
}));

const { getDashboardRequestContext, requireDashboardAccountContext } =
  await import('@/lib/auth/dashboard-request-context');

const bootstrap = {
  profile: {
    id: 'profile-1',
    full_name: 'Rajat',
    email: 'rajat@example.com',
    avatar_url: null,
    role: null,
    beta_features: [],
    account_id: '00000000-0000-4000-8000-000000000001',
    account_role: 'owner',
    appearance_theme: null,
    appearance_mode: null,
  },
  account: {
    id: '00000000-0000-4000-8000-000000000001',
    name: 'Useful Gym',
    created_at: '2026-01-01T00:00:00.000Z',
    default_currency: 'INR',
    country_code: 'IN',
    locale: 'en-IN',
    timezone: 'Asia/Kolkata',
    date_order: 'DMY',
    time_format: '12h',
    week_start: 1,
    phone_country_code: '+91',
    measurement_system: 'metric',
    onboarding_dismissed_at: null,
    organization_id: 'organization-1',
    legal_entity_id: 'entity-1',
    branch_status: 'active',
    readiness_state: 'ready',
    setup_reviewed_at: null,
    setup_reviewed_by: null,
  },
  branches: [],
  branchAccessError: null,
  accountStatusDetail: null,
};

describe('dashboard request context', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.getUser.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    });
    h.loadBootstrap.mockResolvedValue(bootstrap);
    h.createClient
      .mockResolvedValueOnce({ auth: { getUser: h.getUser } })
      .mockResolvedValueOnce({ marker: 'selected-branch-client' });
  });

  it('memoizes one authenticated bootstrap for layout and page consumers', async () => {
    const [layoutContext, pageContext] = await Promise.all([
      getDashboardRequestContext(),
      getDashboardRequestContext(),
    ]);

    expect(layoutContext).toBe(pageContext);
    expect(h.getUser).toHaveBeenCalledOnce();
    expect(h.loadBootstrap).toHaveBeenCalledOnce();
    expect(h.createClient).toHaveBeenCalledTimes(2);
    expect(h.createClient).toHaveBeenLastCalledWith(bootstrap.account.id);
    expect(requireDashboardAccountContext(pageContext)).toMatchObject({
      accountId: bootstrap.account.id,
      role: 'owner',
      dateContext: {
        timeZone: 'Asia/Kolkata',
      },
    });
  });

  it('fails closed when the selected branch bootstrap is unavailable', async () => {
    const inaccessibleBootstrap = {
      ...bootstrap,
      profile: { ...bootstrap.profile, account_id: null, account_role: null },
      account: null,
      branchAccessError: 'You do not have access to this branch.',
    };

    expect(() =>
      requireDashboardAccountContext({
        user: { id: 'user-1' } as never,
        bootstrap: inaccessibleBootstrap as never,
        account: null,
      })
    ).toThrow('Could not load selected branch context');
  });
});
