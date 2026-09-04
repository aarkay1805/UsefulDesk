import type { ComponentProps } from 'react';
import type { PressableProps } from 'react-native';

import { Button } from './button';
import type { GlyphName } from './glyph';

export type IconButtonSymbol = GlyphName;

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
  return (
    <Button
      accessibilityLabel={
        isLoading ? `${accessibilityLabel}, loading` : accessibilityLabel
      }
      disabled={isDisabled}
      loading={isLoading}
      onPress={onPress}
      size="sm"
      symbol={symbol}
      symbolTone={tone}
      testID={testID}
      variant={variant}
      className={`min-w-12 px-0 ${
        shape === 'circle' ? 'rounded-full' : 'rounded-lg'
      }`}
    />
  );
}
