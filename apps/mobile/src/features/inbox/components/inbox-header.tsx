import { View } from 'react-native';

import { IconButton } from '../../../ui';
import { Text } from '../../../ui/text';

interface InboxHeaderProps {
  onOpenAccount(): void;
}

export function InboxHeader({ onOpenAccount }: InboxHeaderProps) {
  return (
    <View
      className="bg-inbox-chrome min-h-14 flex-row items-center gap-3 px-4 py-1"
      testID="inbox-header"
    >
      <Text
        accessibilityRole="header"
        className="text-foreground min-w-0 flex-1 text-2xl font-medium"
        numberOfLines={1}
      >
        UsefulDesk
      </Text>
      <IconButton
        accessibilityLabel="Account"
        onPress={onOpenAccount}
        symbol="person.crop.circle"
        variant="ghost"
      />
    </View>
  );
}
