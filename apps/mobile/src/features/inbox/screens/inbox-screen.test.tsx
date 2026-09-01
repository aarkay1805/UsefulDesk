import { fireEvent, render, screen } from '@testing-library/react-native';

import type { ReadyAuthContextValue } from '../../auth/auth-context';
import type { AccountSummary, BranchAccount } from '../../auth/branch-types';
import type { InboxRealtimeFeed } from '../inbox-realtime-provider';
import { conversation, CONVERSATION_ID } from '../inbox-test-fixtures';
import type { UseConversationListResult } from '../use-conversation-list';
import { InboxScreen } from './inbox-screen';

const mockRouter = { push: jest.fn(), replace: jest.fn() };
const mockUseConversationList = jest.fn();
const mockUseReadyAuth = jest.fn<ReadyAuthContextValue, []>();
const screenRealtime: InboxRealtimeFeed = {
  getSnapshot: () => ({ connection: 'connected', resyncGeneration: 0 }),
  listen: () => () => undefined,
  listenStatus: () => () => undefined,
};

jest.mock('expo-router', () => ({
  Stack: {
    Screen: ({
      options,
    }: {
      options?: { headerRight?: () => import('react').ReactNode };
    }) => options?.headerRight?.() ?? null,
  },
  useRouter: () => mockRouter,
}));

jest.mock('../../auth/auth-context', () => ({
  useReadyAuth: () => mockUseReadyAuth(),
}));

jest.mock('../use-conversation-list', () => ({
  useConversationList: (...args: unknown[]) => mockUseConversationList(...args),
}));

jest.mock('../inbox-realtime-provider', () => ({
  useInboxRealtimeFeed: () => screenRealtime,
}));

jest.mock('heroui-native', () => {
  const React = jest.requireActual('react') as typeof import('react');
  const { Image, Pressable, Text, TextInput, View } = jest.requireActual(
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
    className,
  }: import('react').PropsWithChildren<{ className?: string }>) {
    return React.createElement(Text, { className }, children);
  };

  function MockChip(props: import('react-native').PressableProps) {
    return React.createElement(Pressable, props);
  }
  MockChip.Label = function MockChipLabel({
    children,
  }: import('react').PropsWithChildren) {
    return React.createElement(Text, null, children);
  };

  let searchOnChange: ((value: string) => void) | undefined;
  function MockSearchField({
    children,
    onChange,
  }: import('react').PropsWithChildren<{
    onChange?: (value: string) => void;
  }>) {
    searchOnChange = onChange;
    return React.createElement(View, null, children);
  }
  MockSearchField.Group = function MockSearchFieldGroup({
    children,
  }: import('react').PropsWithChildren) {
    return React.createElement(View, null, children);
  };
  MockSearchField.SearchIcon = function MockSearchFieldSearchIcon() {
    return null;
  };
  MockSearchField.Input = function MockSearchFieldInput(
    props: import('react-native').TextInputProps
  ) {
    return React.createElement(TextInput, {
      ...props,
      onChangeText: searchOnChange,
    });
  };
  MockSearchField.ClearButton = function MockSearchFieldClearButton({
    isDisabled,
    ...props
  }: import('react-native').PressableProps & { isDisabled?: boolean }) {
    return React.createElement(Pressable, {
      ...props,
      accessibilityRole: 'button',
      disabled: isDisabled,
      onPress: () => searchOnChange?.(''),
    });
  };

  function MockAvatar(props: import('react-native').ViewProps) {
    return React.createElement(View, props);
  }
  MockAvatar.Image = function MockAvatarImage(
    props: import('react-native').ImageProps
  ) {
    return React.createElement(Image, props);
  };
  MockAvatar.Fallback = function MockAvatarFallback({
    children,
  }: import('react').PropsWithChildren) {
    return React.createElement(Text, null, children);
  };

  function MockAlert(props: import('react-native').ViewProps) {
    return React.createElement(View, {
      ...props,
      accessible: true,
      accessibilityRole: 'alert',
    });
  }
  MockAlert.Indicator = function MockAlertIndicator() {
    return null;
  };
  MockAlert.Content = function MockAlertContent({
    children,
  }: import('react').PropsWithChildren) {
    return React.createElement(View, null, children);
  };
  MockAlert.Title = function MockAlertTitle({
    children,
  }: import('react').PropsWithChildren) {
    return React.createElement(Text, null, children);
  };
  MockAlert.Description = function MockAlertDescription({
    children,
  }: import('react').PropsWithChildren) {
    return React.createElement(Text, null, children);
  };

  function MockSpinner(props: import('react-native').ViewProps) {
    return React.createElement(View, props);
  }

  return {
    Alert: MockAlert,
    Avatar: MockAvatar,
    Button: MockButton,
    Chip: MockChip,
    SearchField: MockSearchField,
    Spinner: MockSpinner,
  };
});

const BRANCH_ID = 'd3648c54-a4aa-4dd8-8566-1e3b38c1f497';

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

function readyAuthValue(): ReadyAuthContextValue {
  const branch: BranchAccount = {
    account_id: BRANCH_ID,
    account_name: 'Indiranagar',
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

  return {
    state: {
      status: 'ready',
      session: {} as ReadyAuthContextValue['state']['session'],
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
      branches: [branch],
      branch,
      account: accountSummary(),
    },
    signInWithPassword: jest.fn(),
    signInWithGoogle: jest.fn(),
    signOut: jest.fn(),
    selectBranch: jest.fn(),
  };
}

function listResult(
  overrides: Partial<UseConversationListResult> = {}
): UseConversationListResult {
  return {
    items: [conversation({ unreadCount: 0 })],
    status: 'ready',
    error: null,
    refreshWarning: null,
    paginationError: null,
    connection: 'connected',
    filter: 'all',
    search: '',
    unreadCount: 3,
    refreshing: false,
    loadingMore: false,
    hasMore: false,
    setFilter: jest.fn(),
    setSearch: jest.fn(),
    refresh: jest.fn(),
    loadMore: jest.fn(),
    ...overrides,
  };
}

const emptyResult = () => listResult({ items: [] });
const errorResult = () =>
  listResult({
    items: [],
    status: 'error',
    error: 'Could not load conversations',
  });

describe('InboxScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseReadyAuth.mockReturnValue(readyAuthValue());
    mockUseConversationList.mockReturnValue(listResult());
  });

  it('opens the selected thread and preserves the active branch in state', () => {
    render(<InboxScreen />);

    fireEvent.press(
      screen.getByRole('button', { name: 'Open chat with Asha Rao' })
    );

    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/(app)/conversation/[conversationId]',
      params: { conversationId: CONVERSATION_ID },
    });
  });

  it('renders Account in the native header and opens the Account route', () => {
    render(<InboxScreen />);

    expect(screen.getByText('Account').props.className).toContain(
      'text-zinc-950'
    );
    fireEvent.press(screen.getByRole('button', { name: 'Account' }));
    expect(mockRouter.push).toHaveBeenCalledWith('/(app)/account');
  });

  it('wires branch-wide search and All/Unread filters to the list model', () => {
    const result = listResult();
    mockUseConversationList.mockReturnValue(result);
    render(<InboxScreen />);

    fireEvent.changeText(
      screen.getByLabelText('Search conversations'),
      'renewal'
    );
    fireEvent.press(screen.getByRole('button', { name: 'Unread, 3' }));

    expect(result.setSearch).toHaveBeenCalledWith('renewal');
    expect(result.setFilter).toHaveBeenCalledWith('unread');
  });

  it('shows distinct empty and failed states', () => {
    mockUseConversationList.mockReturnValue(emptyResult());
    const { rerender } = render(<InboxScreen />);
    expect(screen.getByText('No conversations yet')).toBeTruthy();

    mockUseConversationList.mockReturnValue(errorResult());
    rerender(<InboxScreen />);
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });

  it('shows disconnected status and retries only the failed pagination request', () => {
    const result = listResult({
      connection: 'disconnected',
      paginationError: 'Could not load more conversations',
    });
    mockUseConversationList.mockReturnValue(result);
    render(<InboxScreen />);

    expect(screen.getByText('Live updates unavailable')).toBeTruthy();
    expect(screen.getByText('Could not load more conversations')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Retry loading more' }));
    expect(result.loadMore).toHaveBeenCalledTimes(1);
    expect(result.refresh).not.toHaveBeenCalled();
  });

  it('keeps rows and the connection banner visible with an inline refresh warning', () => {
    mockUseConversationList.mockReturnValue(
      listResult({
        connection: 'disconnected',
        refreshWarning: 'Could not refresh conversations',
      })
    );

    render(<InboxScreen />);

    expect(screen.getByText('Asha Rao')).toBeTruthy();
    expect(screen.getByText('Live updates unavailable')).toBeTruthy();
    expect(screen.getByText('Could not refresh conversations')).toBeTruthy();
    expect(screen.getAllByRole('alert')).toHaveLength(2);
  });

  it('supports pull refresh and loads the next page at the list boundary', () => {
    const result = listResult({ hasMore: true });
    mockUseConversationList.mockReturnValue(result);
    render(<InboxScreen />);

    const list = screen.getByTestId('conversation-list');
    fireEvent(list, 'refresh');
    fireEvent(list, 'endReached');

    expect(result.refresh).toHaveBeenCalledTimes(1);
    expect(result.loadMore).toHaveBeenCalledTimes(1);
  });
});
