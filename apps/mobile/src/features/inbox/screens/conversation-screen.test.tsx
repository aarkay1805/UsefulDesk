import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { Platform } from 'react-native';

import type { ReadyAuthContextValue } from '../../auth/auth-context';
import type { AccountSummary, BranchAccount } from '../../auth/branch-types';
import type { InboxRealtimeFeed } from '../inbox-realtime-provider';
import type { ConnectionReadiness, NativeTemplate } from '../inbox-types';
import {
  BRANCH_ID,
  CONVERSATION_ID,
  conversation,
  message,
  MESSAGE_0_ID,
  MESSAGE_1_ID,
  MESSAGE_2_ID,
  MESSAGE_3_ID,
  OTHER_BRANCH_ID,
  OTHER_CONVERSATION_ID,
} from '../inbox-test-fixtures';
import type { UseMessageThreadResult } from '../use-message-thread';
import {
  MobileSendError,
  sendConversationMessage,
} from '../send-message-client';
import {
  ConversationScreen,
  distanceFromBottom,
  shouldFollowLatest,
  shouldLoadOlder,
} from './conversation-screen';

const mockRouter = { push: jest.fn(), replace: jest.fn() };
const mockUseLocalSearchParams = jest.fn();
const mockUseMessageThread = jest.fn();
const mockUseReadyAuth = jest.fn<ReadyAuthContextValue, []>();
const mockScrollToEnd = jest.fn();
const mockFocus = jest.fn();
const mockStackOptions: { current: Record<string, unknown> | undefined } = {
  current: undefined,
};
const screenRealtime: InboxRealtimeFeed = {
  getSnapshot: () => ({ connection: 'connected', resyncGeneration: 0 }),
  listen: () => () => undefined,
  listenStatus: () => () => undefined,
};

jest.mock('react-native', () => {
  const React = jest.requireActual('react') as typeof import('react');
  const native = jest.requireActual(
    'react-native'
  ) as typeof import('react-native');

  const MockFlatList = React.forwardRef(
    (
      props: import('react-native').FlatListProps<unknown>,
      ref: import('react').ForwardedRef<{
        scrollToEnd(options?: { animated?: boolean }): void;
      }>
    ) => {
      React.useImperativeHandle(ref, () => ({ scrollToEnd: mockScrollToEnd }));
      const children = Array.from(props.data ?? []).map((item, index) => {
        const rendered = props.renderItem?.({
          item,
          index,
          separators: {
            highlight: jest.fn(),
            unhighlight: jest.fn(),
            updateProps: jest.fn(),
          },
        });
        return React.createElement(
          React.Fragment,
          { key: props.keyExtractor?.(item, index) ?? String(index) },
          rendered
        );
      });
      const footer =
        typeof props.ListFooterComponent === 'function'
          ? React.createElement(props.ListFooterComponent)
          : props.ListFooterComponent;
      const header =
        typeof props.ListHeaderComponent === 'function'
          ? React.createElement(props.ListHeaderComponent)
          : props.ListHeaderComponent;
      const empty =
        children.length === 0
          ? typeof props.ListEmptyComponent === 'function'
            ? React.createElement(props.ListEmptyComponent)
            : props.ListEmptyComponent
          : null;

      return React.createElement(
        native.ScrollView,
        props as never,
        header,
        children.length > 0 ? children : empty,
        footer
      );
    }
  );
  MockFlatList.displayName = 'MockFlatList';

  function MockKeyboardAvoidingView({
    children,
    ...props
  }: import('react-native').KeyboardAvoidingViewProps) {
    return React.createElement(native.View, props, children);
  }

  return Object.setPrototypeOf(
    {
      FlatList: MockFlatList,
      KeyboardAvoidingView: MockKeyboardAvoidingView,
    },
    native
  );
});

jest.mock('expo-router', () => ({
  Stack: {
    Screen: ({ options }: { options?: Record<string, unknown> }) => {
      const React = jest.requireActual('react') as typeof import('react');
      const { Text } = jest.requireActual(
        'react-native'
      ) as typeof import('react-native');
      mockStackOptions.current = options;
      return typeof options?.title === 'string'
        ? React.createElement(Text, null, options.title)
        : null;
    },
  },
  useLocalSearchParams: () => mockUseLocalSearchParams(),
  useRouter: () => mockRouter,
}));

jest.mock('../../auth/auth-context', () => ({
  useReadyAuth: () => mockUseReadyAuth(),
}));

jest.mock('../use-message-thread', () => ({
  useMessageThread: (...args: unknown[]) => mockUseMessageThread(...args),
}));

jest.mock('../inbox-realtime-provider', () => ({
  useInboxRealtimeFeed: () => screenRealtime,
}));

jest.mock('../send-message-client', () => ({
  ...jest.requireActual('../send-message-client'),
  sendConversationMessage: jest.fn(),
}));

jest.mock('../components/message-bubble', () => {
  const React = jest.requireActual('react') as typeof import('react');
  const { Text, View } = jest.requireActual(
    'react-native'
  ) as typeof import('react-native');

  return {
    MessageBubble: ({
      message: item,
      formattedTime,
      startsRun,
    }: {
      message: { id: string; contentText: string | null };
      formattedTime: string;
      startsRun: boolean;
    }) =>
      React.createElement(
        View,
        {
          accessibilityLabel: `Message ${item.id}, ${
            startsRun ? 'starts run' : 'continues run'
          }`,
          testID: `message-probe-${item.id}`,
        },
        React.createElement(Text, null, item.contentText),
        React.createElement(Text, null, formattedTime)
      ),
  };
});

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

  function MockTextField({ children }: import('react').PropsWithChildren) {
    return React.createElement(View, null, children);
  }

  let currentFieldLabel = '';
  function MockLabel({ children }: import('react').PropsWithChildren) {
    currentFieldLabel = String(children);
    return React.createElement(Text, null, children);
  }

  const MockInput = React.forwardRef(function MockInput(
    { isDisabled, onChangeText, ...props }: any,
    ref: any
  ) {
    React.useImperativeHandle(ref, () => ({ focus: mockFocus }));
    return React.createElement(TextInput, {
      ...props,
      accessibilityLabel: props.accessibilityLabel ?? currentFieldLabel,
      editable: !isDisabled,
      onChangeText: isDisabled ? undefined : onChangeText,
    });
  });

  function MockFieldError({ children }: import('react').PropsWithChildren) {
    return React.createElement(Text, { accessibilityRole: 'alert' }, children);
  }

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
    Button: MockButton,
    FieldError: MockFieldError,
    Input: MockInput,
    Label: MockLabel,
    Spinner: MockSpinner,
    TextField: MockTextField,
  };
});

jest.mock('expo-symbols', () => {
  const React = jest.requireActual('react') as typeof import('react');
  const { View } = jest.requireActual(
    'react-native'
  ) as typeof import('react-native');

  return {
    SymbolView: (props: { name: string }) =>
      React.createElement(View, { ...props, testID: 'screen-symbol' }),
  };
});

function accountSummary(id = BRANCH_ID): AccountSummary {
  return {
    id,
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

function readyAuthValue(
  accountId = BRANCH_ID,
  role: BranchAccount['role'] = 'admin',
  branchStatus: BranchAccount['branch_status'] = 'active'
): ReadyAuthContextValue {
  const branch: BranchAccount = {
    account_id: accountId,
    account_name: 'Indiranagar',
    organization_id: '405ea376-0d27-4898-b198-0edb2a87ff38',
    organization_name: 'Useful Fitness',
    legal_entity_id: '895fd4ad-7219-4982-b8e4-a0c84f83e8d4',
    legal_entity_name: 'Useful Fitness Private Limited',
    role,
    branch_status: branchStatus,
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
        account_id: accountId,
        account_role: role,
      },
      branches: [branch],
      branch,
      account: accountSummary(accountId),
    },
    signInWithPassword: jest.fn(),
    signInWithGoogle: jest.fn(),
    signOut: jest.fn(),
    recoverUnauthorizedSession: jest.fn(),
    selectBranch: jest.fn(),
  };
}

interface TestSendReadiness {
  status: 'hidden' | 'loading' | 'ready' | 'error';
  latestInboundAt: string | null;
  templates: NativeTemplate[];
  connectionReadiness: ConnectionReadiness | null;
  templateReadiness: {
    status: 'ready' | 'error';
    hasLocalTemplates: boolean;
    contractReady: boolean;
  } | null;
}

const connectedReadiness: ConnectionReadiness = {
  status: 'connected',
  ready: true,
  reason: null,
  connectedAt: '2026-09-01T08:00:00.000Z',
};

const staticTemplate: NativeTemplate = {
  id: '5b52d03c-9d8c-4cf4-b8c6-a10b9b233571',
  name: 'static_notice',
  language: 'en',
  category: 'Utility',
  bodyText: 'The gym opens at 6 AM.',
  headerType: null,
  headerContent: null,
  headerMediaUrl: null,
  buttons: [],
  status: 'APPROVED',
  parameterFormat: 'POSITIONAL',
  providerMissingSince: null,
  providerComponentsSyncRequiredAt: null,
};

function readyThreadResult(
  overrides: Partial<UseMessageThreadResult> & {
    sendReadiness?: TestSendReadiness;
  } = {}
): UseMessageThreadResult {
  return {
    conversation: conversation(),
    items: [
      message({
        id: MESSAGE_1_ID,
        senderType: 'customer',
        contentText: 'Hello',
        createdAt: '2026-09-01T08:01:00.000Z',
      }),
      message({
        id: MESSAGE_2_ID,
        senderType: 'agent',
        contentText: 'How can I help?',
        createdAt: '2026-09-01T08:02:00.000Z',
      }),
    ],
    status: 'ready',
    error: null,
    refreshWarning: null,
    unreadWarning: null,
    paginationError: null,
    connection: 'connected',
    refreshing: false,
    loadingOlder: false,
    hasOlder: false,
    refresh: jest.fn(),
    loadOlder: jest.fn(),
    sendText: jest.fn().mockResolvedValue({
      temporaryId: 'temp:screen-test',
      status: 'sent',
    }),
    retryText: jest.fn().mockResolvedValue({
      temporaryId: 'temp:screen-test',
      status: 'sent',
    }),
    sendReadiness: {
      status: 'ready',
      latestInboundAt: new Date().toISOString(),
      templates: [staticTemplate],
      connectionReadiness: connectedReadiness,
      templateReadiness: {
        status: 'ready',
        hasLocalTemplates: true,
        contractReady: true,
      },
    },
    ...overrides,
  } as UseMessageThreadResult;
}

describe('conversation scroll policy', () => {
  it('measures the bottom band and follows only insert-shaped tail growth', () => {
    expect(distanceFromBottom(1000, 700, 200)).toBe(100);
    expect(shouldFollowLatest(MESSAGE_1_ID, MESSAGE_2_ID, 1, 2, true)).toBe(
      true
    );
    expect(shouldFollowLatest(MESSAGE_1_ID, MESSAGE_2_ID, 1, 2, false)).toBe(
      false
    );
    expect(shouldFollowLatest(MESSAGE_2_ID, MESSAGE_2_ID, 1, 2, true)).toBe(
      false
    );
    expect(shouldFollowLatest(MESSAGE_2_ID, MESSAGE_1_ID, 2, 1, true)).toBe(
      false
    );
    expect(shouldFollowLatest(MESSAGE_1_ID, MESSAGE_2_ID, 2, 2, true)).toBe(
      false
    );
  });

  it('requests older messages only at an available idle top boundary', () => {
    expect(shouldLoadOlder(20, true, false, null)).toBe(true);
    expect(shouldLoadOlder(100, true, false, null)).toBe(false);
    expect(shouldLoadOlder(20, false, false, null)).toBe(false);
    expect(shouldLoadOlder(20, true, true, null)).toBe(false);
    expect(shouldLoadOlder(20, true, false, 'Failed')).toBe(false);
  });
});

describe('ConversationScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStackOptions.current = undefined;
    mockUseLocalSearchParams.mockReturnValue({
      conversationId: CONVERSATION_ID,
    });
    mockUseReadyAuth.mockReturnValue(readyAuthValue());
    mockUseMessageThread.mockReturnValue(readyThreadResult());
  });

  it('renders chronological runs in the native titled route with the open-window composer', () => {
    mockUseMessageThread.mockReturnValue(
      readyThreadResult({
        items: [
          message({
            id: MESSAGE_1_ID,
            senderType: 'customer',
            contentText: 'First',
            createdAt: '2026-09-01T08:01:00.000Z',
          }),
          message({
            id: MESSAGE_2_ID,
            senderType: 'customer',
            contentText: 'Second',
            createdAt: '2026-09-01T08:02:00.000Z',
          }),
          message({
            id: MESSAGE_3_ID,
            senderType: 'agent',
            contentText: 'Third',
            createdAt: '2026-09-01T08:03:00.000Z',
          }),
        ],
      })
    );
    render(<ConversationScreen />);

    expect(screen.getByText('Asha Rao')).toBeTruthy();
    expect(screen.getByText('1 Sept 2026')).toBeTruthy();
    expect(
      screen.getAllByTestId(/^message-probe-/).map((node) => node.props.testID)
    ).toEqual([
      `message-probe-${MESSAGE_1_ID}`,
      `message-probe-${MESSAGE_2_ID}`,
      `message-probe-${MESSAGE_3_ID}`,
    ]);
    expect(
      screen.getByLabelText(`Message ${MESSAGE_1_ID}, starts run`)
    ).toBeTruthy();
    expect(
      screen.getByLabelText(`Message ${MESSAGE_2_ID}, continues run`)
    ).toBeTruthy();
    expect(
      screen.getByLabelText(`Message ${MESSAGE_3_ID}, starts run`)
    ).toBeTruthy();
    expect(screen.getByPlaceholderText(/message/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Send message' })).toBeTruthy();
    expect(mockStackOptions.current).toEqual({ title: 'Asha Rao' });
    expect(mockUseMessageThread).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: BRANCH_ID,
        conversationId: CONVERSATION_ID,
        realtime: screenRealtime,
        role: 'admin',
      })
    );
  });

  it.each(['owner', 'admin', 'agent'] as const)(
    'passes authenticated outbound dependencies and renders text for an open %s window',
    (role) => {
      const auth = readyAuthValue(BRANCH_ID, role);
      mockUseReadyAuth.mockReturnValue(auth);

      render(<ConversationScreen />);

      expect(screen.getByLabelText('Message')).toBeTruthy();
      expect(mockUseMessageThread).toHaveBeenLastCalledWith(
        expect.objectContaining({
          role,
          outbound: {
            senderId: auth.state.profile.id,
            recoverUnauthorizedSession: auth.recoverUnauthorizedSession,
          },
        })
      );
    }
  );

  it('keeps viewers read-only without loading or outbound dependencies leaking into controls', () => {
    mockUseReadyAuth.mockReturnValue(readyAuthValue(BRANCH_ID, 'viewer'));
    mockUseMessageThread.mockReturnValue(
      readyThreadResult({
        items: [
          message({
            id: 'temp:viewer-failed',
            senderType: 'agent',
            status: 'failed',
            providerErrorTitle: 'Could not send message',
          }),
        ],
        sendReadiness: {
          status: 'hidden',
          latestInboundAt: null,
          templates: [],
          connectionReadiness: null,
          templateReadiness: null,
        },
      })
    );

    render(<ConversationScreen />);

    expect(screen.queryByLabelText('Message')).toBeNull();
    expect(screen.queryByRole('button', { name: /send/i })).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Retry failed message' })
    ).toBeNull();
    expect(screen.queryByTestId('conversation-action-blocker')).toBeNull();
    expect(mockUseMessageThread).toHaveBeenLastCalledWith(
      expect.objectContaining({ role: 'viewer', outbound: undefined })
    );
  });

  it('keeps an agent in a read-only branch without outbound controls or dependencies', () => {
    mockUseReadyAuth.mockReturnValue(
      readyAuthValue(BRANCH_ID, 'agent', 'read_only')
    );
    mockUseMessageThread.mockReturnValue(
      readyThreadResult({
        items: [
          message({
            id: 'temp:read-only-failed',
            senderType: 'agent',
            status: 'failed',
            providerErrorTitle: 'Could not send message',
          }),
        ],
      })
    );

    render(<ConversationScreen />);

    expect(screen.queryByLabelText('Message')).toBeNull();
    expect(screen.queryByRole('button', { name: /send/i })).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Retry failed message' })
    ).toBeNull();
    expect(screen.queryByTestId('conversation-action-blocker')).toBeNull();
    expect(mockUseMessageThread).toHaveBeenLastCalledWith(
      expect.objectContaining({ role: 'agent', outbound: undefined })
    );
  });

  it('keeps the open-window composer available when only template readiness fails', () => {
    mockUseMessageThread.mockReturnValue(
      readyThreadResult({
        sendReadiness: {
          status: 'ready',
          latestInboundAt: new Date().toISOString(),
          templates: [],
          connectionReadiness: connectedReadiness,
          templateReadiness: {
            status: 'error',
            hasLocalTemplates: false,
            contractReady: false,
          },
        },
      })
    );

    render(<ConversationScreen />);

    expect(screen.getByLabelText('Message')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Send message' })).toBeTruthy();
    expect(screen.queryByTestId('conversation-action-blocker')).toBeNull();
  });

  it('shows no send surface until readiness finishes loading', () => {
    mockUseMessageThread.mockReturnValue(
      readyThreadResult({
        sendReadiness: {
          status: 'loading',
          latestInboundAt: null,
          templates: [],
          connectionReadiness: null,
          templateReadiness: null,
        },
      })
    );
    const { rerender } = render(<ConversationScreen />);

    expect(screen.queryByLabelText('Message')).toBeNull();
    expect(screen.queryByRole('button', { name: /send/i })).toBeNull();

    mockUseMessageThread.mockReturnValue(readyThreadResult());
    rerender(<ConversationScreen />);

    expect(screen.getByLabelText('Message')).toBeTruthy();
  });

  it('routes open-window send failure and Retry through the message hook', async () => {
    const sendText = jest.fn().mockResolvedValue({
      temporaryId: 'temp:screen-failed',
      status: 'failed',
      safeToRetry: true,
      message: 'Too many send attempts.',
    });
    const retryText = jest.fn().mockResolvedValue({
      temporaryId: 'temp:screen-failed',
      status: 'sent',
    });
    mockUseMessageThread.mockReturnValue(
      readyThreadResult({ sendText, retryText })
    );
    render(<ConversationScreen />);

    fireEvent.changeText(screen.getByLabelText('Message'), '  Please renew  ');
    fireEvent.press(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => expect(sendText).toHaveBeenCalledWith('Please renew'));
    fireEvent.press(
      await screen.findByRole('button', { name: 'Retry message' })
    );

    await waitFor(() =>
      expect(retryText).toHaveBeenCalledWith('temp:screen-failed')
    );
  });

  it('renders row Retry only for failed optimistic messages proven safe to retry', async () => {
    let finishRetry!: (result: { temporaryId: string; status: 'sent' }) => void;
    const pendingRetry = new Promise<{
      temporaryId: string;
      status: 'sent';
    }>((resolve) => {
      finishRetry = resolve;
    });
    const retryText = jest.fn().mockReturnValue(pendingRetry);
    mockUseMessageThread.mockReturnValue(
      readyThreadResult({
        retryText,
        items: [
          ...readyThreadResult().items,
          {
            ...message({
              id: 'temp:screen-failed-one',
              senderType: 'agent',
              status: 'failed',
              providerErrorTitle: 'Delivery could not be confirmed',
              contentText: 'First failed message',
            }),
            safeToRetry: false,
          },
          {
            ...message({
              id: 'temp:screen-failed-two',
              senderType: 'agent',
              status: 'failed',
              providerErrorTitle: 'Too many send attempts',
              contentText: 'Second failed message',
            }),
            safeToRetry: true,
          },
        ],
      })
    );
    render(<ConversationScreen />);

    const retries = screen.getAllByRole('button', {
      name: 'Retry failed message',
    });
    expect(retries).toHaveLength(1);
    expect(retries[0].props.className).toContain('min-h-11');

    fireEvent.press(retries[0]);

    expect(retryText).toHaveBeenCalledTimes(1);
    expect(retryText).toHaveBeenCalledWith('temp:screen-failed-two');
    expect(
      screen.getAllByRole('button', { name: 'Retry failed message' })[0].props
        .accessibilityState
    ).toEqual({ disabled: true, busy: true });
    fireEvent.press(
      screen.getAllByRole('button', { name: 'Retry failed message' })[0]
    );
    expect(retryText).toHaveBeenCalledTimes(1);

    await act(async () => {
      finishRetry({
        temporaryId: 'temp:screen-failed-two',
        status: 'sent',
      });
      await pendingRetry;
    });
  });

  it('keeps a failed-row Retry after a later composer success clears the composer failure', async () => {
    const retryText = jest.fn().mockResolvedValue({
      temporaryId: 'temp:persistent-row',
      status: 'sent',
    });
    const sendText = jest
      .fn()
      .mockResolvedValueOnce({
        temporaryId: 'temp:persistent-row',
        status: 'failed',
        safeToRetry: true,
        message: 'Too many send attempts.',
      })
      .mockResolvedValueOnce({
        temporaryId: 'temp:later-success',
        status: 'sent',
      });
    mockUseMessageThread.mockReturnValue(
      readyThreadResult({
        retryText,
        sendText,
        items: [
          ...readyThreadResult().items,
          message({
            id: 'temp:persistent-row',
            senderType: 'agent',
            status: 'failed',
            providerErrorTitle: 'Could not send message',
            safeToRetry: true,
            contentText: 'Persistent failed message',
          }),
        ],
      })
    );
    render(<ConversationScreen />);

    fireEvent.changeText(screen.getByLabelText('Message'), 'First attempt');
    fireEvent.press(screen.getByRole('button', { name: 'Send message' }));
    expect(
      await screen.findByRole('button', { name: 'Retry message' })
    ).toBeTruthy();

    fireEvent.changeText(screen.getByLabelText('Message'), 'Later success');
    fireEvent.press(screen.getByRole('button', { name: 'Send message' }));
    await waitFor(() => expect(sendText).toHaveBeenCalledTimes(2));

    expect(screen.queryByRole('button', { name: 'Retry message' })).toBeNull();
    fireEvent.press(
      screen.getByRole('button', { name: 'Retry failed message' })
    );
    await waitFor(() =>
      expect(retryText).toHaveBeenCalledWith('temp:persistent-row')
    );
  });

  it('closes the open service window at the exact 24-hour boundary without another render', () => {
    jest.useFakeTimers();
    const latestInboundAt = '2026-09-01T08:00:00.000Z';
    jest.setSystemTime(new Date(latestInboundAt));
    mockUseMessageThread.mockReturnValue(
      readyThreadResult({
        sendReadiness: {
          status: 'ready',
          latestInboundAt,
          templates: [staticTemplate],
          connectionReadiness: connectedReadiness,
          templateReadiness: {
            status: 'ready',
            hasLocalTemplates: true,
            contractReady: true,
          },
        },
      })
    );
    const view = render(<ConversationScreen />);

    try {
      expect(screen.getByLabelText('Message')).toBeTruthy();
      act(() => jest.advanceTimersByTime(24 * 60 * 60 * 1000 - 1));
      expect(screen.getByLabelText('Message')).toBeTruthy();

      act(() => jest.advanceTimersByTime(1));

      expect(screen.queryByLabelText('Message')).toBeNull();
      expect(screen.getByTestId('closed-window-action-bar')).toBeTruthy();
    } finally {
      view.unmount();
      jest.useRealTimers();
    }
  });

  it('replaces the composer with an amber closed-window bar whose only action is Send a template', () => {
    mockUseMessageThread.mockReturnValue(
      readyThreadResult({
        sendReadiness: {
          status: 'ready',
          latestInboundAt: '2026-01-01T00:00:00.000Z',
          templates: [staticTemplate],
          connectionReadiness: connectedReadiness,
          templateReadiness: {
            status: 'ready',
            hasLocalTemplates: true,
            contractReady: true,
          },
        },
      })
    );

    render(<ConversationScreen />);

    const bar = screen.getByTestId('closed-window-action-bar');
    expect(bar.props.className).toContain('bg-warning-soft');
    expect(screen.queryByLabelText('Message')).toBeNull();
    expect(
      screen
        .getAllByRole('button')
        .map((button) => button.props.accessibilityLabel)
    ).toEqual(['Send a template']);
  });

  it('opens the existing template picker, sends, refreshes, and closes it', async () => {
    const refresh = jest.fn();
    jest.mocked(sendConversationMessage).mockResolvedValue({
      messageId: MESSAGE_3_ID,
      whatsappMessageId: 'wamid.screen-template',
    });
    mockUseMessageThread.mockReturnValue(
      readyThreadResult({
        refresh,
        sendReadiness: {
          status: 'ready',
          latestInboundAt: null,
          templates: [staticTemplate],
          connectionReadiness: connectedReadiness,
          templateReadiness: {
            status: 'ready',
            hasLocalTemplates: true,
            contractReady: true,
          },
        },
      })
    );
    render(<ConversationScreen />);

    fireEvent.press(screen.getByRole('button', { name: 'Send a template' }));
    expect(screen.getByText('Send approved template')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Send template' }));

    await waitFor(() => expect(sendConversationMessage).toHaveBeenCalled());
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('Send approved template')).toBeNull();
  });

  it('keeps the template picker open when the hook returns an equivalent readiness value on rerender', () => {
    mockUseMessageThread.mockImplementation(() =>
      readyThreadResult({
        sendReadiness: {
          status: 'ready',
          latestInboundAt: null,
          templates: [staticTemplate],
          connectionReadiness: connectedReadiness,
          templateReadiness: {
            status: 'ready',
            hasLocalTemplates: true,
            contractReady: true,
          },
        },
      })
    );
    render(<ConversationScreen />);

    fireEvent.press(screen.getByRole('button', { name: 'Send a template' }));

    expect(screen.getByText('Send approved template')).toBeTruthy();
  });

  it('keeps an ambiguous template outcome locked after close and reopen until the agent confirms checking the conversation', async () => {
    jest
      .mocked(sendConversationMessage)
      .mockRejectedValueOnce(
        new MobileSendError('network', 'Could not reach the send service.')
      );
    mockUseMessageThread.mockReturnValue(
      readyThreadResult({
        sendReadiness: {
          status: 'ready',
          latestInboundAt: null,
          templates: [staticTemplate],
          connectionReadiness: connectedReadiness,
          templateReadiness: {
            status: 'ready',
            hasLocalTemplates: true,
            contractReady: true,
          },
        },
      })
    );
    render(<ConversationScreen />);

    fireEvent.press(screen.getByRole('button', { name: 'Send a template' }));
    fireEvent.press(screen.getByRole('button', { name: 'Send template' }));

    expect(
      await screen.findByText(/Delivery could not be confirmed/)
    ).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Close' }));
    fireEvent.press(screen.getByRole('button', { name: 'Send a template' }));

    expect(
      screen.getByText(
        'A previous template send could not be confirmed. Check this conversation for the message before sending another.'
      )
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Send template' })).toBeNull();

    fireEvent.press(
      screen.getByRole('button', { name: 'I checked the conversation' })
    );

    expect(screen.getByRole('button', { name: 'Send template' })).toBeTruthy();
    expect(sendConversationMessage).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['branch', CONVERSATION_ID, OTHER_BRANCH_ID],
    ['conversation', OTHER_CONVERSATION_ID, BRANCH_ID],
  ] as const)(
    'clears an ambiguous template lock when the %s scope key changes',
    async (_scope, nextConversationId, nextBranchId) => {
      jest
        .mocked(sendConversationMessage)
        .mockRejectedValueOnce(
          new MobileSendError('network', 'Could not reach the send service.')
        );
      mockUseMessageThread.mockReturnValue(
        readyThreadResult({
          sendReadiness: {
            status: 'ready',
            latestInboundAt: null,
            templates: [staticTemplate],
            connectionReadiness: connectedReadiness,
            templateReadiness: {
              status: 'ready',
              hasLocalTemplates: true,
              contractReady: true,
            },
          },
        })
      );
      const view = render(<ConversationScreen />);

      fireEvent.press(screen.getByRole('button', { name: 'Send a template' }));
      fireEvent.press(screen.getByRole('button', { name: 'Send template' }));
      expect(
        await screen.findByText(/Delivery could not be confirmed/)
      ).toBeTruthy();
      fireEvent.press(screen.getByRole('button', { name: 'Close' }));

      mockUseLocalSearchParams.mockReturnValue({
        conversationId: nextConversationId,
      });
      mockUseReadyAuth.mockReturnValue(readyAuthValue(nextBranchId));
      view.rerender(<ConversationScreen />);
      fireEvent.press(screen.getByRole('button', { name: 'Send a template' }));

      expect(
        screen.getByRole('button', { name: 'Send template' })
      ).toBeTruthy();
      expect(
        screen.queryByRole('button', { name: 'I checked the conversation' })
      ).toBeNull();
    }
  );

  it('fails closed to one readiness blocker with one pending-safe setup retry', () => {
    const refresh = jest.fn();
    mockUseMessageThread.mockReturnValue(
      readyThreadResult({
        refresh,
        sendReadiness: {
          status: 'error',
          latestInboundAt: null,
          templates: [],
          connectionReadiness: null,
          templateReadiness: null,
        },
      })
    );

    const view = render(<ConversationScreen />);

    expect(screen.getAllByTestId('conversation-action-blocker')).toHaveLength(
      1
    );
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.queryByLabelText('Message')).toBeNull();
    expect(
      screen
        .getAllByRole('button')
        .map((button) => button.props.accessibilityLabel)
    ).toEqual(['Retry send setup']);
    fireEvent.press(screen.getByRole('button', { name: 'Retry send setup' }));
    expect(refresh).toHaveBeenCalledTimes(1);

    mockUseMessageThread.mockReturnValue(
      readyThreadResult({
        refresh,
        refreshing: true,
        sendReadiness: {
          status: 'error',
          latestInboundAt: null,
          templates: [],
          connectionReadiness: null,
          templateReadiness: null,
        },
      })
    );
    view.rerender(<ConversationScreen />);

    expect(
      screen.getByRole('button', { name: 'Retry send setup' }).props
        .accessibilityState
    ).toEqual({ disabled: true, busy: true });
  });

  it('renders only the highest-priority closed-window blocker', () => {
    const refresh = jest.fn();
    mockUseMessageThread.mockReturnValue(
      readyThreadResult({
        refresh,
        sendReadiness: {
          status: 'ready',
          latestInboundAt: null,
          templates: [],
          connectionReadiness: {
            status: 'disconnected',
            ready: false,
            reason: 'WhatsApp is disconnected for this branch.',
            connectedAt: null,
          },
          templateReadiness: {
            status: 'ready',
            hasLocalTemplates: false,
            contractReady: false,
          },
        },
      })
    );

    render(<ConversationScreen />);

    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getByText('No sendable templates')).toBeTruthy();
    expect(screen.queryByText('WhatsApp is unavailable')).toBeNull();
    expect(
      screen
        .getAllByRole('button')
        .map((button) => button.props.accessibilityLabel)
    ).toEqual(['Retry send setup']);
    fireEvent.press(screen.getByRole('button', { name: 'Retry send setup' }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('uses the same single recovery action for a provider blocker', () => {
    const refresh = jest.fn();
    mockUseMessageThread.mockReturnValue(
      readyThreadResult({
        refresh,
        sendReadiness: {
          status: 'ready',
          latestInboundAt: null,
          templates: [staticTemplate],
          connectionReadiness: {
            status: 'disconnected',
            ready: false,
            reason: 'WhatsApp is disconnected for this branch.',
            connectedAt: null,
          },
          templateReadiness: {
            status: 'ready',
            hasLocalTemplates: true,
            contractReady: true,
          },
        },
      })
    );

    render(<ConversationScreen />);

    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getByText('WhatsApp is unavailable')).toBeTruthy();
    expect(
      screen
        .getAllByRole('button')
        .map((button) => button.props.accessibilityLabel)
    ).toEqual(['Retry send setup']);
    fireEvent.press(screen.getByRole('button', { name: 'Retry send setup' }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('keeps the list and action footer in native keyboard avoidance inside the bottom safe area', () => {
    render(<ConversationScreen />);

    const keyboard = screen.getByTestId('conversation-keyboard-avoiding-view');
    expect(keyboard.props.behavior).toBe(
      Platform.OS === 'ios' ? 'padding' : 'height'
    );
    expect(keyboard.props.keyboardVerticalOffset).toBeUndefined();
    expect(screen.getByTestId('message-list')).toBeTruthy();
    expect(screen.getByLabelText('Message')).toBeTruthy();
  });

  it.each([undefined, 'not-a-uuid', [CONVERSATION_ID, MESSAGE_1_ID]])(
    'rejects an invalid route parameter before loading the thread',
    (value) => {
      mockUseLocalSearchParams.mockReturnValue({ conversationId: value });
      render(<ConversationScreen />);

      expect(screen.getByText('Conversation is unavailable')).toBeTruthy();
      expect(mockUseMessageThread).not.toHaveBeenCalled();
      fireEvent.press(screen.getByRole('button', { name: 'Return to Inbox' }));
      expect(mockRouter.replace).toHaveBeenCalledWith('/(app)');
    }
  );

  it('initially positions at the bottom once without animation', () => {
    render(<ConversationScreen />);
    const list = screen.getByTestId('message-list');

    fireEvent(list, 'contentSizeChange', 390, 1200);
    fireEvent(list, 'contentSizeChange', 390, 1260);

    expect(mockScrollToEnd).toHaveBeenCalledTimes(1);
    expect(mockScrollToEnd).toHaveBeenCalledWith({ animated: false });
  });

  it('loads older history near the top and preserves the visible anchor', () => {
    const loadOlder = jest.fn();
    const initial = readyThreadResult({ loadOlder, hasOlder: true });
    mockUseMessageThread.mockReturnValue(initial);
    const { rerender } = render(<ConversationScreen />);
    const list = screen.getByTestId('message-list');
    fireEvent(list, 'contentSizeChange', 390, 1200);
    mockScrollToEnd.mockClear();

    expect(list.props.maintainVisibleContentPosition).toEqual({
      minIndexForVisible: 1,
    });
    fireEvent.scroll(list, {
      nativeEvent: {
        contentOffset: { y: 20 },
        contentSize: { height: 1200, width: 390 },
        layoutMeasurement: { height: 700, width: 390 },
      },
    });
    mockUseMessageThread.mockReturnValue(
      readyThreadResult({
        items: [
          message({
            id: MESSAGE_0_ID,
            contentText: 'Older message',
            createdAt: '2026-09-01T07:59:00.000Z',
          }),
          ...initial.items,
        ],
        loadOlder,
      })
    );
    rerender(<ConversationScreen />);

    expect(loadOlder).toHaveBeenCalledTimes(1);
    expect(mockScrollToEnd).not.toHaveBeenCalled();
  });

  it('follows an optimistic outbound append while the reader is near the bottom', () => {
    const initial = readyThreadResult();
    mockUseMessageThread.mockReturnValue(initial);
    const { rerender } = render(<ConversationScreen />);
    const list = screen.getByTestId('message-list');
    fireEvent(list, 'contentSizeChange', 390, 1200);
    mockScrollToEnd.mockClear();

    fireEvent.scroll(list, {
      nativeEvent: {
        contentOffset: { y: 820 },
        contentSize: { height: 1600, width: 390 },
        layoutMeasurement: { height: 700, width: 390 },
      },
    });
    mockUseMessageThread.mockReturnValue(
      readyThreadResult({
        items: [
          ...initial.items,
          message({
            id: 'temp:screen-optimistic',
            senderType: 'agent',
            status: 'sending',
            contentText: 'Near-bottom optimistic send',
          }),
        ],
      })
    );
    rerender(<ConversationScreen />);

    expect(mockScrollToEnd).toHaveBeenCalledWith({ animated: true });
  });

  it('does not follow when the latest message is deleted', () => {
    const initial = readyThreadResult({
      items: [
        ...readyThreadResult().items,
        message({ id: MESSAGE_3_ID, contentText: 'Delete me' }),
      ],
    });
    mockUseMessageThread.mockReturnValue(initial);
    const { rerender } = render(<ConversationScreen />);
    const list = screen.getByTestId('message-list');
    fireEvent(list, 'contentSizeChange', 390, 1200);
    mockScrollToEnd.mockClear();

    mockUseMessageThread.mockReturnValue(
      readyThreadResult({ items: initial.items.slice(0, -1) })
    );
    rerender(<ConversationScreen />);

    expect(mockScrollToEnd).not.toHaveBeenCalled();
  });

  it('does not follow a same-count tail replacement or refresh', () => {
    const initial = readyThreadResult();
    mockUseMessageThread.mockReturnValue(initial);
    const { rerender } = render(<ConversationScreen />);
    const list = screen.getByTestId('message-list');
    fireEvent(list, 'contentSizeChange', 390, 1200);
    mockScrollToEnd.mockClear();

    mockUseMessageThread.mockReturnValue(
      readyThreadResult({
        items: [
          initial.items[0],
          message({ id: MESSAGE_3_ID, contentText: 'Replacement tail' }),
        ],
        refreshing: true,
      })
    );
    rerender(<ConversationScreen />);

    expect(mockScrollToEnd).not.toHaveBeenCalled();
  });

  it('keeps an older reader in place and exposes a 48dp Jump to latest control', () => {
    const initial = readyThreadResult();
    mockUseMessageThread.mockReturnValue(initial);
    const { rerender } = render(<ConversationScreen />);
    const list = screen.getByTestId('message-list');
    fireEvent(list, 'contentSizeChange', 390, 1200);
    mockScrollToEnd.mockClear();

    fireEvent.scroll(list, {
      nativeEvent: {
        contentOffset: { y: 100 },
        contentSize: { height: 1600, width: 390 },
        layoutMeasurement: { height: 700, width: 390 },
      },
    });
    const jump = screen.getByRole('button', { name: 'Jump to latest' });
    expect(jump.props.className).toContain('min-h-12');

    mockUseMessageThread.mockReturnValue(
      readyThreadResult({
        items: [
          ...initial.items,
          message({ id: MESSAGE_3_ID, contentText: 'Scrolled-up update' }),
        ],
      })
    );
    rerender(<ConversationScreen />);
    expect(mockScrollToEnd).not.toHaveBeenCalled();

    fireEvent.press(screen.getByRole('button', { name: 'Jump to latest' }));
    expect(mockScrollToEnd).toHaveBeenCalledWith({ animated: false });
    expect(screen.queryByRole('button', { name: 'Jump to latest' })).toBeNull();
  });

  it('renders loading, unavailable, and retryable error states', () => {
    mockUseMessageThread.mockReturnValue(
      readyThreadResult({ status: 'loading', conversation: null, items: [] })
    );
    const { rerender } = render(<ConversationScreen />);
    expect(screen.getByLabelText('Loading messages')).toBeTruthy();

    mockUseMessageThread.mockReturnValue(
      readyThreadResult({
        status: 'error',
        conversation: null,
        items: [],
        error: 'Could not load messages',
      })
    );
    rerender(<ConversationScreen />);
    fireEvent.press(screen.getByRole('button', { name: 'Retry' }));
    expect(
      mockUseMessageThread.mock.results.at(-1)?.value.refresh
    ).toHaveBeenCalled();

    mockUseMessageThread.mockReturnValue(
      readyThreadResult({
        status: 'unavailable',
        conversation: null,
        items: [],
      })
    );
    rerender(<ConversationScreen />);
    expect(screen.getByText('Conversation is unavailable')).toBeTruthy();
  });

  it('renders the ready empty state and wires pull-to-refresh state', () => {
    const refresh = jest.fn();
    mockUseMessageThread.mockReturnValue(
      readyThreadResult({ items: [], refresh, refreshing: true })
    );
    render(<ConversationScreen />);
    const list = screen.getByTestId('message-list');

    expect(screen.getByText('No messages yet')).toBeTruthy();
    expect(list.props.refreshing).toBe(true);
    fireEvent(list, 'refresh');
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('keeps history visible with unread, offline, pagination, and loading states', () => {
    const loadOlder = jest.fn();
    mockUseMessageThread.mockReturnValue(
      readyThreadResult({
        connection: 'disconnected',
        refreshWarning: 'Could not refresh messages',
        unreadWarning: 'Could not clear unread messages',
        paginationError: 'Could not load older messages',
        loadOlder,
      })
    );
    const { rerender } = render(<ConversationScreen />);

    expect(screen.getByText(/^Hello/)).toBeTruthy();
    expect(screen.getByText('Live updates unavailable')).toBeTruthy();
    expect(screen.getByText('Could not refresh messages')).toBeTruthy();
    expect(screen.getByText('Could not clear unread messages')).toBeTruthy();
    expect(screen.getByText('Could not load older messages')).toBeTruthy();
    fireEvent.press(
      screen.getByRole('button', { name: 'Retry loading older messages' })
    );
    expect(loadOlder).toHaveBeenCalledTimes(1);

    mockUseMessageThread.mockReturnValue(
      readyThreadResult({ loadingOlder: true, hasOlder: true })
    );
    rerender(<ConversationScreen />);
    expect(screen.getByLabelText('Loading older messages')).toBeTruthy();
  });

  it('resets the hook scope when the selected account changes', () => {
    const { rerender } = render(<ConversationScreen />);

    mockUseReadyAuth.mockReturnValue(readyAuthValue(OTHER_BRANCH_ID));
    rerender(<ConversationScreen />);

    expect(mockUseMessageThread).toHaveBeenLastCalledWith(
      expect.objectContaining({ accountId: OTHER_BRANCH_ID })
    );
  });
});
