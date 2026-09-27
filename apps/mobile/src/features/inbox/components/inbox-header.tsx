import { View } from 'react-native';

import { IconButton } from '../../../ui';
import { Text } from '../../../ui/text';

interface InboxHeaderProps {
  branchName: string;
  onOpenAccount(): void;
}

export function InboxHeader({ branchName, onOpenAccount }: InboxHeaderProps) {
  return (
    <View
      className="bg-inbox-chrome min-h-14 flex-row items-center gap-3 px-4 py-1"
      testID="inbox-header"
    >
      <View className="min-w-0 flex-1 py-1">
        <Text
          accessibilityRole="header"
          className="text-foreground text-2xl font-medium"
        >
          UsefulDesk
        </Text>
        <Text className="text-muted text-xs">Branch: {branchName}</Text>
      </View>
      <IconButton
        accessibilityLabel={`Account, current branch: ${branchName}`}
        onPress={onOpenAccount}
        symbol="person.crop.circle"
        variant="ghost"
      />
    </View>
  );
}
