import { useEffect } from 'react';
import { AppState, Text, type AppStateStatus } from 'react-native';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import type { ReadyAuthContextValue } from '../auth/auth-context';
import { ProductAccessGate } from './product-access-gate';
import { type ProductAccessSnapshot } from './product-access-service';

const mockAuth = jest.fn();
const mockLoad = jest.fn();
const mockSupport = jest.fn();
jest.mock('../auth/auth-context', () => ({ useReadyAuth: () => mockAuth() }));
jest.mock('./product-access-service', () => ({
  ...jest.requireActual('./product-access-service'),
  loadProductAccess: (...args: unknown[]) => mockLoad(...args),
  requestProductSupport: (...args: unknown[]) => mockSupport(...args),
}));
jest.mock('../../data/supabase', () => ({ mobileSupabase: {} }));
jest.mock('../../core/account-formatters', () => ({
  accountFormatters: () => ({ number: String, dateTime: String }),
}));
jest.mock('../auth/screens/select-branch-screen', () => ({
  BranchChoices: ({ onSelect }: { onSelect: (id: string) => void }) => {
    const { Button } = jest.requireActual('react-native');
    return <Button title="Switch branch" onPress={() => onSelect('b')} />;
  },
}));
jest.mock('../../ui', () => {
  const { View, Text, Pressable } = jest.requireActual('react-native');
  return {
    Text,
    ScreenSafeAreaView: View,
    Notice: ({
      title,
      children,
      action,
    }: import('react').PropsWithChildren<{
      title?: string;
      action?: import('react').ReactNode;
    }>) => (
      <View>
        <Text>{title}</Text>
        <Text>{children}</Text>
        {action}
      </View>
    ),
    Button: ({
      children,
      onPress,
      disabled,
    }: import('react').PropsWithChildren<{
      onPress: () => void;
      disabled?: boolean;
    }>) => (
      <Pressable
        accessibilityRole="button"
        onPress={onPress}
        disabled={disabled}
      >
        <Text>{children}</Text>
      </Pressable>
    ),
  };
});
function snapshot(
  overrides: Partial<ProductAccessSnapshot> = {}
): ProductAccessSnapshot {
  return {
    access: {
      organization_id: 'org',
      mode: 'trial',
      trial_started_at: '2026-09-01T00:00:00Z',
      trial_ends_at: '2026-09-15T00:00:00Z',
      access_starts_at: null,
      access_ends_at: null,
      suspended_at: null,
      version: 1,
    },
    status: 'trial',
    allowed: true,
    enforcement_enabled: true,
    support_email: null,
    support_whatsapp: null,
    ...overrides,
  };
}
function auth(accountId = 'a') {
  return {
    state: {
      profile: { id: 'user' },
      branch: {
        account_id: accountId,
        organization_id: 'org',
        organization_name: 'Gym',
      },
      account: {},
      branches: [],
    },
    selectBranch: jest.fn(),
    signOut: jest.fn(),
  } as unknown as ReadyAuthContextValue;
}
let mounted: jest.Mock;
function OperationalChild() {
  useEffect(() => {
    mounted();
  }, []);
  return <Text>Inbox content</Text>;
}
function gate() {
  return (
    <ProductAccessGate>
      <OperationalChild />
    </ProductAccessGate>
  );
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-09-06T00:00:00Z'));
  mockLoad.mockReset();
  mockSupport.mockReset();
  mounted = jest.fn();
  mockAuth.mockReturnValue(auth());
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

it('never mounts operational children while unknown, expired or unavailable', async () => {
  mockLoad.mockResolvedValue(snapshot({ allowed: false, status: 'expired' }));
  render(gate());
  expect(mounted).not.toHaveBeenCalled();
  await screen.findByText(
    'Your organization’s UsefulDesk access has ended. Contact support to continue.'
  );
  expect(mounted).not.toHaveBeenCalled();
  mockLoad.mockRejectedValue(new Error('offline'));
  fireEvent.press(screen.getByText('Check access again'));
  await screen.findByText(
    'Could not verify access. Check your connection and try again.'
  );
  expect(mounted).not.toHaveBeenCalled();
});

it('unmounts at the exact expiry while refresh is pending', async () => {
  const value = snapshot();
  value.access.trial_ends_at = '2026-09-06T00:00:01Z';
  mockLoad
    .mockResolvedValueOnce(value)
    .mockImplementation(() => new Promise(() => {}));
  render(gate());
  await screen.findByText('Inbox content');
  act(() => {
    jest.advanceTimersByTime(1000);
  });
  expect(screen.queryByText('Inbox content')).toBeNull();
  expect(mockLoad).toHaveBeenCalledTimes(2);
});

it('refetches on foreground and fails closed while checking', async () => {
  let onFocus: ((state: AppStateStatus) => void) | undefined;
  jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((_event, handler) => {
      onFocus = handler;
      return { remove: jest.fn() };
    });
  mockLoad
    .mockResolvedValueOnce(snapshot())
    .mockImplementation(() => new Promise(() => {}));
  render(gate());
  await screen.findByText('Inbox content');
  act(() => onFocus?.('active'));
  expect(screen.queryByText('Inbox content')).toBeNull();
  expect(mockLoad).toHaveBeenCalledTimes(2);
});

it('discards an old branch response after switching', async () => {
  let resolveOld: ((value: ProductAccessSnapshot) => void) | undefined;
  mockLoad
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        })
    )
    .mockResolvedValueOnce(snapshot({ status: 'suspended', allowed: false }));
  const rendered = render(gate());
  mockAuth.mockReturnValue(auth('b'));
  rendered.rerender(gate());
  await screen.findByText(
    'Your organization’s access is suspended. Contact support to restore access.'
  );
  await act(async () => resolveOld?.(snapshot()));
  expect(mounted).not.toHaveBeenCalled();
});

it('retains support fallback, branch switching and signout while blocked', async () => {
  mockLoad.mockResolvedValue(snapshot({ allowed: false, status: 'expired' }));
  mockSupport.mockResolvedValue('request-id');
  render(gate());
  await screen.findByText(
    'Your organization’s UsefulDesk access has ended. Contact support to continue.'
  );
  fireEvent.press(screen.getByRole('button', { name: 'Contact support' }));
  await screen.findByText(
    'Support request received. Our team will contact your organization.'
  );
  expect(mockSupport).toHaveBeenCalledWith('a');
  fireEvent.press(screen.getByText('Switch branch'));
  expect(mockAuth().selectBranch).toHaveBeenCalledWith('b');
  fireEvent.press(screen.getByText('Sign out'));
  await waitFor(() => expect(mockAuth().signOut).toHaveBeenCalled());
});

it('restores operational children after support extends access', async () => {
  mockLoad
    .mockResolvedValueOnce(snapshot({ allowed: false, status: 'expired' }))
    .mockResolvedValueOnce(snapshot());
  render(gate());
  await screen.findByText(
    'Your organization’s UsefulDesk access has ended. Contact support to continue.'
  );
  expect(mounted).not.toHaveBeenCalled();
  fireEvent.press(screen.getByText('Check access again'));
  await screen.findByText('Inbox content');
  expect(mounted).toHaveBeenCalledTimes(1);
});
