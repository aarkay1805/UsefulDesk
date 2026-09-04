import {
  act,
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from '@testing-library/react-native';
import { type LayoutChangeEvent, Platform } from 'react-native';

import type { ReadyAuthContextValue } from '../../auth/auth-context';
import type { AccountSummary, BranchAccount } from '../../auth/branch-types';
import type { InboxRealtimeFeed } from '../inbox-realtime-provider';
import type {
  ConnectionReadiness,
  InboxMessageReaction,
  NativeTemplate,
} from '../inbox-types';
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

const mockRouter = { back: jest.fn(), push: jest.fn(), replace: jest.fn() };
const mockUseLocalSearchParams = jest.fn();
const mockUseMessageThread = jest.fn();
const mockUseMessageReactions = jest.fn();
const mockSetReaction = jest.fn();
const mockToggleReaction = jest.fn();
const mockPostReaction = jest.fn();
const mockUseReadyAuth = jest.fn<ReadyAuthContextValue, []>();
const mockScrollToEnd = jest.fn();
const mockFocus = jest.fn();
const mockPickConversationMedia = jest.fn();
const mockUploadConversationMedia = jest.fn();
const mockDeleteConversationMedia = jest.fn();
const mockTemplateSendUncertaintyStore = {
  hasMarker: jest.fn(),
  mark: jest.fn(),
  clear: jest.fn(),
};
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
      if (typeof options?.headerTitle === 'function') {
        return (options.headerTitle as () => import('react').ReactNode)();
      }
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

jest.mock('../use-message-reactions', () => ({
  useMessageReactions: (...args: unknown[]) => mockUseMessageReactions(...args),
}));

jest.mock('../reaction-client', () => ({
  setMessageReaction: (...args: unknown[]) => mockPostReaction(...args),
}));

jest.mock('../reaction-repository', () => ({
  mobileReactionRepository: { list: jest.fn().mockResolvedValue([]) },
}));

jest.mock('../inbox-realtime-provider', () => ({
  useInboxRealtimeFeed: () => screenRealtime,
}));

jest.mock('../components/conversation-header-identity', () => ({
  ConversationHeaderIdentity: ({
    name,
    subtitle,
  }: {
    name: string;
    subtitle: string;
  }) => {
    const React = jest.requireActual('react') as typeof import('react');
    const { Text, View } = jest.requireActual(
      'react-native'
    ) as typeof import('react-native');
    return React.createElement(
      View,
      { testID: 'conversation-header-identity' },
      React.createElement(Text, null, name),
      React.createElement(Text, null, subtitle)
    );
  },
}));

jest.mock('../template-send-uncertainty', () => ({
  templateSendUncertaintyStore: {
    hasMarker: (...args: unknown[]) =>
      mockTemplateSendUncertaintyStore.hasMarker(...args),
    mark: (...args: unknown[]) =>
      mockTemplateSendUncertaintyStore.mark(...args),
    clear: (...args: unknown[]) =>
      mockTemplateSendUncertaintyStore.clear(...args),
  },
}));

jest.mock('../media-picker', () => ({
  pickConversationMedia: (...args: unknown[]) =>
    mockPickConversationMedia(...args),
}));

jest.mock('../media-upload-client', () => ({
  uploadConversationMedia: (...args: unknown[]) =>
    mockUploadConversationMedia(...args),
  deleteConversationMedia: (...args: unknown[]) =>
    mockDeleteConversationMedia(...args),
}));

jest.mock('../send-message-client', () => ({
  ...jest.requireActual('../send-message-client'),
  sendConversationMessage: jest.fn(),
}));

jest.mock('../components/message-bubble', () => {
  const React = jest.requireActual('react') as typeof import('react');
  const { Pressable, Text } = jest.requireActual(
    'react-native'
  ) as typeof import('react-native');

  return {
    MessageBubble: ({
      message: item,
      formattedTime,
      startsRun,
      currentUserId,
      onOpenActions,
      onReply,
      onToggleReaction,
      reactionPending,
      reactions,
      replyQuote,
    }: {
      message: { id: string; contentText: string | null };
      formattedTime: string;
      startsRun: boolean;
      currentUserId?: string;
      onOpenActions?: () => void;
      onReply?: () => void;
      onToggleReaction?: (emoji: string) => void;
      reactionPending?: boolean;
      reactions?: InboxMessageReaction[];
      replyQuote?:
        { authorLabel: string; preview: string } | { unavailable: true };
    }) =>
      React.createElement(
        Pressable,
        {
          accessibilityLabel: `Message ${item.id}, ${
            startsRun ? 'starts run' : 'continues run'
          }`,
          accessibilityActions:
            onReply || onOpenActions
              ? [
                  ...(onReply
                    ? [{ name: 'reply', label: 'Reply to message' }]
                    : []),
                  ...(onOpenActions
                    ? [{ name: 'react', label: 'React to message' }]
                    : []),
                ]
              : undefined,
          currentUserId,
          onAccessibilityAction: (event: {
            nativeEvent: { actionName: string };
          }) => {
            if (event.nativeEvent.actionName === 'reply') onReply?.();
            if (event.nativeEvent.actionName === 'react') onOpenActions?.();
          },
          onLongPress: onOpenActions,
          onSwipeableOpen: onReply,
          onToggleReaction,
          reactionPending,
          reactions,
          testID: `message-probe-${item.id}`,
        } as never,
        replyQuote
          ? React.createElement(
              Text,
              { testID: `reply-quote-probe-${item.id}` },
              'unavailable' in replyQuote
                ? 'Original message unavailable'
                : `${replyQuote.authorLabel}: ${replyQuote.preview}`
            )
          : null,
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
    return React.createElement(View, null, children);
  }
  MockLabel.Text = function MockLabelText({
    children,
    style,
  }: import('react').PropsWithChildren<{
    style?: import('react-native').TextStyle;
  }>) {
    currentFieldLabel = String(children);
    return React.createElement(Text, { style }, children);
  };

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
      session: {
        user: { id: '61dced19-4771-4bd4-a479-a21954bd1648' },
      } as ReadyAuthContextValue['state']['session'],
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
    sendMedia: jest.fn().mockResolvedValue({
      temporaryId: 'temp:screen-media',
      status: 'sent',
    }),
    retryMedia: jest.fn().mockResolvedValue({
      temporaryId: 'temp:screen-media',
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((next, fail) => {
    resolve = next;
    reject = fail;
  });
  return { promise, reject, resolve };
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
    mockUseMessageReactions.mockReturnValue({
      reactions: [],
      error: null,
      pendingMessageIds: new Set<string>(),
      setReaction: mockSetReaction,
      toggleReaction: mockToggleReaction,
    });
    mockSetReaction.mockResolvedValue(undefined);
    mockToggleReaction.mockResolvedValue(undefined);
    mockPostReaction.mockResolvedValue(undefined);
    mockTemplateSendUncertaintyStore.hasMarker.mockResolvedValue(false);
    mockTemplateSendUncertaintyStore.mark.mockResolvedValue(undefined);
    mockTemplateSendUncertaintyStore.clear.mockResolvedValue(undefined);
    mockPickConversationMedia.mockResolvedValue({
      kind: 'image',
      uri: 'file:///cache/member.jpg',
      name: 'member.jpg',
      mimeType: 'image/jpeg',
      size: 1024,
    });
    mockUploadConversationMedia.mockReturnValue({
      promise: Promise.resolve({
        path: `account-${BRANCH_ID}/1700000000000-member.jpg`,
        publicUrl: 'https://cdn.example.test/member.jpg',
      }),
      abort: jest.fn(),
    });
    mockDeleteConversationMedia.mockResolvedValue(undefined);
  });

  it('opens actions on long press and stages replies from the sheet or Reply accessibility action', () => {
    render(<ConversationScreen />);

    fireEvent(screen.getByTestId(`message-probe-${MESSAGE_1_ID}`), 'longPress');
    expect(screen.getByText('Message actions')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Reply to message' }));
    expect(screen.getAllByText('Asha Rao')).toHaveLength(3);
    expect(screen.getByRole('button', { name: 'Dismiss reply' })).toBeTruthy();

    fireEvent(
      screen.getByTestId(`message-probe-${MESSAGE_2_ID}`),
      'accessibilityAction',
      { nativeEvent: { actionName: 'reply' } }
    );
    expect(screen.getByText('You')).toBeTruthy();
    expect(screen.getAllByText('How can I help?')).toHaveLength(2);
    expect(screen.getAllByText('Asha Rao')).toHaveLength(2);
  });

  it('keeps a replacement target when an older text reply settles and dismisses only the quote', async () => {
    const attempt = deferred<{
      temporaryId: string;
      status: 'sent';
    }>();
    const sendText = jest.fn().mockReturnValue(attempt.promise);
    mockUseMessageThread.mockReturnValue(readyThreadResult({ sendText }));
    render(<ConversationScreen />);

    fireEvent(
      screen.getByTestId(`message-probe-${MESSAGE_1_ID}`),
      'accessibilityAction',
      { nativeEvent: { actionName: 'reply' } }
    );
    fireEvent.changeText(screen.getByLabelText('Message'), 'Replying now');
    fireEvent.press(screen.getByRole('button', { name: 'Send message' }));
    expect(sendText).toHaveBeenCalledWith('Replying now', MESSAGE_1_ID);

    fireEvent(
      screen.getByTestId(`message-probe-${MESSAGE_2_ID}`),
      'accessibilityAction',
      { nativeEvent: { actionName: 'reply' } }
    );
    await act(async () => {
      attempt.resolve({ temporaryId: 'temp:reply', status: 'sent' });
      await attempt.promise;
    });
    expect(screen.getByText('You')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Dismiss reply' }));
    expect(screen.queryByText('You')).toBeNull();
    expect(screen.getByLabelText('Message')).toBeTruthy();
  });

  it('retains the reply target after a failed text send', async () => {
    const sendText = jest.fn().mockResolvedValue({
      temporaryId: 'temp:reply-failed',
      status: 'failed',
      safeToRetry: true,
      message: 'Too many send attempts.',
    });
    mockUseMessageThread.mockReturnValue(readyThreadResult({ sendText }));
    render(<ConversationScreen />);

    fireEvent(
      screen.getByTestId(`message-probe-${MESSAGE_1_ID}`),
      'accessibilityAction',
      { nativeEvent: { actionName: 'reply' } }
    );
    fireEvent.changeText(screen.getByLabelText('Message'), 'Replying now');
    fireEvent.press(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() =>
      expect(screen.getAllByText('Asha Rao')).toHaveLength(3)
    );
    expect(screen.getByText('Too many send attempts.')).toBeTruthy();
  });

  it('passes the staged target into a media reply', async () => {
    const sendMedia = jest.fn().mockResolvedValue({
      temporaryId: 'temp:media-reply',
      status: 'sent',
    });
    mockUseMessageThread.mockReturnValue(readyThreadResult({ sendMedia }));
    render(<ConversationScreen />);

    fireEvent(
      screen.getByTestId(`message-probe-${MESSAGE_1_ID}`),
      'accessibilityAction',
      { nativeEvent: { actionName: 'reply' } }
    );
    fireEvent.press(screen.getByRole('button', { name: 'Attach media' }));
    fireEvent.press(screen.getByRole('button', { name: 'Choose photo' }));
    fireEvent.press(
      await screen.findByRole('button', { name: 'Send attachment' })
    );

    await waitFor(() =>
      expect(sendMedia).toHaveBeenCalledWith(
        expect.objectContaining({ replyToMessageId: MESSAGE_1_ID })
      )
    );
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Dismiss reply' })).toBeNull()
    );
  });

  it('renders parent previews for replies and the unavailable fallback when absent', () => {
    mockUseMessageThread.mockReturnValue(
      readyThreadResult({
        items: [
          ...readyThreadResult().items,
          message({
            id: MESSAGE_3_ID,
            senderType: 'agent',
            contentText: 'Loaded reply',
            replyToMessageId: MESSAGE_1_ID,
          }),
          message({
            id: 'b064a9e3-4a49-4bd0-bb68-84bedaf1987a',
            senderType: 'customer',
            contentText: 'Orphan reply',
            replyToMessageId: '1796cc96-2e52-40c8-9baa-da010a1fbd41',
          }),
        ],
      })
    );
    render(<ConversationScreen />);

    expect(
      screen.getByTestId(`reply-quote-probe-${MESSAGE_3_ID}`)
    ).toHaveTextContent('Asha Rao: Hello');
    expect(screen.getByText('Original message unavailable')).toBeTruthy();
  });

  it('blocks optimistic rows but keeps reactions available after the service window closes', async () => {
    const optimisticId = 'temp:not-a-reply-target';
    mockUseMessageThread.mockReturnValue(
      readyThreadResult({
        items: [
          ...readyThreadResult().items,
          message({ id: optimisticId, senderType: 'agent', status: 'sending' }),
        ],
      })
    );
    const view = render(<ConversationScreen />);
    expect(
      screen.getByTestId(`message-probe-${optimisticId}`).props.onLongPress
    ).toBeUndefined();

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
    view.unmount();
    render(<ConversationScreen />);
    await screen.findByTestId('closed-window-action-bar');
    const persistedBubble = screen.getByTestId(`message-probe-${MESSAGE_1_ID}`);
    expect(persistedBubble.props.accessibilityActions).toEqual([
      { name: 'react', label: 'React to message' },
    ]);
    fireEvent(persistedBubble, 'accessibilityAction', {
      nativeEvent: { actionName: 'react' },
    });
    expect(screen.getByRole('button', { name: 'React with 👍' })).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: 'Reply to message' })
    ).toBeNull();
  });

  it('scopes reaction state, renders pills, and routes quick and pill reactions', async () => {
    const auth = readyAuthValue();
    const existingReaction: InboxMessageReaction = {
      id: '2d4bab9f-4e17-4718-9207-88e0edc9e9bf',
      messageId: MESSAGE_1_ID,
      conversationId: CONVERSATION_ID,
      actorType: 'customer',
      actorId: '0de3175d-a263-43d4-81b4-9c4e183f6295',
      emoji: '👍',
      createdAt: '2026-09-01T08:01:30.000Z',
    };
    mockUseReadyAuth.mockReturnValue(auth);
    mockUseMessageReactions.mockReturnValue({
      reactions: [existingReaction],
      error: null,
      pendingMessageIds: new Set([MESSAGE_1_ID]),
      setReaction: mockSetReaction,
      toggleReaction: mockToggleReaction,
    });

    render(<ConversationScreen />);

    const bubble = screen.getByTestId(`message-probe-${MESSAGE_1_ID}`);
    expect(bubble.props.currentUserId).toBe(auth.state.session.user.id);
    expect(bubble.props.reactions).toEqual([existingReaction]);
    expect(bubble.props.reactionPending).toBe(true);
    fireEvent(bubble, 'toggleReaction', '👍');
    expect(mockToggleReaction).toHaveBeenCalledWith(MESSAGE_1_ID, '👍');

    fireEvent(bubble, 'longPress');
    fireEvent.press(screen.getByRole('button', { name: 'React with ❤️' }));
    expect(mockSetReaction).toHaveBeenCalledWith(MESSAGE_1_ID, '❤️');

    const reactionOptions = mockUseMessageReactions.mock.calls.at(-1)?.[0];
    expect(reactionOptions).toEqual(
      expect.objectContaining({
        accountId: BRANCH_ID,
        conversationId: CONVERSATION_ID,
        currentUserId: auth.state.session.user.id,
        canMutate: true,
        realtime: screenRealtime,
      })
    );
    await reactionOptions.mutate(MESSAGE_1_ID, '❤️');
    expect(mockPostReaction).toHaveBeenCalledWith(
      {
        accountId: BRANCH_ID,
        messageId: MESSAGE_1_ID,
        emoji: '❤️',
      },
      { recoverUnauthorizedSession: auth.recoverUnauthorizedSession }
    );
  });

  it('does not offer reply actions for persisted sending or failed rows', () => {
    const persistedSendingId = 'b93e8d70-1c67-4e1e-8e4e-1d7f2cc66353';
    const persistedFailedId = '7faf4724-c3da-4ad4-b820-550d888eb32e';
    mockUseMessageThread.mockReturnValue(
      readyThreadResult({
        items: [
          ...readyThreadResult().items,
          message({
            id: persistedSendingId,
            senderType: 'agent',
            status: 'sending',
            contentText: 'Persisted sending delivery',
          }),
          message({
            id: persistedFailedId,
            senderType: 'agent',
            status: 'failed',
            contentText: 'Persisted failed delivery',
          }),
        ],
      })
    );
    render(<ConversationScreen />);

    for (const messageId of [persistedSendingId, persistedFailedId]) {
      const bubble = screen.getByTestId(`message-probe-${messageId}`);
      expect(bubble.props.accessibilityActions).toBeUndefined();
      expect(bubble.props.onLongPress).toBeUndefined();
    }
    expect(screen.queryByRole('button', { name: 'Dismiss reply' })).toBeNull();
  });

  it('keeps staged media mounted when the service window closes and routes Send to templates', async () => {
    const openThread = readyThreadResult();
    mockUseMessageThread.mockReturnValue(openThread);
    const view = render(<ConversationScreen />);
    fireEvent.press(screen.getByRole('button', { name: 'Attach media' }));
    fireEvent.press(screen.getByRole('button', { name: 'Choose photo' }));
    expect(
      await screen.findByLabelText('Photo attachment preview')
    ).toBeTruthy();
    expect(
      await screen.findByRole('button', { name: 'Send attachment' })
    ).toBeTruthy();

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
    await act(async () => {
      view.rerender(<ConversationScreen />);
      await Promise.resolve();
    });

    expect(screen.getByLabelText('Photo attachment preview')).toBeTruthy();
    expect(screen.queryByTestId('closed-window-action-bar')).toBeNull();
    fireEvent.press(screen.getByRole('button', { name: 'Send attachment' }));
    expect(openThread.sendMedia).not.toHaveBeenCalled();
    expect(await screen.findByText('Send approved template')).toBeTruthy();
  });

  it('keeps a pending native picker mounted across window closure and releases it after cancellation', async () => {
    const picker = deferred<null>();
    mockPickConversationMedia.mockReturnValueOnce(picker.promise);
    const view = render(<ConversationScreen />);
    fireEvent.press(screen.getByRole('button', { name: 'Attach media' }));
    fireEvent.press(screen.getByRole('button', { name: 'Choose photo' }));

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
    await act(async () => {
      view.rerender(<ConversationScreen />);
      await Promise.resolve();
    });

    expect(
      screen.getByRole('button', { name: 'Attach media, loading' })
    ).toBeTruthy();
    expect(screen.queryByTestId('closed-window-action-bar')).toBeNull();

    await act(async () => {
      picker.resolve(null);
      await picker.promise;
    });

    expect(await screen.findByTestId('closed-window-action-bar')).toBeTruthy();
    expect(screen.queryByLabelText('Message')).toBeNull();
  });

  it('releases a retained picker shell after a native picker error', async () => {
    const picker = deferred<null>();
    mockPickConversationMedia.mockReturnValueOnce(picker.promise);
    const view = render(<ConversationScreen />);
    fireEvent.press(screen.getByRole('button', { name: 'Attach media' }));
    fireEvent.press(screen.getByRole('button', { name: 'Choose photo' }));

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
    await act(async () => {
      view.rerender(<ConversationScreen />);
      await Promise.resolve();
    });
    expect(screen.queryByTestId('closed-window-action-bar')).toBeNull();

    await act(async () => {
      picker.reject(new Error('Native picker unavailable'));
      try {
        await picker.promise;
      } catch {
        // The composer maps the rejected native operation before releasing.
      }
    });

    expect(await screen.findByTestId('closed-window-action-bar')).toBeTruthy();
    expect(screen.queryByLabelText('Message')).toBeNull();
  });

  it('keeps composer ownership of its failed media retry while preserving an unowned row retry', async () => {
    const retryMedia = jest.fn().mockResolvedValue({
      temporaryId: 'temp:screen-media',
      status: 'sent',
    });
    const sendMedia = jest.fn().mockResolvedValue({
      temporaryId: 'temp:screen-media',
      status: 'failed',
      safeToRetry: true,
      message: 'Too many send attempts.',
    });
    mockUseMessageThread.mockReturnValue(
      readyThreadResult({
        retryMedia,
        sendMedia,
        items: [
          ...readyThreadResult().items,
          message({
            id: 'temp:screen-media',
            senderType: 'agent',
            status: 'failed',
            safeToRetry: true,
            contentType: 'image',
            mediaUrl: 'https://cdn.example.test/member.jpg',
          }),
        ],
      })
    );
    render(<ConversationScreen />);

    expect(
      screen.getByRole('button', { name: 'Retry failed message' })
    ).toBeTruthy();
    fireEvent.press(
      screen.getByRole('button', { name: 'Retry failed message' })
    );
    await waitFor(() =>
      expect(retryMedia).toHaveBeenCalledWith('temp:screen-media')
    );
    retryMedia.mockClear();
    fireEvent.press(screen.getByRole('button', { name: 'Attach media' }));
    fireEvent.press(screen.getByRole('button', { name: 'Choose photo' }));
    fireEvent.press(
      await screen.findByRole('button', { name: 'Send attachment' })
    );

    expect(
      await screen.findByRole('button', { name: 'Retry attachment' })
    ).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: 'Retry failed message' })
    ).toBeNull();
    expect(retryMedia).not.toHaveBeenCalled();
  });

  it('keeps a failed text-row retry available while a media retry is composer-owned', async () => {
    const retryText = jest.fn().mockResolvedValue({
      temporaryId: 'temp:screen-text',
      status: 'sent',
    });
    mockUseMessageThread.mockReturnValue(
      readyThreadResult({
        retryText,
        sendMedia: jest.fn().mockResolvedValue({
          temporaryId: 'temp:screen-media',
          status: 'failed',
          safeToRetry: true,
          message: 'Too many send attempts.',
        }),
        items: [
          ...readyThreadResult().items,
          message({
            id: 'temp:screen-text',
            senderType: 'agent',
            status: 'failed',
            safeToRetry: true,
            contentType: 'text',
            contentText: 'Please renew',
          }),
        ],
      })
    );
    render(<ConversationScreen />);

    fireEvent.press(screen.getByRole('button', { name: 'Attach media' }));
    fireEvent.press(screen.getByRole('button', { name: 'Choose photo' }));
    fireEvent.press(
      await screen.findByRole('button', { name: 'Send attachment' })
    );
    expect(
      await screen.findByRole('button', { name: 'Retry attachment' })
    ).toBeTruthy();

    fireEvent.press(
      screen.getByRole('button', { name: 'Retry failed message' })
    );
    await waitFor(() =>
      expect(retryText).toHaveBeenCalledWith('temp:screen-text')
    );
  });

  it('passes full unauthorized-session recovery into the production media upload', async () => {
    const auth = readyAuthValue();
    mockUseReadyAuth.mockReturnValue(auth);
    render(<ConversationScreen />);

    fireEvent.press(screen.getByRole('button', { name: 'Attach media' }));
    fireEvent.press(screen.getByRole('button', { name: 'Choose photo' }));
    await waitFor(() => expect(mockUploadConversationMedia).toHaveBeenCalled());

    expect(mockUploadConversationMedia).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: BRANCH_ID }),
      { recoverUnauthorizedSession: auth.recoverUnauthorizedSession }
    );
  });

  it('renders chronological runs in the native titled route with the open-window composer', () => {
    // The separator label is calendar-relative now (Today / Yesterday / the
    // weekday / a date), so the clock has to be pinned or this assertion
    // changes meaning as the fixtures age. Far enough past the fixture day
    // that it lands on the absolute date this test was written to check.
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-09-30T10:00:00.000Z'));
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

    expect(screen.getByTestId('conversation-header-identity')).toBeTruthy();
    expect(screen.getAllByText('Asha Rao')).not.toHaveLength(0);
    expect(screen.getByText('+919876543210')).toBeTruthy();
    expect(screen.getByText('1 Sept 2026')).toBeTruthy();
    expect(screen.getByTestId('conversation-date-separator')).toBeTruthy();
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
    fireEvent.changeText(screen.getByLabelText('Message'), 'Ready');
    expect(screen.getByRole('button', { name: 'Send message' })).toBeTruthy();
    expect(mockStackOptions.current).toEqual(
      expect.objectContaining({
        title: 'Asha Rao',
        headerShown: false,
      })
    );
    fireEvent.press(screen.getByRole('button', { name: 'Back to Inbox' }));
    expect(mockRouter.back).toHaveBeenCalledTimes(1);
    expect(mockUseMessageThread).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: BRANCH_ID,
        conversationId: CONVERSATION_ID,
        realtime: screenRealtime,
        role: 'admin',
      })
    );
    jest.useRealTimers();
  });

  it('uses fail-closed local dependencies for the development layout fixture', async () => {
    mockUseLocalSearchParams.mockReturnValue({
      conversationId: CONVERSATION_ID,
      fixture: 'local-layout',
    });

    render(<ConversationScreen />);

    const options = mockUseMessageThread.mock.calls.at(-1)?.[0];
    expect(options).toEqual(
      expect.objectContaining({
        conversations: expect.any(Object),
        messages: expect.any(Object),
        templates: expect.any(Object),
        realtime: expect.not.objectContaining(screenRealtime),
        outbound: expect.objectContaining({
          sendMessage: expect.any(Function),
        }),
      })
    );
    await expect(
      options.outbound.sendMessage({ kind: 'text' }, {})
    ).rejects.toThrow('Local layout fixture cannot send messages');
    const reactionOptions = mockUseMessageReactions.mock.calls.at(-1)?.[0];
    await expect(
      reactionOptions.repository.list(BRANCH_ID, CONVERSATION_ID)
    ).resolves.toEqual([
      expect.objectContaining({ messageId: MESSAGE_0_ID, emoji: '👍' }),
    ]);
    await expect(
      reactionOptions.mutate(MESSAGE_1_ID, '👍')
    ).resolves.toBeUndefined();
    expect(mockPostReaction).not.toHaveBeenCalled();
    expect(sendConversationMessage).not.toHaveBeenCalled();
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
    expect(mockUseMessageReactions).toHaveBeenLastCalledWith(
      expect.objectContaining({ canMutate: false })
    );
    expect(
      screen.getByTestId('message-probe-temp:viewer-failed').props
        .onToggleReaction
    ).toBeUndefined();
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
    expect(mockUseMessageReactions).toHaveBeenLastCalledWith(
      expect.objectContaining({ canMutate: false })
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
    fireEvent.changeText(screen.getByLabelText('Message'), 'Ready');
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
    expect(retries[0].props.className).toContain('min-h-12');

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

  it('closes the open service window at the exact 24-hour boundary without another render', async () => {
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
      await act(async () => {
        await Promise.resolve();
      });
      expect(screen.getByLabelText('Message')).toBeTruthy();
      act(() => jest.advanceTimersByTime(24 * 60 * 60 * 1000 - 1));
      expect(screen.getByLabelText('Message')).toBeTruthy();

      await act(async () => {
        jest.advanceTimersByTime(1);
        await Promise.resolve();
      });

      expect(screen.queryByLabelText('Message')).toBeNull();
      expect(screen.getByTestId('closed-window-action-bar')).toBeTruthy();
    } finally {
      view.unmount();
      jest.useRealTimers();
    }
  });

  it('replaces the composer with an amber closed-window bar whose only action is Send a template', async () => {
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

    const bar = await screen.findByTestId('closed-window-action-bar');
    expect(bar.props.className).toContain('bg-warning-soft');
    expect(screen.queryByLabelText('Message')).toBeNull();
    expect(
      within(bar)
        .getAllByRole('button')
        .map((button) => button.props.accessibilityLabel)
    ).toEqual(['Send a template']);
  });

  it('does not expose template sending until the durable marker check completes', async () => {
    const markerRead = deferred<boolean>();
    mockTemplateSendUncertaintyStore.hasMarker.mockReturnValueOnce(
      markerRead.promise
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

    expect(screen.getByTestId('template-send-safety-loading')).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: 'Send a template' })
    ).toBeNull();

    await act(async () => {
      markerRead.resolve(false);
      await markerRead.promise;
    });

    expect(
      await screen.findByRole('button', { name: 'Send a template' })
    ).toBeTruthy();
  });

  it('fails closed when marker hydration fails and retries the durable check explicitly', async () => {
    mockTemplateSendUncertaintyStore.hasMarker
      .mockRejectedValueOnce(new Error('SecureStore unavailable'))
      .mockResolvedValueOnce(false);
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

    expect(await screen.findByText('Template sending is locked')).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: 'Send a template' })
    ).toBeNull();

    fireEvent.press(
      screen.getByRole('button', {
        name: 'Check template send safety again',
      })
    );

    expect(
      await screen.findByRole('button', { name: 'Send a template' })
    ).toBeTruthy();
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

    fireEvent.press(
      await screen.findByRole('button', { name: 'Send a template' })
    );
    expect(screen.getByText('Send approved template')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Send template' }));

    await waitFor(() => expect(sendConversationMessage).toHaveBeenCalled());
    expect(mockTemplateSendUncertaintyStore.mark).toHaveBeenCalledWith(
      BRANCH_ID,
      CONVERSATION_ID
    );
    expect(mockTemplateSendUncertaintyStore.clear).toHaveBeenCalledWith(
      BRANCH_ID,
      CONVERSATION_ID
    );
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('Send approved template')).toBeNull();
  });

  it('keeps the template picker open when the hook returns an equivalent readiness value on rerender', async () => {
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

    fireEvent.press(
      await screen.findByRole('button', { name: 'Send a template' })
    );

    expect(screen.getByText('Send approved template')).toBeTruthy();
  });

  it('hydrates an ambiguous template outcome after remount and durably clears it only after acknowledgment', async () => {
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

    fireEvent.press(
      await screen.findByRole('button', { name: 'Send a template' })
    );
    fireEvent.press(screen.getByRole('button', { name: 'Send template' }));

    expect(
      await screen.findByText(/Delivery could not be confirmed/)
    ).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Close' }));
    view.unmount();

    mockTemplateSendUncertaintyStore.hasMarker.mockResolvedValue(true);
    render(<ConversationScreen />);
    fireEvent.press(
      await screen.findByRole('button', { name: 'Send a template' })
    );

    expect(
      screen.getByText(
        'A previous template send could not be confirmed. Check this conversation for the message before sending another.'
      )
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Send template' })).toBeNull();

    fireEvent.press(
      screen.getByRole('button', { name: 'I checked the conversation' })
    );

    expect(
      await screen.findByRole('button', { name: 'Send template' })
    ).toBeTruthy();
    expect(sendConversationMessage).toHaveBeenCalledTimes(1);
    expect(mockTemplateSendUncertaintyStore.clear).toHaveBeenCalledWith(
      BRANCH_ID,
      CONVERSATION_ID
    );
  });

  it('does not call the send service when persisting the pre-send marker fails', async () => {
    mockTemplateSendUncertaintyStore.mark.mockRejectedValueOnce(
      new Error('SecureStore unavailable')
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

    fireEvent.press(
      await screen.findByRole('button', { name: 'Send a template' })
    );
    fireEvent.press(screen.getByRole('button', { name: 'Send template' }));

    expect(await screen.findByText(/No message was sent/)).toBeTruthy();
    expect(sendConversationMessage).not.toHaveBeenCalled();
    fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByText('Template sending is locked')).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: 'Send a template' })
    ).toBeNull();
  });

  it('keeps a hydrated marker locked when acknowledgment deletion fails', async () => {
    mockTemplateSendUncertaintyStore.hasMarker.mockResolvedValue(true);
    mockTemplateSendUncertaintyStore.clear.mockRejectedValueOnce(
      new Error('SecureStore unavailable')
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

    fireEvent.press(
      await screen.findByRole('button', { name: 'Send a template' })
    );
    fireEvent.press(
      screen.getByRole('button', { name: 'I checked the conversation' })
    );

    expect(
      await screen.findByText(
        'Could not clear the send-safety lock. Sending remains locked until storage recovers.'
      )
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Send template' })).toBeNull();
    expect(sendConversationMessage).not.toHaveBeenCalled();
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

      fireEvent.press(
        await screen.findByRole('button', { name: 'Send a template' })
      );
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
      fireEvent.press(
        await screen.findByRole('button', { name: 'Send a template' })
      );

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
      within(screen.getByTestId('conversation-action-blocker'))
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
      within(screen.getByTestId('conversation-action-blocker'))
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
      within(screen.getByTestId('conversation-action-blocker'))
        .getAllByRole('button')
        .map((button) => button.props.accessibilityLabel)
    ).toEqual(['Retry send setup']);
    fireEvent.press(screen.getByRole('button', { name: 'Retry send setup' }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('measures the keyboard container window offset below the native header', async () => {
    render(<ConversationScreen />);

    const container = screen.getByTestId(
      'conversation-keyboard-offset-container'
    );
    const measureInWindow = jest.fn(
      (
        callback: Parameters<
          LayoutChangeEvent['currentTarget']['measureInWindow']
        >[0]
      ) => callback(0, 84, 390, 700)
    );
    const currentTarget = {
      measureInWindow,
    } as unknown as LayoutChangeEvent['currentTarget'];
    const layoutEvent = {
      bubbles: false,
      cancelable: false,
      currentTarget,
      defaultPrevented: false,
      eventPhase: 3,
      isDefaultPrevented: () => false,
      isPropagationStopped: () => false,
      isTrusted: true,
      nativeEvent: { layout: { height: 700, width: 390, x: 0, y: 0 } },
      persist: jest.fn(),
      preventDefault: jest.fn(),
      stopPropagation: jest.fn(),
      target: currentTarget,
      timeStamp: 0,
      type: 'layout',
    } satisfies LayoutChangeEvent;

    act(() => container.props.onLayout(layoutEvent));

    const keyboard = screen.getByTestId('conversation-keyboard-avoiding-view');
    expect(keyboard.props.behavior).toBe(
      Platform.OS === 'ios' ? 'padding' : 'height'
    );
    await waitFor(() =>
      expect(
        screen.getByTestId('conversation-keyboard-avoiding-view').props
          .keyboardVerticalOffset
      ).toBe(84)
    );
    expect(measureInWindow).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('message-list')).toBeTruthy();
    expect(screen.getByLabelText('Message')).toBeTruthy();
  });

  it('keeps runtime banners inside the stable measured keyboard container', async () => {
    const { rerender } = render(<ConversationScreen />);
    const container = screen.getByTestId(
      'conversation-keyboard-offset-container'
    );
    const currentTarget = {
      measureInWindow: (
        callback: Parameters<
          LayoutChangeEvent['currentTarget']['measureInWindow']
        >[0]
      ) => callback(0, 84, 390, 700),
    } as unknown as LayoutChangeEvent['currentTarget'];

    act(() =>
      container.props.onLayout({
        currentTarget,
        nativeEvent: { layout: { height: 700, width: 390, x: 0, y: 0 } },
        target: currentTarget,
      } as LayoutChangeEvent)
    );
    await waitFor(() =>
      expect(
        screen.getByTestId('conversation-keyboard-avoiding-view').props
          .keyboardVerticalOffset
      ).toBe(84)
    );

    mockUseMessageThread.mockReturnValue(
      readyThreadResult({ connection: 'disconnected' })
    );
    rerender(<ConversationScreen />);

    const stableContainer = screen.getByTestId(
      'conversation-keyboard-offset-container'
    );
    expect(
      stableContainer.findAll(
        (node) => node.props.children === 'Live updates unavailable'
      )
    ).not.toHaveLength(0);
    expect(
      stableContainer.findByProps({
        testID: 'conversation-keyboard-avoiding-view',
      }).props.keyboardVerticalOffset
    ).toBe(84);
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

  it('re-pins a bottom-following reader once when the viewport shrinks', () => {
    render(<ConversationScreen />);
    const list = screen.getByTestId('message-list');
    const fireListLayout = (height: number) => {
      act(() =>
        list.props.onLayout?.({
          nativeEvent: { layout: { height, width: 390, x: 0, y: 0 } },
        } as LayoutChangeEvent)
      );
    };

    fireListLayout(700);
    expect(mockScrollToEnd).not.toHaveBeenCalled();

    fireEvent(list, 'contentSizeChange', 390, 1200);
    mockScrollToEnd.mockClear();
    fireListLayout(360);

    expect(mockScrollToEnd).toHaveBeenCalledTimes(1);
    expect(mockScrollToEnd).toHaveBeenCalledWith({ animated: false });

    fireListLayout(360);
    expect(mockScrollToEnd).toHaveBeenCalledTimes(1);
  });

  it('preserves an older reader when the viewport shrinks', () => {
    render(<ConversationScreen />);
    const list = screen.getByTestId('message-list');
    const fireListLayout = (height: number) => {
      act(() =>
        list.props.onLayout?.({
          nativeEvent: { layout: { height, width: 390, x: 0, y: 0 } },
        } as LayoutChangeEvent)
      );
    };

    fireListLayout(700);
    fireEvent(list, 'contentSizeChange', 390, 1200);
    fireEvent.scroll(list, {
      nativeEvent: {
        contentOffset: { y: 100 },
        contentSize: { height: 1600, width: 390 },
        layoutMeasurement: { height: 700, width: 390 },
      },
    });
    expect(screen.getByRole('button', { name: 'Jump to latest' })).toBeTruthy();

    mockScrollToEnd.mockClear();
    fireListLayout(360);

    expect(mockScrollToEnd).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Jump to latest' })).toBeTruthy();
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
    expect(mockUseMessageReactions).toHaveBeenLastCalledWith(
      expect.objectContaining({ accountId: OTHER_BRANCH_ID })
    );
  });
});
