import type { ComponentProps } from 'react';
import {
  PlatformColor,
  type ColorValue,
  type PressableProps,
} from 'react-native';
import { SymbolView } from 'expo-symbols';
import { useCSSVariable } from 'uniwind';

import { Button } from './button';

const ANDROID_SYMBOL = {
  'chevron.left': 'arrow_back',
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
  shape?: 'rounded' | 'circle';
  testID?: string;
  tone?: 'default' | 'on-accent';
  variant?: ComponentProps<typeof Button>['variant'];
}

export function IconButton({
  accessibilityLabel,
  symbol,
  isDisabled = false,
  isLoading = false,
  onPress,
  shape = 'rounded',
  testID,
  tone = 'default',
  variant,
}: IconButtonProps) {
  const [foreground, accentForeground] = useCSSVariable([
    '--color-foreground',
    '--color-accent-foreground',
  ]);
  const platformFallback = PlatformColor('label');
  const tintColor: ColorValue =
    tone === 'on-accent' && accentForeground !== undefined
      ? (accentForeground as ColorValue)
      : foreground !== undefined
        ? (foreground as ColorValue)
        : platformFallback;

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
      className={`min-w-12 px-0 ${
        shape === 'circle' ? 'rounded-full' : 'rounded-lg'
      }`}
    >
      <SymbolView
        name={{ ios: symbol, android: ANDROID_SYMBOL[symbol] }}
        size={20}
        weight="semibold"
        tintColor={tintColor}
      />
    </Button>
  );
}
