import type { ComponentProps } from 'react';
import { PlatformColor, type PressableProps } from 'react-native';
import { SymbolView } from 'expo-symbols';

import { Button } from './button';

const ANDROID_SYMBOL = {
  'person.crop.circle': 'account_circle',
  paperclip: 'attach_file',
  'paperplane.fill': 'send',
  xmark: 'close',
} as const;

export type IconButtonSymbol = keyof typeof ANDROID_SYMBOL;

export interface IconButtonProps {
  accessibilityLabel: string;
  symbol: IconButtonSymbol;
  isDisabled?: boolean;
  isLoading?: boolean;
  onPress?: PressableProps['onPress'];
  testID?: string;
  variant?: ComponentProps<typeof Button>['variant'];
}

export function IconButton({
  accessibilityLabel,
  symbol,
  isDisabled = false,
  isLoading = false,
  onPress,
  testID,
  variant,
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
      variant={variant}
      className="min-w-12 rounded-lg px-0"
    >
      <SymbolView
        name={{ ios: symbol, android: ANDROID_SYMBOL[symbol] }}
        size={20}
        weight="semibold"
        tintColor={PlatformColor('label')}
      />
    </Button>
  );
}
