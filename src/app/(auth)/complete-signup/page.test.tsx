import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  getContext: vi.fn(),
  redirect: vi.fn((path: string): never => {
    throw new Error(`redirect:${path}`);
  }),
}));

vi.mock('next/navigation', () => ({ redirect: h.redirect }));
vi.mock('@/lib/auth/dashboard-request-context', () => ({
  getDashboardAuthRequestContext: h.getContext,
}));
vi.mock('@/components/auth/complete-signup-form', () => ({
  CompleteSignupForm: (props: Record<string, unknown>) => ({
    type: 'complete-signup-form',
    props,
  }),
}));
vi.mock('@/components/auth/complete-signup-access-error', () => ({
  CompleteSignupAccessError: (props: Record<string, unknown>) => ({
    type: 'complete-signup-access-error',
    props,
  }),
}));

const { default: CompleteSignupPage } = await import('./page');

const ACCOUNT_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ACCOUNT_ID = '22222222-2222-4222-8222-222222222222';

function bootstrap(
  state: 'complete' | 'pending' | 'unavailable' = 'pending',
  options: { role?: 'owner' | 'admin'; organizationOwner?: boolean } = {}
) {
  return {
    profile: { account_id: ACCOUNT_ID, account_role: options.role ?? 'owner' },
    account: { id: ACCOUNT_ID },
    branches: [
      {
        account_id: ACCOUNT_ID,
        role: options.role ?? 'owner',
        is_organization_owner: options.organizationOwner ?? true,
      },
    ],
    branchAccessError:
      state === 'unavailable'
        ? 'Could not verify your gym setup. Please retry.'
        : null,
    accountStatusDetail: null,
    organizationNameSetupState: state,
    branchAccessStatus: 'ready',
  };
}

function render(branch?: string | string[]) {
  return CompleteSignupPage({
    searchParams: Promise.resolve(branch === undefined ? {} : { branch }),
  });
}

describe('/complete-signup server page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.getContext.mockResolvedValue({
      user: { id: 'user-1' },
      bootstrap: bootstrap(),
    });
  });

  it('redirects unauthenticated users to login', async () => {
    const { UnauthorizedError } = await import('@/lib/auth/account');
    h.getContext.mockRejectedValue(new UnauthorizedError());

    await expect(render(ACCOUNT_ID)).rejects.toThrow('redirect:/login');
  });

  it('canonicalizes a bare URL to the validated default branch', async () => {
    await expect(render()).rejects.toThrow(
      `redirect:/complete-signup?branch=${ACCOUNT_ID}`
    );
  });

  it.each([['invalid'], [[ACCOUNT_ID, OTHER_ACCOUNT_ID]]])(
    'fails closed for a malformed explicit selection',
    async (branch) => {
      const result = await render(branch);

      expect(result.props).toMatchObject({
        message: 'This branch link is invalid.',
      });
      expect(h.redirect).not.toHaveBeenCalled();
    }
  );

  it('does not fall back when an explicit branch is unauthorized', async () => {
    h.getContext.mockResolvedValue({
      user: { id: 'user-1' },
      bootstrap: {
        ...bootstrap(),
        account: null,
        branches: [],
        branchAccessError: 'You do not have access to this branch.',
        branchAccessStatus: 'forbidden',
      },
    });

    const result = await render(OTHER_ACCOUNT_ID);

    expect(result.props).toMatchObject({
      message: 'You do not have access to this branch.',
      retryHref: undefined,
    });
  });

  it('redirects an already-complete selected branch to its dashboard', async () => {
    h.getContext.mockResolvedValue({
      user: { id: 'user-1' },
      bootstrap: bootstrap('complete'),
    });

    await expect(render(ACCOUNT_ID)).rejects.toThrow(
      `redirect:/dashboard?branch=${ACCOUNT_ID}`
    );
  });

  it('renders the form only for a pending organization and branch owner', async () => {
    const result = await render(ACCOUNT_ID);

    const card = result.props.children;
    const content = card.props.children[1];
    expect(content.props.children.props).toEqual({ accountId: ACCOUNT_ID });
  });

  it('blocks pending setup for a caller without both owner relationships', async () => {
    h.getContext.mockResolvedValue({
      user: { id: 'user-1' },
      bootstrap: bootstrap('pending', {
        role: 'admin',
        organizationOwner: true,
      }),
    });

    const result = await render(ACCOUNT_ID);

    expect(result.props.message).toMatch(/organization's owner/);
  });

  it('renders a same-branch retry when completion state is unavailable', async () => {
    h.getContext.mockResolvedValue({
      user: { id: 'user-1' },
      bootstrap: bootstrap('unavailable'),
    });

    const result = await render(ACCOUNT_ID);

    expect(result.props).toMatchObject({
      retryHref: `/complete-signup?branch=${ACCOUNT_ID}`,
    });
  });

  it('makes an explicit branch lookup failure retryable without falling back', async () => {
    h.getContext.mockResolvedValue({
      user: { id: 'user-1' },
      bootstrap: {
        ...bootstrap('unavailable'),
        account: null,
        branchAccessError: 'Could not load your branch access.',
        branchAccessStatus: 'unavailable',
      },
    });

    const result = await render(ACCOUNT_ID);

    expect(result.props).toMatchObject({
      retryHref: `/complete-signup?branch=${ACCOUNT_ID}`,
    });
  });
});
