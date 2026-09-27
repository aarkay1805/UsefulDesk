import { Stack, useRouter } from 'expo-router';
import { ActivityIndicator, FlatList, View } from 'react-native';

import { accountFormatters } from '../../../core/account-formatters';
import {
  Button,
  EmptyState,
  ErrorState,
  FilterMenu,
  type FilterMenuOption,
  LoadingState,
  Notice,
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

const LOAD_ERROR = 'Could not load chats';
const MORE_ERROR = 'Could not load more chats';

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
          <LoadingState label="Loading chats" />
        </View>
      );
    }

    if (inbox.status === 'error') {
      return (
        <View className="px-5 py-8">
          <ErrorState
            title={inbox.error ?? LOAD_ERROR}
            message="Check your internet and try again."
            onRetry={inbox.refresh}
          />
        </View>
      );
    }

    const hasSearch = inbox.search.trim().length > 0;
    const title = hasSearch
      ? 'No chats match'
      : inbox.filter === 'unread'
        ? 'No unread chats'
        : 'No chats yet';
    const message = hasSearch
      ? 'Try a different search or clear it.'
      : inbox.filter === 'unread'
        ? 'You have read all your chats.'
        : 'New WhatsApp chats will appear here.';

    return (
      <View className="gap-3 px-5 py-12">
        <EmptyState title={title} message={message} />
        {hasSearch || inbox.filter === 'unread' ? (
          <Button
            accessibilityLabel={hasSearch ? 'Clear search' : 'Show all chats'}
            className="self-center"
            onPress={() =>
              hasSearch ? inbox.setSearch('') : inbox.setFilter('all')
            }
            size="sm"
            testID="empty-chats-action"
            variant="ghost"
          >
            {hasSearch ? 'Clear search' : 'Show all chats'}
          </Button>
        ) : null}
      </View>
    );
  };

  const listFooter = () => {
    if (inbox.loadingMore) {
      return (
        <View className="items-center px-5 py-4">
          <ActivityIndicator accessibilityLabel="Loading more chats" />
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
            accessibilityLabel="Try loading more chats again"
            className="min-h-12"
            onPress={inbox.loadMore}
            size="sm"
            variant="ghost"
          >
            Try again
          </Button>
        </View>
      );
    }

    return null;
  };

  return (
    <ScreenSafeAreaView className="bg-inbox-chrome" edges={['top']}>
      <Stack.Screen options={{ headerShown: false, title: 'Chats' }} />
      <InboxHeader
        branchName={state.branch.account_name}
        onOpenAccount={() => router.push('/(app)/account')}
      />

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
          accessibilityLabel="Search chats"
          onValueChange={inbox.setSearch}
          placeholder="Search chats"
          trailingAccessory={
            <FilterMenu
              accessibilityLabel="Chat filter"
              onValueChange={inbox.setFilter}
              options={filters}
              value={inbox.filter}
            />
          }
          value={inbox.search}
        />
      </View>

      {/*
       * The sheet owns the bottom inset, not the root. The root is painted
       * with the chrome, so padding it for the home indicator leaves a chrome
       * band under the sheet; consuming the inset here instead runs the
       * sheet's own fill to the physical bottom edge while its content still
       * clears the indicator by exactly the same amount.
       */}
      <ScreenSafeAreaView
        className="bg-inbox-panel flex-1 overflow-hidden rounded-t-[28px]"
        edges={['bottom']}
      >
        {inbox.connection === 'disconnected' ? (
          <Notice
            className="mx-4 my-3"
            symbol="exclamationmark.triangle"
            title="Not updating live"
          >
            Check your internet. Pull down to refresh.
          </Notice>
        ) : null}

        {inbox.refreshWarning ? (
          <Notice
            className="mx-4 my-3"
            symbol="exclamationmark.triangle"
            tone="danger"
          >
            {inbox.refreshWarning}
          </Notice>
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
      </ScreenSafeAreaView>
    </ScreenSafeAreaView>
  );
}
