import type { Session } from '@supabase/supabase-js';
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';

import type { ReadyAuthContextValue } from '../auth/auth-context';
import type { AccountSummary, BranchAccount } from '../auth/branch-types';
import { AccountScreen } from './account-screen';

const mockUseRouter = jest.fn();
const mockUseReadyAuth = jest.fn();

jest.mock('expo-router', () => ({ useRouter: () => mockUseRouter() }));
jest.mock('../auth/auth-context', () => ({
  useReadyAuth: () => mockUseReadyAuth(),
}));

jest.mock('heroui-native', () => {
  const React = jest.requireActual('react') as typeof import('react');
  const { Pressable, Text } = jest.requireActual(
    'react-native'
  ) as typeof import('react-native');

  function MockButton({
    isDisabled,
    ...props
  }: import('react-native').PressableProps & { isDisabled?: boolean }) {
    return React.createElement(Pressable, {
      ...props,
      accessibilityRole: props.accessibilityRole ?? 'button',
      disabled: isDisabled,
    });
  }
  MockButton.Label = function MockButtonLabel({
    children,
  }: import('react').PropsWithChildren) {
    return React.createElement(Text, null, children);
  };

  return { Button: MockButton };
});

const BRANCH_ID = 'd3648c54-a4aa-4dd8-8566-1e3b38c1f497';
const OTHER_BRANCH_ID = 'ab92ad08-3808-4a3e-8d50-7a5fa2a6a770';

function branch(accountId: string, name: string): BranchAccount {
  return {
    account_id: accountId,
    account_name: name,
    organization_id: '405ea376-0d27-4898-b198-0edb2a87ff38',
    organization_name: 'Useful Fitness',
    legal_entity_id: '895fd4ad-7219-4982-b8e4-a0c84f83e8d4',
    legal_entity_name: 'Useful Fitness Private Limited',
    role: 'admin',
    branch_status: 'active',
    readiness_state: 'ready',
    default_currency: 'INR',
    timezone: 'Asia/Kolkata',
    is_organization_owner: false,
    setup_reviewed_at: null,
    setup_reviewed_by: null,
  };
}

const twoBranches = [
  branch(BRANCH_ID, 'Indiranagar'),
  branch(OTHER_BRANCH_ID, 'Koramangala'),
];

function accountSummary(): AccountSummary {
  return {
    id: BRANCH_ID,
    name: 'Indiranagar',
    created_at: '2026-08-01T10:00:00.000Z',
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
    organization_id: '405ea376-0d27-4898-b198-0edb2a87ff38',
    legal_entity_id: '895fd4ad-7219-4982-b8e4-a0c84f83e8d4',
    branch_status: 'active',
    readiness_state: 'ready',
    setup_reviewed_at: null,
    setup_reviewed_by: null,
  };
}

function readyAuthValue(options: {
  selectBranch: (accountId: string) => Promise<void>;
  branches: BranchAccount[];
}): ReadyAuthContextValue {
  return {
    state: {
      status: 'ready',
      session: {} as Session,
      profile: {
        id: 'cfaef847-2572-4c92-852e-b62c09eecae4',
        full_name: 'Test Agent',
        email: 'agent@example.test',
        avatar_url: null,
        role: null,
        beta_features: [],
        account_id: BRANCH_ID,
        account_role: 'admin',
      },
      branches: options.branches,
      branch: options.branches[0],
      account: accountSummary(),
    },
    signInWithPassword: jest.fn(),
    signInWithGoogle: jest.fn(),
    signOut: jest.fn(),
    selectBranch: options.selectBranch,
  };
}

describe('AccountScreen branch navigation', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns to a clean Inbox after a successful branch switch', async () => {
    const accountRouter = { replace: jest.fn() };
    const mockSelectBranch = jest.fn().mockResolvedValue(undefined);
    mockUseRouter.mockReturnValue(accountRouter);
    mockUseReadyAuth.mockReturnValue(
      readyAuthValue({ selectBranch: mockSelectBranch, branches: twoBranches })
    );

    render(<AccountScreen />);
    fireEvent.press(
      screen.getByRole('button', { name: 'Choose Koramangala branch' })
    );

    await waitFor(() =>
      expect(mockSelectBranch).toHaveBeenCalledWith(OTHER_BRANCH_ID)
    );
    expect(accountRouter.replace).toHaveBeenCalledWith('/(app)');
  });

  it('stays on Account when the branch transition fails', async () => {
    const accountRouter = { replace: jest.fn() };
    const mockSelectBranch = jest.fn().mockRejectedValue(new Error('offline'));
    mockUseRouter.mockReturnValue(accountRouter);
    mockUseReadyAuth.mockReturnValue(
      readyAuthValue({ selectBranch: mockSelectBranch, branches: twoBranches })
    );

    render(<AccountScreen />);
    fireEvent.press(
      screen.getByRole('button', { name: 'Choose Koramangala branch' })
    );

    expect(
      await screen.findByText(
        'Could not open this branch. Check your connection and try again.'
      )
    ).toBeTruthy();
    expect(accountRouter.replace).not.toHaveBeenCalled();
  });
});
