import { View } from 'react-native';

import { UserAvatar } from '../../../ui';
import { Text } from '../../../ui/text';

interface ConversationHeaderIdentityProps {
  avatarUrl: string | null;
  name: string;
  subtitle: string;
}

export function ConversationHeaderIdentity({
  avatarUrl,
  name,
  subtitle,
}: ConversationHeaderIdentityProps) {
  return (
    <View
      accessible
      accessibilityLabel={`${name}, ${subtitle}`}
      className="min-w-0 flex-1 flex-row items-center gap-2"
      testID="conversation-header-identity"
    >
      <UserAvatar
        fallbackTone="tinted"
        name={name}
        size="sm"
        source={avatarUrl}
      />
      <View className="min-w-0 flex-1">
        <Text
          className="text-foreground text-base font-semibold"
          numberOfLines={1}
        >
          {name}
        </Text>
        <Text className="text-muted text-xs" numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
    </View>
  );
}
