import { View } from 'react-native';

import { IconButton } from '../../../ui';
import { ConversationHeaderIdentity } from './conversation-header-identity';

interface ConversationHeaderProps {
  avatarUrl: string | null;
  name: string;
  onBack(): void;
  subtitle: string;
}

export function ConversationHeader({
  avatarUrl,
  name,
  onBack,
  subtitle,
}: ConversationHeaderProps) {
  return (
    <View
      className="bg-inbox-chrome min-h-14 flex-row items-center gap-1 px-2 py-1"
      testID="conversation-header"
    >
      <IconButton
        accessibilityLabel="Back to Inbox"
        onPress={onBack}
        symbol="chevron.left"
        variant="ghost"
      />
      <ConversationHeaderIdentity
        avatarUrl={avatarUrl}
        name={name}
        subtitle={subtitle}
      />
    </View>
  );
}
