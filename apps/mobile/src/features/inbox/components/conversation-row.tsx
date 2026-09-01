import { Pressable, Text, View } from 'react-native';

import { UserAvatar } from '../../../ui';
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
      className={`min-h-18 flex-row items-center gap-3 px-4 py-3 active:opacity-70 ${
        unreadCount > 0 ? 'bg-accent-soft' : ''
      }`}
      onPress={onPress}
    >
      <UserAvatar
        name={displayName}
        size="lg"
        source={conversation.contact.avatarUrl}
      />

      <View className="min-w-0 flex-1 gap-1">
        <Text
          className={`text-foreground text-base ${
            unreadCount > 0 ? 'font-semibold' : 'font-medium'
          }`}
          numberOfLines={1}
        >
          {displayName}
        </Text>
        <Text className="text-muted text-sm leading-5" numberOfLines={1}>
          {conversation.lastMessageText?.trim() || 'No messages yet'}
        </Text>
      </View>

      <View className="items-end gap-2">
        {formattedTime ? (
          <Text className="text-muted text-xs">{formattedTime}</Text>
        ) : null}
        {unreadCount > 0 ? (
          <Text
            accessibilityLabel={unreadLabel}
            className="bg-accent text-accent-foreground min-h-6 min-w-6 rounded-full px-2 py-1 text-center text-xs font-semibold"
          >
            {unreadCount}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}
