import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Platform,
  View,
} from 'react-native';

import { accountFormatters } from '../../../core/account-formatters';
import {
  Button,
  ErrorState,
  LoadingState,
  Notice,
  ScreenSafeAreaView,
  Text,
} from '../../../ui';
import { useReadyAuth } from '../../auth/auth-context';
import { ConversationComposer } from '../components/conversation-composer';
import { ClosedWindowBar } from '../components/closed-window-bar';
import { ConversationHeader } from '../components/conversation-header';
import { MessageActionSheet } from '../components/message-action-sheet';
import { MessageBubble } from '../components/message-bubble';
import { TemplatePicker } from '../components/template-picker';
import {
  canUseConversationOutbound,
  resolveConversationActions,
  SERVICE_WINDOW_MS,
  type ActionBlocker,
  type ConversationActionState,
} from '../conversation-actions';
import {
  buildThreadItems,
  messagePreview,
  threadDateLabel,
} from '../inbox-format';
import { useInboxRealtimeFeed } from '../inbox-realtime-provider';
import { useAccountCalendarClock } from '../use-account-calendar-clock';
import {
  CONVERSATION_ID as LOCAL_LAYOUT_CONVERSATION_ID,
  createLocalConversationLayoutFixture,
  LOCAL_LAYOUT_FIXTURE,
} from '../inbox-test-fixtures';
import type { InboxMessage, ThreadDisplayItem } from '../inbox-types';
import { setMessageReaction } from '../reaction-client';
import {
  mobileReactionRepository,
  type ReactionRepository,
} from '../reaction-repository';
import { templateSendUncertaintyStore } from '../template-send-uncertainty';
import { useMessageReactions } from '../use-message-reactions';
import {
  useMessageThread,
  type MessageThreadOutboundDependencies,
  type UseMessageThreadOptions,
} from '../use-message-thread';

export const STICK_TO_BOTTOM_PX = 120;
export const LOAD_OLDER_THRESHOLD_PX = 80;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const SEND_READINESS_BLOCKER: ActionBlocker = {
  kind: 'provider',
  title: 'WhatsApp is unavailable',
  reason:
    'Could not verify sending setup for this conversation. Pull to refresh and try again.',
};

type TemplateSendSafetyState = 'loading' | 'clear' | 'unknown' | 'error';

export function distanceFromBottom(
  contentHeight: number,
  viewportHeight: number,
  offsetY: number
): number {
  return Math.max(0, contentHeight - viewportHeight - offsetY);
}

export function shouldFollowLatest(
  previousLatestId: string | null,
  nextLatestId: string | null,
  previousItemCount: number,
  nextItemCount: number,
  wasNearBottom: boolean
): boolean {
  return (
    nextLatestId !== null &&
    previousLatestId !== nextLatestId &&
    nextItemCount > previousItemCount &&
    wasNearBottom
  );
}

export function shouldLoadOlder(
  offsetY: number,
  hasOlder: boolean,
  loadingOlder: boolean,
  paginationError: string | null
): boolean {
  return (
    offsetY <= LOAD_OLDER_THRESHOLD_PX &&
    hasOlder &&
    !loadingOlder &&
    paginationError === null
  );
}

function routeConversationId(value: string | string[] | undefined) {
  return typeof value === 'string' && UUID_PATTERN.test(value) ? value : null;
}

interface ConversationScaffoldProps {
  avatarUrl?: string | null;
  children: ReactNode;
  name: string;
  subtitle?: string;
}

function ConversationScaffold({
  avatarUrl = null,
  children,
  name,
  subtitle = 'WhatsApp conversation',
}: ConversationScaffoldProps) {
  const router = useRouter();

  return (
    <ScreenSafeAreaView className="bg-inbox-chrome" edges={['top']}>
      <Stack.Screen options={{ headerShown: false, title: name }} />
      <ConversationHeader
        avatarUrl={avatarUrl}
        name={name}
        onBack={() => router.back()}
        subtitle={subtitle}
      />
      <ScreenSafeAreaView
        className="bg-chat-canvas flex-1 overflow-hidden rounded-t-[28px]"
        edges={['bottom']}
      >
        {children}
      </ScreenSafeAreaView>
    </ScreenSafeAreaView>
  );
}

function UnavailableConversation() {
  const router = useRouter();

  return (
    <ConversationScaffold name="Conversation">
      <View className="flex-1 items-center justify-center gap-4 px-5 py-12">
        <View accessibilityRole="alert" className="items-center gap-1">
          <Text className="text-foreground text-center text-base font-semibold">
            Conversation is unavailable
          </Text>
          <Text className="text-muted text-center text-sm">
            It may have been removed or may not belong to this account.
          </Text>
        </View>
        <Button
          accessibilityLabel="Return to Inbox"
          className="min-h-12"
          onPress={() => router.replace('/(app)')}
          size="sm"
          variant="ghost"
        >
          Return to Inbox
        </Button>
      </View>
    </ConversationScaffold>
  );
}

interface ConversationThreadProps {
  accountId: string;
  conversationId: string;
  currentUserId: string;
  role: ReturnType<typeof useReadyAuth>['state']['branch']['role'];
  branchStatus: ReturnType<
    typeof useReadyAuth
  >['state']['branch']['branch_status'];
  account: ReturnType<typeof useReadyAuth>['state']['account'];
  outbound?: MessageThreadOutboundDependencies;
  reactionDependencies?: {
    repository: ReactionRepository;
    mutate(messageId: string, emoji: string): Promise<void>;
  };
  recoverUnauthorizedSession(): Promise<void>;
  threadDependencies?: Partial<
    Pick<
      UseMessageThreadOptions,
      'conversations' | 'messages' | 'templates' | 'realtime'
    >
  >;
}

interface FailedMessageRetryProps {
  onRetry(temporaryId: string): Promise<unknown>;
  temporaryId: string;
}

function FailedMessageRetry({ onRetry, temporaryId }: FailedMessageRetryProps) {
  const mounted = useRef(true);
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);

  useEffect(
    () => () => {
      mounted.current = false;
    },
    []
  );

  const retry = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    try {
      await onRetry(temporaryId);
    } finally {
      inFlight.current = false;
      if (mounted.current) setPending(false);
    }
  };

  return (
    <View className="items-end px-1 pt-1">
      <Button
        accessibilityLabel="Retry failed message"
        disabled={pending}
        loading={pending}
        onPress={retry}
        size="sm"
        variant="ghost"
      >
        Retry
      </Button>
    </View>
  );
}

function ConversationThread({
  accountId,
  conversationId,
  currentUserId,
  role,
  branchStatus,
  account,
  outbound,
  reactionDependencies,
  recoverUnauthorizedSession,
  threadDependencies,
}: ConversationThreadProps) {
  const providerRealtime = useInboxRealtimeFeed();
  const realtime = threadDependencies?.realtime ?? providerRealtime;
  const outboundAllowed = canUseConversationOutbound(role, branchStatus);
  const mutateReaction = useCallback(
    (messageId: string, emoji: string) =>
      setMessageReaction(
        { accountId, messageId, emoji },
        { recoverUnauthorizedSession }
      ),
    [accountId, recoverUnauthorizedSession]
  );
  const reactions = useMessageReactions({
    accountId,
    conversationId,
    currentUserId,
    canMutate: outboundAllowed,
    realtime,
    repository: reactionDependencies?.repository ?? mobileReactionRepository,
    mutate: reactionDependencies?.mutate ?? mutateReaction,
  });
  const thread = useMessageThread({
    accountId,
    conversationId,
    role,
    conversations: threadDependencies?.conversations,
    messages: threadDependencies?.messages,
    templates: threadDependencies?.templates,
    realtime,
    outbound,
  });
  const fmt = accountFormatters(account);
  const listRef = useRef<FlatList<ThreadDisplayItem>>(null);
  const initialPositionedRef = useRef(false);
  const listViewportHeightRef = useRef<number | null>(null);
  const keyboardOffsetMountedRef = useRef(true);
  const keyboardOffsetRequestRef = useRef(0);
  const stickToBottomRef = useRef(true);
  const topLoadTriggeredRef = useRef(false);
  const previousItemsRef = useRef({
    count: thread.items.length,
    latestId: thread.items.at(-1)?.id ?? null,
  });
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const [templatePickerFeed, setTemplatePickerFeed] = useState<
    typeof realtime | null
  >(null);
  const [templateSendSafety, setTemplateSendSafety] =
    useState<TemplateSendSafetyState>('loading');
  const [templateSafetyCheckNonce, setTemplateSafetyCheckNonce] = useState(0);
  const [actionClockMs, setActionClockMs] = useState(() => Date.now());
  const calendarClock = useAccountCalendarClock(fmt.config.timeZone);
  const [keyboardVerticalOffset, setKeyboardVerticalOffset] = useState(0);
  const [composerStaged, setComposerStaged] = useState(false);
  const [replySelection, setReplySelection] = useState<{
    accountId: string;
    conversationId: string;
    message: InboxMessage;
  } | null>(null);
  const [actionSelection, setActionSelection] = useState<{
    accountId: string;
    conversationId: string;
    messageId: string;
  } | null>(null);
  const latestId = thread.items.at(-1)?.id ?? null;
  const itemCount = thread.items.length;
  const firstId = thread.items.at(0)?.id ?? null;
  const displayItems = buildThreadItems(thread.items, (value) =>
    threadDateLabel(value, fmt, calendarClock)
  );
  const title =
    thread.conversation?.contact.name?.trim() ||
    (thread.conversation
      ? fmt.phone(thread.conversation.contact.phone)
      : 'Conversation');
  const headerSubtitle = thread.conversation?.contact.name?.trim()
    ? fmt.phone(thread.conversation.contact.phone)
    : 'WhatsApp conversation';
  const selectedReply =
    replySelection?.accountId === accountId &&
    replySelection.conversationId === conversationId
      ? replySelection.message
      : null;
  const composerReplyTarget = selectedReply
    ? {
        messageId: selectedReply.id,
        authorLabel: selectedReply.senderType === 'customer' ? title : 'You',
        preview: messagePreview(selectedReply),
      }
    : null;
  const messagesById = new Map(thread.items.map((item) => [item.id, item]));
  const reactionsByMessageId = new Map<string, typeof reactions.reactions>();
  for (const reaction of reactions.reactions) {
    const grouped = reactionsByMessageId.get(reaction.messageId) ?? [];
    grouped.push(reaction);
    reactionsByMessageId.set(reaction.messageId, grouped);
  }
  const readyLatestInboundAt =
    thread.sendReadiness.status === 'ready'
      ? thread.sendReadiness.latestInboundAt
      : null;
  const renderClockMs = new Date().getTime();
  let actionState: ConversationActionState | null = null;
  if (outboundAllowed && thread.sendReadiness.status === 'error') {
    actionState = { kind: 'blocked', blocker: SEND_READINESS_BLOCKER };
  } else if (
    thread.sendReadiness.status === 'ready' &&
    thread.sendReadiness.connectionReadiness
  ) {
    actionState = resolveConversationActions({
      role,
      branchStatus,
      now: new Date(Math.max(actionClockMs, renderClockMs)),
      latestInboundAt: thread.sendReadiness.latestInboundAt,
      templateReadiness: thread.sendReadiness.templateReadiness,
      connectionReadiness: thread.sendReadiness.connectionReadiness,
    });
  }
  const templateSafetyRequired = actionState?.kind === 'closed_template';
  const templatePickerOpen =
    templateSafetyRequired && templatePickerFeed === realtime;
  const selectedActionMessage =
    outboundAllowed &&
    actionSelection?.accountId === accountId &&
    actionSelection.conversationId === conversationId
      ? (messagesById.get(actionSelection.messageId) ?? null)
      : null;
  const actionableMessage =
    selectedActionMessage &&
    !selectedActionMessage.id.startsWith('temp:') &&
    selectedActionMessage.status !== 'sending' &&
    selectedActionMessage.status !== 'failed' &&
    selectedActionMessage.providerMessageId
      ? selectedActionMessage
      : null;

  useEffect(() => {
    keyboardOffsetMountedRef.current = true;
    return () => {
      keyboardOffsetMountedRef.current = false;
      keyboardOffsetRequestRef.current += 1;
    };
  }, []);

  useEffect(() => {
    if (!templateSafetyRequired) return;
    let cancelled = false;
    void (async () => {
      try {
        const hasMarker = await templateSendUncertaintyStore.hasMarker(
          accountId,
          conversationId
        );
        if (!cancelled) {
          setTemplateSendSafety(hasMarker ? 'unknown' : 'clear');
        }
      } catch {
        if (!cancelled) setTemplateSendSafety('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    accountId,
    conversationId,
    templateSafetyCheckNonce,
    templateSafetyRequired,
  ]);

  useEffect(() => {
    if (!outboundAllowed || readyLatestInboundAt === null) return;
    const latestInboundMs = Date.parse(readyLatestInboundAt);
    if (!Number.isFinite(latestInboundMs)) return;
    const boundaryMs = latestInboundMs + SERVICE_WINDOW_MS;
    const delayMs = boundaryMs - Date.now();
    if (delayMs <= 0) return;
    const timeout = setTimeout(() => setActionClockMs(boundaryMs), delayMs);
    return () => clearTimeout(timeout);
  }, [outboundAllowed, readyLatestInboundAt]);

  useEffect(() => {
    const previousItems = previousItemsRef.current;
    previousItemsRef.current = { count: itemCount, latestId };
    if (
      initialPositionedRef.current &&
      shouldFollowLatest(
        previousItems.latestId,
        latestId,
        previousItems.count,
        itemCount,
        stickToBottomRef.current
      )
    ) {
      listRef.current?.scrollToEnd({ animated: true });
    }
  }, [itemCount, latestId]);

  useEffect(() => {
    if (!thread.loadingOlder) topLoadTriggeredRef.current = false;
  }, [firstId, thread.loadingOlder]);

  if (thread.status === 'loading') {
    return (
      <ConversationScaffold name={title}>
        <View className="flex-1 items-center justify-center px-5 py-12">
          <LoadingState label="Loading messages" />
        </View>
      </ConversationScaffold>
    );
  }

  if (thread.status === 'error') {
    return (
      <ConversationScaffold name={title}>
        <View className="flex-1 justify-center px-5 py-12">
          <ErrorState
            title={thread.error ?? 'Could not load messages'}
            message="Check your connection and try again."
            onRetry={thread.refresh}
          />
        </View>
      </ConversationScaffold>
    );
  }

  if (thread.status === 'unavailable' || !thread.conversation) {
    return <UnavailableConversation />;
  }
  const readyConversation = thread.conversation;

  const listHeader = () => {
    if (thread.loadingOlder) {
      return (
        <View className="items-center px-5 py-4">
          <ActivityIndicator accessibilityLabel="Loading older messages" />
        </View>
      );
    }

    if (thread.paginationError) {
      return (
        <View
          accessibilityRole="alert"
          className="items-center gap-3 px-5 py-4"
        >
          <Text className="text-foreground text-center text-sm">
            Could not load older messages
          </Text>
          <Button
            accessibilityLabel="Retry loading older messages"
            className="min-h-12"
            onPress={thread.loadOlder}
            size="sm"
            variant="ghost"
          >
            Retry loading older messages
          </Button>
        </View>
      );
    }

    return null;
  };

  const renderItem = ({ item }: { item: ThreadDisplayItem }) => {
    if (item.kind === 'date') {
      return (
        <View className="items-center px-3 py-3">
          <Text
            className="text-chat-meta text-xs font-medium"
            testID="conversation-date-separator"
          >
            {item.label}
          </Text>
        </View>
      );
    }

    const retryableTemporaryId =
      outboundAllowed &&
      item.message.status === 'failed' &&
      item.message.safeToRetry === true &&
      item.message.senderType === 'agent' &&
      item.message.id.startsWith('temp:')
        ? item.message.id
        : null;
    const mediaMessage = ['image', 'video', 'document', 'audio'].includes(
      item.message.contentType
    );
    const composerOwnsRetry = mediaMessage && composerStaged;
    const parent = item.message.replyToMessageId
      ? messagesById.get(item.message.replyToMessageId)
      : null;
    const replyQuote = item.message.replyToMessageId
      ? parent
        ? {
            authorLabel: parent.senderType === 'customer' ? title : 'You',
            preview: messagePreview(parent),
          }
        : { unavailable: true as const }
      : undefined;
    const canReply =
      actionState?.kind === 'open_text' &&
      !item.message.id.startsWith('temp:') &&
      item.message.status !== 'sending' &&
      item.message.status !== 'failed';
    const canReact =
      outboundAllowed &&
      !item.message.id.startsWith('temp:') &&
      item.message.status !== 'sending' &&
      item.message.status !== 'failed' &&
      item.message.providerMessageId !== null;
    return (
      <View>
        <MessageBubble
          currentUserId={currentUserId}
          formattedTime={fmt.time(item.message.createdAt)}
          message={item.message}
          onOpenActions={
            canReact
              ? () =>
                  setActionSelection({
                    accountId,
                    conversationId,
                    messageId: item.message.id,
                  })
              : undefined
          }
          onReply={
            canReply
              ? () =>
                  setReplySelection({
                    accountId,
                    conversationId,
                    message: item.message,
                  })
              : undefined
          }
          onToggleReaction={
            canReact
              ? (emoji) => {
                  void reactions.toggleReaction(item.message.id, emoji);
                }
              : undefined
          }
          reactionPending={reactions.pendingMessageIds.has(item.message.id)}
          reactions={reactionsByMessageId.get(item.message.id) ?? []}
          replyQuote={replyQuote}
          startsRun={item.startsRun}
        />
        {retryableTemporaryId && !composerOwnsRetry ? (
          <FailedMessageRetry
            onRetry={mediaMessage ? thread.retryMedia : thread.retryText}
            temporaryId={retryableTemporaryId}
          />
        ) : null}
      </View>
    );
  };

  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const nearBottom =
      distanceFromBottom(
        contentSize.height,
        layoutMeasurement.height,
        contentOffset.y
      ) <= STICK_TO_BOTTOM_PX;
    stickToBottomRef.current = nearBottom;
    setShowJumpToLatest(!nearBottom);

    if (
      !topLoadTriggeredRef.current &&
      shouldLoadOlder(
        contentOffset.y,
        thread.hasOlder,
        thread.loadingOlder,
        thread.paginationError
      )
    ) {
      topLoadTriggeredRef.current = true;
      thread.loadOlder();
    }
  };

  const jumpToLatest = () => {
    stickToBottomRef.current = true;
    setShowJumpToLatest(false);
    listRef.current?.scrollToEnd({ animated: false });
  };

  const handleListLayout = (event: LayoutChangeEvent) => {
    const nextHeight = event.nativeEvent.layout.height;
    const previousHeight = listViewportHeightRef.current;
    listViewportHeightRef.current = nextHeight;
    if (
      previousHeight === null ||
      previousHeight === nextHeight ||
      !initialPositionedRef.current ||
      !stickToBottomRef.current
    ) {
      return;
    }
    listRef.current?.scrollToEnd({ animated: false });
  };

  const measureKeyboardContainer = (event: LayoutChangeEvent) => {
    const target = event.currentTarget;
    const request = ++keyboardOffsetRequestRef.current;
    target.measureInWindow((_x, y) => {
      if (
        !keyboardOffsetMountedRef.current ||
        request !== keyboardOffsetRequestRef.current ||
        !Number.isFinite(y)
      ) {
        return;
      }
      const nextOffset = Math.max(0, y);
      setKeyboardVerticalOffset((current) =>
        current === nextOffset ? current : nextOffset
      );
    });
  };

  const markTemplateAttempt = async () => {
    try {
      await templateSendUncertaintyStore.mark(accountId, conversationId);
      setTemplateSendSafety('unknown');
    } catch (error) {
      setTemplateSendSafety('error');
      throw error;
    }
  };

  const clearTemplateAttempt = async () => {
    try {
      await templateSendUncertaintyStore.clear(accountId, conversationId);
      setTemplateSendSafety('clear');
    } catch (error) {
      setTemplateSendSafety('error');
      throw error;
    }
  };

  const actionFooter = (() => {
    if (
      !actionState ||
      actionState.kind === 'viewer' ||
      actionState.kind === 'inactive_branch' ||
      actionState.kind === 'loading'
    ) {
      return null;
    }
    if (actionState.kind === 'open_text') {
      return (
        <ConversationComposer
          accountId={accountId}
          recoverUnauthorizedSession={outbound?.recoverUnauthorizedSession}
          onOpenTemplates={() => setTemplatePickerFeed(realtime)}
          onRetry={thread.retryText}
          onRetryMedia={thread.retryMedia}
          onDismissReply={() => setReplySelection(null)}
          onReplySent={(replyToMessageId) =>
            setReplySelection((current) =>
              current?.conversationId === conversationId &&
              current.message.id === replyToMessageId
                ? null
                : current
            )
          }
          onSend={thread.sendText}
          onSendMedia={thread.sendMedia}
          onStagedChange={setComposerStaged}
          replyTarget={composerReplyTarget}
        />
      );
    }
    if (actionState.kind === 'closed_template') {
      if (composerStaged) {
        return (
          <ConversationComposer
            accountId={accountId}
            recoverUnauthorizedSession={outbound?.recoverUnauthorizedSession}
            onOpenTemplates={() => setTemplatePickerFeed(realtime)}
            onRetry={thread.retryText}
            onRetryMedia={thread.retryMedia}
            onDismissReply={() => setReplySelection(null)}
            onReplySent={(replyToMessageId) =>
              setReplySelection((current) =>
                current?.conversationId === conversationId &&
                current.message.id === replyToMessageId
                  ? null
                  : current
              )
            }
            onSend={thread.sendText}
            onSendMedia={thread.sendMedia}
            onStagedChange={setComposerStaged}
            replyTarget={composerReplyTarget}
            sessionExpired
          />
        );
      }
      if (templateSendSafety === 'loading') {
        return (
          <View
            className="bg-inbox-panel px-3 py-2"
            testID="template-send-safety-loading"
          >
            <Notice loading>Checking template send safety…</Notice>
          </View>
        );
      }
      if (templateSendSafety === 'error') {
        return (
          <View
            className="bg-inbox-panel px-3 py-2"
            testID="template-send-safety-error"
          >
            <Notice
              action={
                <Button
                  accessibilityLabel="Check template send safety again"
                  className="self-start"
                  onPress={() => {
                    setTemplateSendSafety('loading');
                    setTemplateSafetyCheckNonce((value) => value + 1);
                  }}
                  size="sm"
                  variant="ghost"
                >
                  Check again
                </Button>
              }
              symbol="exclamationmark.triangle"
              title="Template sending is locked"
            >
              Could not verify the previous template send status. Check again
              before sending.
            </Notice>
          </View>
        );
      }
      return (
        <ClosedWindowBar
          onOpenTemplates={() => setTemplatePickerFeed(realtime)}
        />
      );
    }
    return (
      <View
        className="bg-inbox-panel px-3 py-2"
        testID="conversation-action-blocker"
      >
        <Notice
          action={
            <Button
              accessibilityLabel="Retry send setup"
              className="self-start"
              disabled={thread.refreshing}
              loading={thread.refreshing}
              onPress={thread.refresh}
              size="sm"
              variant="ghost"
            >
              Check again
            </Button>
          }
          symbol="exclamationmark.triangle"
          title={actionState.blocker.title}
        >
          {actionState.blocker.reason}
        </Notice>
      </View>
    );
  })();

  return (
    <ConversationScaffold
      avatarUrl={readyConversation.contact.avatarUrl}
      name={title}
      subtitle={headerSubtitle}
    >
      <View
        className="flex-1"
        collapsable={false}
        onLayout={measureKeyboardContainer}
        testID="conversation-keyboard-offset-container"
      >
        {thread.connection === 'disconnected' ? (
          <Notice
            className="mx-4 mt-3"
            symbol="exclamationmark.triangle"
            title="Live updates unavailable"
          >
            Pull to refresh while the connection recovers.
          </Notice>
        ) : null}

        {/*
         * These three were bare centred text with no container, sitting
         * directly under a banner that was a full card. Centred grey text in a
         * thread reads as a system message — the idiom for "messages are
         * encrypted", not for "the thing you just did failed" — so a real
         * failure was styled quieter than the connection notice above it.
         */}
        {thread.unreadWarning ? (
          <Notice
            className="mx-4 mt-3"
            symbol="exclamationmark.triangle"
          >
            Could not clear unread messages
          </Notice>
        ) : null}

        {thread.refreshWarning ? (
          <Notice
            className="mx-4 mt-3"
            symbol="exclamationmark.triangle"
            tone="danger"
          >
            {thread.refreshWarning}
          </Notice>
        ) : null}

        {reactions.error ? (
          <Notice
            className="mx-4 mt-3"
            symbol="exclamationmark.triangle"
            tone="danger"
          >
            {reactions.error}
          </Notice>
        ) : null}

        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          className="flex-1"
          keyboardVerticalOffset={keyboardVerticalOffset}
          testID="conversation-keyboard-avoiding-view"
        >
          <View className="relative flex-1">
            <FlatList
              className="bg-chat-canvas"
              contentContainerClassName="grow px-3 pt-1 pb-3"
              data={displayItems}
              keyExtractor={(item) => item.key}
              ListEmptyComponent={
                <View className="flex-1 items-center justify-center px-5 py-12">
                  <Text className="text-foreground text-base font-semibold">
                    No messages yet
                  </Text>
                </View>
              }
              ListHeaderComponent={listHeader}
              maintainVisibleContentPosition={{ minIndexForVisible: 1 }}
              onLayout={handleListLayout}
              onContentSizeChange={() => {
                if (initialPositionedRef.current) return;
                initialPositionedRef.current = true;
                listRef.current?.scrollToEnd({ animated: false });
              }}
              onRefresh={thread.refresh}
              onScroll={onScroll}
              ref={listRef}
              refreshing={thread.refreshing}
              renderItem={renderItem}
              scrollEventThrottle={16}
              testID="message-list"
            />

            {showJumpToLatest ? (
              <View
                className="absolute right-4 bottom-4"
                pointerEvents="box-none"
              >
                <Button
                  accessibilityLabel="Jump to latest"
                  className="min-h-12"
                  onPress={jumpToLatest}
                  size="sm"
                  variant="ghost"
                >
                  Jump to latest
                </Button>
              </View>
            ) : null}
          </View>
          {actionFooter}
        </KeyboardAvoidingView>
      </View>

      {templatePickerOpen ? (
        <TemplatePicker
          accountId={accountId}
          blocker={null}
          conversationId={conversationId}
          onAttemptStarted={markTemplateAttempt}
          onClose={() => setTemplatePickerFeed(null)}
          onOutcomeAcknowledged={clearTemplateAttempt}
          onOutcomeConfirmed={clearTemplateAttempt}
          onSent={thread.refresh}
          outcomeUnknown={templateSendSafety !== 'clear'}
          templates={thread.sendReadiness.templates}
        />
      ) : null}

      {actionableMessage ? (
        <MessageActionSheet
          onClose={() => setActionSelection(null)}
          onReact={(emoji) => {
            void reactions.setReaction(actionableMessage.id, emoji);
          }}
          onReply={
            actionState?.kind === 'open_text'
              ? () =>
                  setReplySelection({
                    accountId,
                    conversationId,
                    message: actionableMessage,
                  })
              : undefined
          }
          preview={messagePreview(actionableMessage)}
        />
      ) : null}
    </ConversationScaffold>
  );
}

export function ConversationScreen() {
  const params = useLocalSearchParams<{
    conversationId?: string | string[];
    fixture?: string | string[];
  }>();
  const auth = useReadyAuth();
  const { state } = auth;
  const conversationId = routeConversationId(params.conversationId);

  if (!conversationId) return <UnavailableConversation />;

  const localFixture =
    __DEV__ &&
    params.fixture === LOCAL_LAYOUT_FIXTURE &&
    conversationId === LOCAL_LAYOUT_CONVERSATION_ID
      ? createLocalConversationLayoutFixture(
          state.branch.account_id,
          state.profile.id
        )
      : null;
  const standardOutbound = canUseConversationOutbound(
    state.branch.role,
    state.branch.branch_status
  )
    ? {
        senderId: state.profile.id,
        recoverUnauthorizedSession: auth.recoverUnauthorizedSession,
      }
    : undefined;

  return (
    <ConversationThread
      account={state.account}
      accountId={state.branch.account_id}
      branchStatus={state.branch.branch_status}
      conversationId={conversationId}
      currentUserId={state.session.user.id}
      key={`${state.branch.account_id}:${conversationId}`}
      outbound={localFixture?.outbound ?? standardOutbound}
      reactionDependencies={localFixture?.reactionDependencies}
      recoverUnauthorizedSession={auth.recoverUnauthorizedSession}
      role={state.branch.role}
      threadDependencies={localFixture?.threadDependencies}
    />
  );
}
