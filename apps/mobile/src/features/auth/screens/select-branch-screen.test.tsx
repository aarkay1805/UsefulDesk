import * as React from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';

import type { AuthContextValue } from '../auth-context';
import type { BranchAccount, MobileProfile } from '../branch-types';
import { BranchChoices, SelectBranchScreen } from './select-branch-screen';

jest.mock('react', () => {
  const actual = jest.requireActual<typeof import('react')>('react');
  return { ...actual, useState: jest.fn(actual.useState) };
});

const mockUseAuth = jest.fn<AuthContextValue, []>();

jest.mock('../auth-context', () => ({
  useAuth: () => mockUseAuth(),
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

const profile: MobileProfile = {
  id: '53f7dd9e-e2fd-4824-a773-a0ce541048ec',
  full_name: 'Asha Rao',
  email: 'asha@example.com',
  avatar_url: null,
  role: null,
  beta_features: [],
  account_id: null,
  account_role: null,
};

function branch(
  accountId: string,
  accountName: string,
  organizationName: string,
  branchStatus: BranchAccount['branch_status'] = 'active'
): BranchAccount {
  return {
    account_id: accountId,
    account_name: accountName,
    organization_id: '405ea376-0d27-4898-b198-0edb2a87ff38',
    organization_name: organizationName,
    legal_entity_id: '895fd4ad-7219-4982-b8e4-a0c84f83e8d4',
    legal_entity_name: `${organizationName} Private Limited`,
    role: 'admin',
    branch_status: branchStatus,
    readiness_state: 'ready',
    default_currency: 'INR',
    timezone: 'Asia/Kolkata',
    is_organization_owner: false,
    setup_reviewed_at: '2026-08-30T10:00:00.000Z',
    setup_reviewed_by: profile.id,
  };
}

const activeBranch = branch(
  'd3648c54-a4aa-4dd8-8566-1e3b38c1f497',
  'Indiranagar',
  'Useful Fitness'
);
const archivedBranch = branch(
  'f8b2a93d-bfa4-485a-8ab1-1b37862d6d72',
  'Old Airport Road',
  'Useful Fitness',
  'archived'
);

function authValue(
  overrides: Partial<AuthContextValue> = {}
): AuthContextValue {
  return {
    state: {
      status: 'choose_branch',
      profile,
      branches: [activeBranch, archivedBranch],
    },
    signInWithPassword: jest.fn(),
    signInWithGoogle: jest.fn(),
    signOut: jest.fn(),
    recoverUnauthorizedSession: jest.fn(),
    selectBranch: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

describe('SelectBranchScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    const actualUseState =
      jest.requireActual<typeof import('react')>('react').useState;
    (React.useState as jest.Mock).mockImplementation(actualUseState);
  });

  it('shows branch and organization names but omits archived selections', () => {
    mockUseAuth.mockReturnValue(authValue());

    render(<SelectBranchScreen />);

    expect(screen.getByText('Indiranagar')).toBeTruthy();
    expect(screen.getByText('Useful Fitness')).toBeTruthy();
    expect(screen.queryByText('Old Airport Road')).toBeNull();
    expect(
      screen.queryByRole('button', { name: /Old Airport Road/ })
    ).toBeNull();
  });

  it('selects a branch exactly once during repeated activation', async () => {
    const selectBranch = jest.fn().mockReturnValue(new Promise(() => {}));
    mockUseAuth.mockReturnValue(authValue({ selectBranch }));
    render(<SelectBranchScreen />);
    const choose = screen.getByRole('button', {
      name: 'Choose Indiranagar branch',
    });

    fireEvent.press(choose);
    fireEvent.press(choose);

    await waitFor(() => expect(selectBranch).toHaveBeenCalledTimes(1));
    expect(selectBranch).toHaveBeenCalledWith(activeBranch.account_id);
    expect(choose).toBeDisabled();
  });

  it('allows a new attempt after a resolved selection leaves the screen mounted', async () => {
    const selectBranch = jest.fn().mockResolvedValue(undefined);
    mockUseAuth.mockReturnValue(authValue({ selectBranch }));
    render(<SelectBranchScreen />);
    const choose = screen.getByRole('button', {
      name: 'Choose Indiranagar branch',
    });

    fireEvent.press(choose);
    fireEvent.press(choose);

    await waitFor(() => {
      expect(selectBranch).toHaveBeenCalledTimes(1);
      expect(choose).toBeEnabled();
    });

    fireEvent.press(choose);
    await waitFor(() => expect(selectBranch).toHaveBeenCalledTimes(2));
  });

  it('does not update BranchChoices state after a successful selection unmounts it', async () => {
    const originalUseState =
      jest.requireActual<typeof import('react')>('react').useState;
    const setters: jest.Mock[] = [];
    const useStateSpy = React.useState as jest.Mock;
    useStateSpy.mockImplementation((initialState: unknown) => {
      const [value, setValue] = originalUseState(initialState);
      const setter = jest.fn(setValue);
      setters.push(setter);
      return [value, setter];
    });
    const selection = deferred<void>();
    const onSelect = jest.fn(() => selection.promise);

    try {
      const rendered = render(
        <BranchChoices branches={[activeBranch]} onSelect={onSelect} />
      );
      fireEvent.press(
        screen.getByRole('button', {
          name: 'Choose Indiranagar branch',
        })
      );

      await waitFor(() => {
        expect(
          setters.some((setter) =>
            setter.mock.calls.some(
              ([value]) => value === activeBranch.account_id
            )
          )
        ).toBe(true);
      });
      setters.forEach((setter) => setter.mockClear());
      rendered.unmount();

      await act(async () => {
        selection.resolve();
        await selection.promise;
        await Promise.resolve();
      });

      setters.forEach((setter) => expect(setter).not.toHaveBeenCalled());
    } finally {
      useStateSpy.mockImplementation(originalUseState);
    }
  });

  it('does not update BranchChoices state after a failed selection unmounts it', async () => {
    const originalUseState =
      jest.requireActual<typeof import('react')>('react').useState;
    const setters: jest.Mock[] = [];
    const useStateSpy = React.useState as jest.Mock;
    useStateSpy.mockImplementation((initialState: unknown) => {
      const [value, setValue] = originalUseState(initialState);
      const setter = jest.fn(setValue);
      setters.push(setter);
      return [value, setter];
    });
    const selection = deferred<void>();
    const onSelect = jest.fn(() => selection.promise);

    try {
      const rendered = render(
        <BranchChoices branches={[activeBranch]} onSelect={onSelect} />
      );
      fireEvent.press(
        screen.getByRole('button', {
          name: 'Choose Indiranagar branch',
        })
      );

      await waitFor(() => {
        expect(
          setters.some((setter) =>
            setter.mock.calls.some(
              ([value]) => value === activeBranch.account_id
            )
          )
        ).toBe(true);
      });
      setters.forEach((setter) => setter.mockClear());
      rendered.unmount();

      await act(async () => {
        selection.reject(new Error('Branch selection failed'));
        await Promise.resolve();
      });

      setters.forEach((setter) => expect(setter).not.toHaveBeenCalled());
    } finally {
      useStateSpy.mockImplementation(originalUseState);
    }
  });

  it('shows a failed selection and allows a retry after the chooser unlocks', async () => {
    const selectBranch = jest
      .fn()
      .mockRejectedValueOnce(new Error('Branch selection failed'))
      .mockResolvedValueOnce(undefined);

    render(<BranchChoices branches={[activeBranch]} onSelect={selectBranch} />);
    const choose = screen.getByRole('button', {
      name: 'Choose Indiranagar branch',
    });

    fireEvent.press(choose);

    await waitFor(() => {
      expect(
        screen.getByText(
          'Could not open this branch. Check your connection and try again.'
        )
      ).toBeTruthy();
      expect(choose).toBeEnabled();
    });

    fireEvent.press(choose);

    await waitFor(() => {
      expect(selectBranch).toHaveBeenCalledTimes(2);
      expect(choose).toBeEnabled();
      expect(
        screen.queryByText(
          'Could not open this branch. Check your connection and try again.'
        )
      ).toBeNull();
    });
  });

  it('shows a blocking explanation and permits a safe branch retry', () => {
    mockUseAuth.mockReturnValue(
      authValue({
        state: {
          status: 'blocked',
          profile,
          branches: [activeBranch],
          reason: 'selected_branch_unavailable',
        },
      })
    );

    render(<SelectBranchScreen />);

    expect(
      screen.getByText(
        'Could not open this branch. Check your connection and try again.'
      )
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Choose Indiranagar branch' })
    ).toBeEnabled();
  });

  it('always exposes sign-out recovery for an unavailable profile even when branch rows exist', async () => {
    const signOut = jest.fn().mockResolvedValue(undefined);
    mockUseAuth.mockReturnValue(
      authValue({
        state: {
          status: 'blocked',
          profile: null,
          branches: [activeBranch],
          reason: 'profile_unavailable',
        },
        signOut,
      })
    );

    render(<SelectBranchScreen />);

    expect(
      screen.getByText('Could not load your profile. Sign out and try again.')
    ).toBeTruthy();
    fireEvent.press(
      screen.getByRole('button', { name: 'Sign out and try again' })
    );
    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
  });
});
