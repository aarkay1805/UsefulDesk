import { Stack, useRouter } from 'expo-router';
import { ActivityIndicator, FlatList, View } from 'react-native';

import { accountFormatters } from '../../../core/account-formatters';
import {
  Button,
  ErrorState,
  FilterMenu,
  type FilterMenuOption,
  LoadingState,
  ScreenSafeAreaView,
  SearchField,
  Text,
} from '../../../ui';
import { useReadyAuth } from '../../auth/auth-context';
import { InboxHeader } from '../components/inbox-header';
import { ConversationRow } from '../components/conversation-row';
import { useInboxRealtimeFeed } from '../inbox-realtime-provider';
import type { ConversationFilter, InboxConversation } from '../inbox-types';
import { conversationTimestamp } from '../inbox-format';
import { useConversationList } from '../use-conversation-list';
import { useAccountCalendarClock } from '../use-account-calendar-clock';

const LOAD_ERROR = 'Could not load conversations';
const MORE_ERROR = 'Could not load more conversations';

export function InboxScreen() {
  const router = useRouter();
  const { state } = useReadyAuth();
  const realtime = useInboxRealtimeFeed();
  const inbox = useConversationList({
    accountId: state.branch.account_id,
    realtime,
  });
  const fmt = accountFormatters(state.account);
  const calendarClock = useAccountCalendarClock(fmt.config.timeZone);

  const filters: readonly FilterMenuOption<ConversationFilter>[] = [
    { label: 'All', value: 'all' },
    {
      label: 'Unread',
      value: 'unread',
      count: inbox.unreadCount ? fmt.number(inbox.unreadCount) : undefined,
    },
  ];

  const openConversation = (conversationId: string) => {
    router.push({
      pathname: '/(app)/conversation/[conversationId]',
      params: { conversationId },
    });
  };

  const renderConversation = ({ item }: { item: InboxConversation }) => (
    <ConversationRow
      conversation={item}
      formattedPhone={fmt.phone(item.contact.phone)}
      formattedTime={
        item.lastMessageAt
          ? conversationTimestamp(item.lastMessageAt, fmt, calendarClock)
          : ''
      }
      onPress={() => openConversation(item.id)}
    />
  );

  const emptyState = () => {
    if (inbox.status === 'loading') {
      return (
        <View className="items-center px-5 py-12">
          <LoadingState label="Loading conversations" />
        </View>
      );
    }

    if (inbox.status === 'error') {
      return (
        <View className="px-5 py-8">
          <ErrorState
            title={inbox.error ?? LOAD_ERROR}
            message="Check your connection and try again."
            onRetry={inbox.refresh}
          />
        </View>
      );
    }

    return (
      <View className="items-center gap-1 px-5 py-12">
        <Text className="text-foreground text-base font-semibold">
          No conversations yet
        </Text>
        <Text className="text-muted text-center text-sm">
          New WhatsApp conversations will appear here.
        </Text>
      </View>
    );
  };

  const listFooter = () => {
    if (inbox.loadingMore) {
      return (
        <View className="items-center px-5 py-4">
          <ActivityIndicator accessibilityLabel="Loading more conversations" />
        </View>
      );
    }

    if (inbox.paginationError) {
      return (
        <View
          accessibilityRole="alert"
          className="items-center gap-3 px-5 py-4"
        >
          <Text className="text-danger text-center text-sm">
            {inbox.paginationError ?? MORE_ERROR}
          </Text>
          <Button
            accessibilityLabel="Retry loading more"
            className="min-h-12"
            onPress={inbox.loadMore}
            size="sm"
            variant="ghost"
          >
            Retry loading more
          </Button>
        </View>
      );
    }

    return null;
  };

  return (
    <ScreenSafeAreaView className="bg-inbox-chrome" edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false, title: 'Inbox' }} />
      <InboxHeader onOpenAccount={() => router.push('/(app)/account')} />

      {/*
       * Search and the scope filter act on the list, so they sit in the chrome
       * rather than inside the sheet. They also have to: heroui gives a form
       * field a white fill and a transparent border in light mode and a
       * `--surface` fill in dark, and `--inbox-panel` is exactly those two
       * values — inside the sheet the pill was its own background colour in
       * both themes, drawn only by a 6%-alpha shadow. The chrome differs from
       * the field in both directions, so the pill reads without a new token.
       */}
      <View className="px-4 pt-1 pb-3">
        <SearchField
          accessibilityLabel="Search conversations"
          onValueChange={inbox.setSearch}
          placeholder="Search conversations"
          trailingAccessory={
            <FilterMenu
              accessibilityLabel="Conversation filter"
              onValueChange={inbox.setFilter}
              options={filters}
              value={inbox.filter}
            />
          }
          value={inbox.search}
        />
      </View>

      <View className="bg-inbox-panel flex-1 overflow-hidden rounded-t-[28px]">
        {inbox.connection === 'disconnected' ? (
          <View
            accessible
            accessibilityLiveRegion="polite"
            accessibilityRole="alert"
            className="bg-warning-soft mx-4 my-3 gap-1 rounded-xl p-4"
          >
            <Text className="text-warning-soft-foreground text-sm font-semibold">
              Live updates unavailable
            </Text>
            <Text className="text-warning-soft-foreground text-sm">
              Pull to refresh while the connection recovers.
            </Text>
          </View>
        ) : null}

        {inbox.refreshWarning ? (
          <View
            accessible
            accessibilityLiveRegion="polite"
            accessibilityRole="alert"
            className="mx-4 my-3"
          >
            <Text className="text-danger text-center text-sm">
              {inbox.refreshWarning}
            </Text>
          </View>
        ) : null}

        <FlatList
          contentContainerClassName={
            inbox.items.length === 0 ? 'flex-grow' : 'pt-2 pb-4'
          }
          data={inbox.items}
          keyExtractor={(item) => item.id}
          ListEmptyComponent={emptyState}
          ListFooterComponent={listFooter}
          onEndReached={() => {
            if (inbox.hasMore && !inbox.loadingMore && !inbox.paginationError) {
              inbox.loadMore();
            }
          }}
          onEndReachedThreshold={0.4}
          onRefresh={inbox.refresh}
          refreshing={inbox.refreshing}
          renderItem={renderConversation}
          testID="conversation-list"
        />
      </View>
    </ScreenSafeAreaView>
  );
}
