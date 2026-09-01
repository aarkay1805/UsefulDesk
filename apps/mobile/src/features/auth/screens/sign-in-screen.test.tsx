import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { AuthContextValue } from '../auth-context';
import { SignInScreen } from './sign-in-screen';

const mockUseAuth = jest.fn<AuthContextValue, []>();

jest.mock('../auth-context', () => ({
  useAuth: () => mockUseAuth(),
}));

jest.mock('heroui-native', () => {
  const React = jest.requireActual('react') as typeof import('react');
  const { Pressable, Text, TextInput, View } = jest.requireActual(
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

  return {
    Button: MockButton,
    TextField: ({ children }: import('react').PropsWithChildren) =>
      React.createElement(View, null, children),
    Label: ({ children }: import('react').PropsWithChildren) =>
      React.createElement(Text, null, children),
    Input: (props: import('react-native').TextInputProps) =>
      React.createElement(TextInput, props),
    FieldError: ({ children }: import('react').PropsWithChildren) =>
      React.createElement(Text, null, children),
  };
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}

function authValue(
  overrides: Partial<AuthContextValue> = {}
): AuthContextValue {
  return {
    state: { status: 'signed_out' },
    signInWithPassword: jest.fn().mockResolvedValue({ status: 'success' }),
    signInWithGoogle: jest.fn().mockResolvedValue({ status: 'success' }),
    signOut: jest.fn(),
    recoverUnauthorizedSession: jest.fn(),
    selectBranch: jest.fn(),
    ...overrides,
  };
}

describe('SignInScreen', () => {
  beforeEach(() => jest.clearAllMocks());

  it('exposes labelled native email and password fields without signup', () => {
    mockUseAuth.mockReturnValue(authValue());

    render(<SignInScreen />);

    expect(screen.getByLabelText('Email')).toHaveProp(
      'keyboardType',
      'email-address'
    );
    expect(screen.getByLabelText('Email')).toHaveProp('autoCapitalize', 'none');
    expect(screen.getByLabelText('Email')).toHaveProp('returnKeyType', 'done');
    expect(screen.getByLabelText('Password')).toHaveProp(
      'secureTextEntry',
      true
    );
    expect(screen.queryByText(/sign up|create account/i)).toBeNull();
  });

  it('fills the native screen when signed out', () => {
    mockUseAuth.mockReturnValue(authValue());

    const view = render(<SignInScreen />);
    const root = view.UNSAFE_getByType(SafeAreaView);

    expect(StyleSheet.flatten(root.props.style)).toMatchObject({ flex: 1 });
  });

  it('shows and hides the password from a visible labelled control', () => {
    mockUseAuth.mockReturnValue(authValue());
    render(<SignInScreen />);

    fireEvent.press(screen.getByRole('button', { name: 'Show password' }));

    expect(screen.getByLabelText('Password')).toHaveProp(
      'secureTextEntry',
      false
    );
    fireEvent.press(screen.getByRole('button', { name: 'Hide password' }));
    expect(screen.getByLabelText('Password')).toHaveProp(
      'secureTextEntry',
      true
    );
  });

  it('submits password credentials once while pending and retains input after an error', async () => {
    const pending = deferred<
      { status: 'success' } | { status: 'error'; message: string }
    >();
    const signInWithPassword = jest.fn(() => pending.promise);
    mockUseAuth.mockReturnValue(authValue({ signInWithPassword }));
    render(<SignInScreen />);

    fireEvent.changeText(screen.getByLabelText('Email'), 'asha@example.com');
    fireEvent.changeText(screen.getByLabelText('Password'), 'not-the-password');
    fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));
    fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));

    expect(signInWithPassword).toHaveBeenCalledTimes(1);
    expect(signInWithPassword).toHaveBeenCalledWith(
      'asha@example.com',
      'not-the-password'
    );
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeDisabled();

    pending.resolve({ status: 'error', message: 'Could not sign in.' });

    await waitFor(() =>
      expect(screen.getByText('Could not sign in.')).toBeTruthy()
    );
    expect(screen.getByLabelText('Email')).toHaveProp(
      'value',
      'asha@example.com'
    );
    expect(screen.getByLabelText('Password')).toHaveProp(
      'value',
      'not-the-password'
    );
  });

  it('starts Google sign-in from a visible labelled control', async () => {
    const signInWithGoogle = jest
      .fn()
      .mockResolvedValue({ status: 'cancelled' });
    mockUseAuth.mockReturnValue(authValue({ signInWithGoogle }));
    render(<SignInScreen />);

    fireEvent.press(
      screen.getByRole('button', { name: 'Continue with Google' })
    );

    await waitFor(() => expect(signInWithGoogle).toHaveBeenCalledTimes(1));
  });

  it('shows only secure sign-out remediation when cleanup is unverified', async () => {
    const signOut = jest.fn().mockResolvedValue(undefined);
    mockUseAuth.mockReturnValue(
      authValue({
        state: {
          status: 'cleanup_failed',
          error:
            'Secure sign-out is incomplete. Retry secure sign-out before signing in.',
        },
        signOut,
      })
    );

    render(<SignInScreen />);

    expect(
      screen.getByText(
        'Secure sign-out is incomplete. Retry secure sign-out before signing in.'
      )
    ).toBeTruthy();
    expect(screen.queryByLabelText('Email')).toBeNull();
    expect(screen.queryByLabelText('Password')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Sign in' })).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Continue with Google' })
    ).toBeNull();

    fireEvent.press(
      screen.getByRole('button', { name: 'Retry secure sign-out' })
    );
    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
  });

  it('does not expose sign-in actions while secure sign-out is pending', () => {
    mockUseAuth.mockReturnValue(
      authValue({ state: { status: 'signing_out' } })
    );

    render(<SignInScreen />);

    expect(screen.getByText('Signing out securely…')).toBeTruthy();
    expect(screen.queryByLabelText('Email')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Sign in' })).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Continue with Google' })
    ).toBeNull();
  });
});
