import { Stack, useRouter } from 'expo-router';
import { ActivityIndicator, FlatList, Text, View } from 'react-native';

import { accountFormatters } from '../../../core/account-formatters';
import {
  Button,
  ErrorState,
  FilterChipGroup,
  LoadingState,
  ScreenSafeAreaView,
  SearchField,
} from '../../../ui';
import { useReadyAuth } from '../../auth/auth-context';
import { ConversationRow } from '../components/conversation-row';
import { useInboxRealtimeFeed } from '../inbox-realtime-provider';
import type { ConversationFilter, InboxConversation } from '../inbox-types';
import { useConversationList } from '../use-conversation-list';

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

  const filters: readonly {
    label: string;
    value: ConversationFilter;
    count?: number;
  }[] = [
    { label: 'All', value: 'all' },
    { label: 'Unread', value: 'unread', count: inbox.unreadCount },
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
      formattedTime={item.lastMessageAt ? fmt.time(item.lastMessageAt) : ''}
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
        <Text className="text-muted text-center text-sm leading-5">
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
          <Text className="text-danger text-center text-sm leading-5">
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
    <ScreenSafeAreaView className="bg-background" edges={['bottom']}>
      <Stack.Screen
        options={{
          title: 'Inbox',
          headerRight: () => (
            <Button
              accessibilityLabel="Account"
              className="min-h-12"
              labelClassName="text-zinc-950"
              onPress={() => router.push('/(app)/account')}
              size="sm"
              variant="ghost"
            >
              Account
            </Button>
          ),
        }}
      />

      <View className="gap-3 px-4 pt-4 pb-3">
        <SearchField
          accessibilityLabel="Search conversations"
          onValueChange={inbox.setSearch}
          placeholder="Search conversations"
          value={inbox.search}
        />
        <FilterChipGroup
          accessibilityLabel="Conversation filters"
          onValueChange={inbox.setFilter}
          options={filters}
          value={inbox.filter}
        />
      </View>

      {inbox.connection === 'disconnected' ? (
        <View
          accessibilityLiveRegion="polite"
          accessibilityRole="alert"
          className="bg-warning-soft mx-4 mb-3 gap-1 rounded-xl p-4"
        >
          <Text className="text-warning-soft-foreground text-sm font-semibold">
            Live updates unavailable
          </Text>
          <Text className="text-warning-soft-foreground text-sm leading-5">
            Pull to refresh while the connection recovers.
          </Text>
        </View>
      ) : null}

      <FlatList
        contentContainerClassName={inbox.items.length === 0 ? 'flex-grow' : ''}
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
  );
}
