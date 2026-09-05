import { Pressable, View } from 'react-native';

import { UserAvatar } from '../../../ui';
import { Text } from '../../../ui/text';
import type { InboxConversation } from '../inbox-types';

interface ConversationRowProps {
  conversation: InboxConversation;
  formattedPhone: string;
  formattedTime: string;
  onPress(): void;
}

export function ConversationRow({
  conversation,
  formattedPhone,
  formattedTime,
  onPress,
}: ConversationRowProps) {
  const contactName = conversation.contact.name?.trim();
  const displayName = contactName || formattedPhone;
  const unreadCount = conversation.unreadCount;
  const unreadLabel = `${unreadCount} unread ${
    unreadCount === 1 ? 'message' : 'messages'
  }`;
  const accessibilityLabel =
    unreadCount > 0
      ? `Open chat with ${displayName}, ${unreadLabel}`
      : `Open chat with ${displayName}`;

  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      className="active:bg-surface-secondary min-h-18 flex-row items-center gap-3 px-4 py-2"
      onPress={onPress}
    >
      <UserAvatar
        fallbackTone="tinted"
        name={displayName}
        size="md"
        source={conversation.contact.avatarUrl}
      />

      <View className="min-w-0 flex-1 gap-1 py-2">
        <View className="flex-row flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <Text
            className={`text-foreground min-w-0 flex-1 text-base ${
              unreadCount > 0 ? 'font-semibold' : 'font-medium'
            }`}
          >
            {displayName}
          </Text>
          {formattedTime ? (
            <Text
              className={`text-xs tabular-nums ${
                unreadCount > 0 ? 'text-accent font-semibold' : 'text-muted'
              }`}
            >
              {formattedTime}
            </Text>
          ) : null}
        </View>
        <View
          className="flex-row flex-wrap items-start gap-x-2 gap-y-1"
          testID="conversation-row-metadata"
        >
          <Text
            className={`min-w-0 flex-1 text-sm ${
              unreadCount > 0 ? 'text-foreground' : 'text-muted'
            }`}
          >
            {conversation.lastMessageText?.trim() || 'No messages yet'}
          </Text>
          {unreadCount > 0 ? (
            <Text
              accessibilityLabel={unreadLabel}
              className="bg-accent text-accent-foreground min-h-6 min-w-6 rounded-full px-2 py-1 text-center text-xs font-semibold"
            >
              {unreadCount}
            </Text>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}
