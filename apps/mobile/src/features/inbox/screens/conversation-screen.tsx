import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Text,
  View,
} from 'react-native';

import { accountFormatters } from '../../../core/account-formatters';
import {
  Button,
  ErrorState,
  LoadingState,
  ScreenSafeAreaView,
} from '../../../ui';
import { useReadyAuth } from '../../auth/auth-context';
import { MessageBubble } from '../components/message-bubble';
import { buildThreadItems } from '../inbox-format';
import { useInboxRealtimeFeed } from '../inbox-realtime-provider';
import type { ThreadDisplayItem } from '../inbox-types';
import { useMessageThread } from '../use-message-thread';

export const STICK_TO_BOTTOM_PX = 120;
export const LOAD_OLDER_THRESHOLD_PX = 80;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

function UnavailableConversation() {
  const router = useRouter();

  return (
    <ScreenSafeAreaView className="bg-background" edges={['bottom']}>
      <Stack.Screen options={{ title: 'Conversation' }} />
      <View className="flex-1 items-center justify-center gap-4 px-5 py-12">
        <View accessibilityRole="alert" className="items-center gap-1">
          <Text className="text-foreground text-center text-base font-semibold">
            Conversation is unavailable
          </Text>
          <Text className="text-muted text-center text-sm leading-5">
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
    </ScreenSafeAreaView>
  );
}

interface ConversationThreadProps {
  accountId: string;
  conversationId: string;
  role: ReturnType<typeof useReadyAuth>['state']['branch']['role'];
  account: ReturnType<typeof useReadyAuth>['state']['account'];
}

function ConversationThread({
  accountId,
  conversationId,
  role,
  account,
}: ConversationThreadProps) {
  const realtime = useInboxRealtimeFeed();
  const thread = useMessageThread({
    accountId,
    conversationId,
    role,
    realtime,
  });
  const fmt = accountFormatters(account);
  const listRef = useRef<FlatList<ThreadDisplayItem>>(null);
  const initialPositionedRef = useRef(false);
  const stickToBottomRef = useRef(true);
  const topLoadTriggeredRef = useRef(false);
  const previousItemsRef = useRef({
    count: thread.items.length,
    latestId: thread.items.at(-1)?.id ?? null,
  });
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const latestId = thread.items.at(-1)?.id ?? null;
  const itemCount = thread.items.length;
  const firstId = thread.items.at(0)?.id ?? null;
  const displayItems = buildThreadItems(thread.items, fmt.date);
  const title =
    thread.conversation?.contact.name?.trim() ||
    (thread.conversation
      ? fmt.phone(thread.conversation.contact.phone)
      : 'Conversation');

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
      <ScreenSafeAreaView className="bg-chat-canvas" edges={['bottom']}>
        <Stack.Screen options={{ title }} />
        <View className="flex-1 items-center justify-center px-5 py-12">
          <LoadingState label="Loading messages" />
        </View>
      </ScreenSafeAreaView>
    );
  }

  if (thread.status === 'error') {
    return (
      <ScreenSafeAreaView className="bg-chat-canvas" edges={['bottom']}>
        <Stack.Screen options={{ title }} />
        <View className="flex-1 justify-center px-5 py-12">
          <ErrorState
            title={thread.error ?? 'Could not load messages'}
            message="Check your connection and try again."
            onRetry={thread.refresh}
          />
        </View>
      </ScreenSafeAreaView>
    );
  }

  if (thread.status === 'unavailable' || !thread.conversation) {
    return <UnavailableConversation />;
  }

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
          <Text className="text-foreground text-center text-sm leading-5">
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
          <Text className="text-chat-meta text-xs font-medium">
            {item.label}
          </Text>
        </View>
      );
    }

    return (
      <MessageBubble
        formattedTime={fmt.time(item.message.createdAt)}
        message={item.message}
        startsRun={item.startsRun}
      />
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

  return (
    <ScreenSafeAreaView className="bg-chat-canvas" edges={['bottom']}>
      <Stack.Screen options={{ title }} />

      {thread.connection === 'disconnected' ? (
        <View
          accessible
          accessibilityLiveRegion="polite"
          accessibilityRole="alert"
          className="bg-warning-soft mx-4 mt-3 gap-1 rounded-xl p-4"
        >
          <Text className="text-warning-soft-foreground text-sm font-semibold">
            Live updates unavailable
          </Text>
          <Text className="text-warning-soft-foreground text-sm leading-5">
            Pull to refresh while the connection recovers.
          </Text>
        </View>
      ) : null}

      {thread.unreadWarning ? (
        <View
          accessible
          accessibilityLiveRegion="polite"
          accessibilityRole="alert"
          className="mx-4 mt-3"
        >
          <Text className="text-foreground text-center text-sm leading-5">
            Could not clear unread messages
          </Text>
        </View>
      ) : null}

      {thread.refreshWarning ? (
        <View
          accessible
          accessibilityLiveRegion="polite"
          accessibilityRole="alert"
          className="mx-4 mt-3"
        >
          <Text className="text-danger text-center text-sm leading-5">
            {thread.refreshWarning}
          </Text>
        </View>
      ) : null}

      <View className="relative flex-1">
        <FlatList
          className="bg-chat-canvas"
          contentContainerClassName="grow px-3 pb-4"
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
          <View className="absolute right-4 bottom-4" pointerEvents="box-none">
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
    </ScreenSafeAreaView>
  );
}

export function ConversationScreen() {
  const params = useLocalSearchParams<{ conversationId?: string | string[] }>();
  const { state } = useReadyAuth();
  const conversationId = routeConversationId(params.conversationId);

  if (!conversationId) return <UnavailableConversation />;

  return (
    <ConversationThread
      account={state.account}
      accountId={state.branch.account_id}
      conversationId={conversationId}
      key={`${state.branch.account_id}:${conversationId}`}
      role={state.branch.role}
    />
  );
}
