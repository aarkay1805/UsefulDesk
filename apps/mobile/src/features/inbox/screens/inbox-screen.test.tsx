import { act, fireEvent, render, screen } from '@testing-library/react-native';

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

  const MenuOpenContext = React.createContext({
    isOpen: false,
    setOpen: (_next: boolean): void => undefined,
  });
  let menuSelectionHandler: ((keys: Set<string>) => void) | undefined;

  function MockMenu({ children }: import('react').PropsWithChildren) {
    const [isOpen, setOpen] = React.useState(false);
    return React.createElement(
      MenuOpenContext.Provider,
      { value: { isOpen, setOpen } },
      children
    );
  }
  MockMenu.Trigger = function MockMenuTrigger({
    isDisabled,
    ...props
  }: import('react-native').PressableProps & { isDisabled?: boolean }) {
    const { isOpen, setOpen } = React.useContext(MenuOpenContext);
    return React.createElement(Pressable, {
      ...props,
      accessibilityRole: 'button',
      disabled: isDisabled,
      onPress: () => setOpen(!isOpen),
    });
  };
  MockMenu.Portal = function MockMenuPortal({
    children,
  }: import('react').PropsWithChildren) {
    const { isOpen } = React.useContext(MenuOpenContext);
    return isOpen ? React.createElement(View, null, children) : null;
  };
  MockMenu.Overlay = function MockMenuOverlay() {
    return null;
  };
  MockMenu.Content = function MockMenuContent({
    children,
  }: import('react').PropsWithChildren) {
    return React.createElement(View, null, children);
  };
  MockMenu.Group = function MockMenuGroup({
    children,
    onSelectionChange,
  }: import('react').PropsWithChildren<{
    onSelectionChange?: (keys: Set<string>) => void;
  }>) {
    menuSelectionHandler = onSelectionChange;
    return React.createElement(View, null, children);
  };
  MockMenu.Item = function MockMenuItem({
    id,
    ...props
  }: import('react-native').PressableProps & { id?: string }) {
    const { setOpen } = React.useContext(MenuOpenContext);
    return React.createElement(Pressable, {
      ...props,
      accessibilityRole: 'button',
      onPress: () => {
        if (id !== undefined) menuSelectionHandler?.(new Set([id]));
        setOpen(false);
      },
    });
  };
  MockMenu.ItemIndicator = function MockMenuItemIndicator() {
    return null;
  };
  MockMenu.ItemTitle = function MockMenuItemTitle({
    children,
  }: import('react').PropsWithChildren) {
    return React.createElement(Text, null, children);
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
    Menu: MockMenu,
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
    recoverUnauthorizedSession: jest.fn(),
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

const emptyResult = () => listResult({ items: [], unreadCount: 0 });
const errorResult = () =>
  listResult({
    items: [],
    status: 'error',
    error: 'Could not load chats',
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
      screen.getByRole('button', { name: /Open chat with Asha Rao,/ })
    );

    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/(app)/conversation/[conversationId]',
      params: { conversationId: CONVERSATION_ID },
    });
  });

  it.each([1, 2, 20])('renders a queue of %i chats', (count) => {
    mockUseConversationList.mockReturnValue(
      listResult({
        items: Array.from({ length: count }, (_, index) =>
          conversation({
            id: `chat-${index}`,
            contact: {
              id: `contact-${index}`,
              name: `Member ${index + 1}`,
              phone: `9876500${String(index).padStart(3, '0')}`,
              avatarUrl: null,
            },
            unreadCount: index === 0 ? 20 : 0,
          })
        ),
      })
    );

    render(<InboxScreen />);

    expect(screen.getByTestId('conversation-list').props.data).toHaveLength(
      count
    );
    expect(
      screen.getAllByRole('button', { name: /^Open chat with Member/ })
    ).toHaveLength(Math.min(count, 10));
    expect(screen.getByLabelText('20 unread messages')).toBeTruthy();
  });

  it('shows the current branch in the header and opens Account', () => {
    render(<InboxScreen />);

    expect(screen.getByText('Branch: Indiranagar')).toBeTruthy();
    fireEvent.press(
      screen.getByRole('button', {
        name: 'Account, current branch: Indiranagar',
      })
    );
    expect(mockRouter.push).toHaveBeenCalledWith('/(app)/account');
  });

  it('wires branch-wide search and All/Unread filters to the list model', () => {
    const result = listResult();
    mockUseConversationList.mockReturnValue(result);
    render(<InboxScreen />);

    fireEvent.changeText(screen.getByLabelText('Search chats'), 'renewal');
    fireEvent.press(screen.getByRole('button', { name: 'Chat filter, All' }));
    fireEvent.press(screen.getByRole('button', { name: 'Unread, 3' }));

    expect(result.setSearch).toHaveBeenCalledWith('renewal');
    expect(result.setFilter).toHaveBeenCalledWith('unread');
  });

  it('shows the empty branch without a misleading recovery action', () => {
    mockUseConversationList.mockReturnValue(emptyResult());
    render(<InboxScreen />);
    expect(screen.getByText('No chats yet')).toBeTruthy();
    expect(screen.queryByTestId('empty-chats-action')).toBeNull();
  });

  it('shows no unread chats and returns to All without clearing search', () => {
    const result = emptyResult();
    result.filter = 'unread';
    mockUseConversationList.mockReturnValue(result);
    render(<InboxScreen />);

    expect(screen.getByText('No unread chats')).toBeTruthy();
    fireEvent.press(screen.getByTestId('empty-chats-action'));
    expect(result.setFilter).toHaveBeenCalledWith('all');
    expect(result.setSearch).not.toHaveBeenCalled();
  });

  it.each(['all', 'unread'] as const)(
    'clears a %s search miss without changing the filter',
    (filter) => {
      const result = listResult({
        items: [],
        filter,
        search: 'renewal',
      });
      mockUseConversationList.mockReturnValue(result);
      render(<InboxScreen />);

      expect(screen.getByText('No chats match')).toBeTruthy();
      fireEvent.press(screen.getByTestId('empty-chats-action'));
      expect(result.setSearch).toHaveBeenCalledWith('');
      expect(result.setFilter).not.toHaveBeenCalled();
    }
  );

  it('keeps the retry action for a failed query', () => {
    mockUseConversationList.mockReturnValue(errorResult());
    render(<InboxScreen />);

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('shows the new branch without old results during a branch switch', () => {
    const { rerender } = render(<InboxScreen />);
    const nextAuth = readyAuthValue();
    nextAuth.state.branch.account_id = 'ab92ad08-3808-4a3e-8d50-7a5fa2a6a770';
    nextAuth.state.branch.account_name = 'A Long North Bengaluru Branch Name';
    mockUseReadyAuth.mockReturnValue(nextAuth);
    mockUseConversationList.mockReturnValue(
      listResult({ items: [], status: 'loading' })
    );

    rerender(<InboxScreen />);

    expect(
      screen.getByText('Branch: A Long North Bengaluru Branch Name')
    ).toBeTruthy();
    expect(screen.queryByText('Asha Rao')).toBeNull();
    expect(screen.getByLabelText('Loading chats')).toBeTruthy();
  });

  it('shows disconnected status and retries only the failed pagination request', () => {
    const result = listResult({
      connection: 'disconnected',
      paginationError: 'Could not load more chats',
    });
    mockUseConversationList.mockReturnValue(result);
    render(<InboxScreen />);

    expect(screen.getByText('Not updating live')).toBeTruthy();
    expect(screen.getByText('Could not load more chats')).toBeTruthy();
    fireEvent.press(
      screen.getByRole('button', { name: 'Try loading more chats again' })
    );
    expect(result.loadMore).toHaveBeenCalledTimes(1);
    expect(result.refresh).not.toHaveBeenCalled();
  });

  it('keeps rows and the connection banner visible with an inline refresh warning', () => {
    mockUseConversationList.mockReturnValue(
      listResult({
        connection: 'disconnected',
        refreshWarning: 'Could not refresh chats. Pull down to try again.',
      })
    );

    render(<InboxScreen />);

    expect(screen.getByText('Asha Rao')).toBeTruthy();
    expect(screen.getByText('Not updating live')).toBeTruthy();
    expect(
      screen.getByText('Could not refresh chats. Pull down to try again.')
    ).toBeTruthy();
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

  it('advances relative conversation timestamps at the account midnight', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-09-04T18:29:30.000Z'));
    mockUseConversationList.mockReturnValue(
      listResult({
        items: [
          conversation({
            unreadCount: 0,
            lastMessageAt: '2026-09-04T18:20:00.000Z',
          }),
        ],
      })
    );
    const view = render(<InboxScreen />);

    try {
      expect(screen.queryByText('Yesterday')).toBeNull();

      act(() => {
        jest.advanceTimersByTime(31_000);
      });

      expect(screen.getByText('Yesterday')).toBeTruthy();
    } finally {
      view.unmount();
      jest.useRealTimers();
    }
  });
});
