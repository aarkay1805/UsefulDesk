import type { ComponentProps } from 'react';
import { PlatformColor, type PressableProps } from 'react-native';
import { SymbolView } from 'expo-symbols';

import { Button } from './button';

export interface IconButtonProps {
  accessibilityLabel: string;
  symbol: ComponentProps<typeof SymbolView>['name'];
  isDisabled?: boolean;
  isLoading?: boolean;
  onPress?: PressableProps['onPress'];
  testID?: string;
}

export function IconButton({
  accessibilityLabel,
  symbol,
  isDisabled = false,
  isLoading = false,
  onPress,
  testID,
}: IconButtonProps) {
  return (
    <Button
      accessibilityLabel={
        isLoading ? `${accessibilityLabel}, loading` : accessibilityLabel
      }
      disabled={isDisabled}
      loading={isLoading}
      onPress={onPress}
      size="sm"
      testID={testID}
      className="min-w-12 rounded-lg px-0"
    >
      <SymbolView
        name={symbol}
        size={20}
        weight="semibold"
        tintColor={PlatformColor('label')}
      />
    </Button>
  );
}
