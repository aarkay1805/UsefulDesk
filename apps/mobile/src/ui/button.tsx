import type { ComponentProps, ReactNode } from 'react';
import {
  ActivityIndicator,
  PlatformColor,
  type ColorValue,
} from 'react-native';
import { Button as HeroButton } from 'heroui-native';
import { useCSSVariable } from 'uniwind';

import { Glyph, type GlyphName } from './glyph';
import { useTextScale } from './use-text-scale';

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, Extract<keyof T, K>>
  : never;

type ButtonProps = DistributiveOmit<
  ComponentProps<typeof HeroButton>,
  'children' | 'isDisabled'
> & {
  /** Omit for an icon-only button, which then carries no label at all. */
  children?: ReactNode;
  disabled?: boolean;
  labelClassName?: string;
  loading?: boolean;
  /** Glyph drawn before the label, or alone when there are no children. */
  symbol?: GlyphName;
  /** Which foreground the glyph is tinted against. */
  symbolTone?: 'default' | 'on-accent';
};

const SIZE_CLASS_NAMES = {
  sm: 'h-auto min-h-12 py-2',
  md: 'h-auto min-h-12 py-3',
  lg: 'h-auto min-h-14 py-3.5',
} as const;

export function Button({
  children,
  className,
  disabled = false,
  labelClassName,
  loading = false,
  size = 'md',
  symbol,
  symbolTone = 'default',
  ...props
}: ButtonProps) {
  const textScale = useTextScale();
  const [foreground, accentForeground] = useCSSVariable([
    '--color-foreground',
    '--color-accent-foreground',
  ]);
  const tone = symbolTone === 'on-accent' ? accentForeground : foreground;
  const isDisabled = disabled || loading;
  const heroButtonProps = {
    ...props,
    className: `${SIZE_CLASS_NAMES[size]} ${className ?? ''}`.trim(),
    isDisabled,
    size,
    accessibilityState: { disabled: isDisabled, busy: loading },
  } as ComponentProps<typeof HeroButton>;

  return (
    <HeroButton {...heroButtonProps}>
      {loading ? (
        <ActivityIndicator accessibilityLabel="Working" />
      ) : (
        <>
          {symbol ? (
            <Glyph
              name={symbol}
              tintColor={
                (tone as ColorValue | undefined) ?? PlatformColor('label')
              }
            />
          ) : null}
          {/*
           * An icon-only button renders no label at all. Putting the glyph
           * inside `Label` would lay it out inline on that text's baseline
           * rather than centred in the button box, which sits a drawn mark
           * visibly low — the label is a `Text`, and an SVG inside one is an
           * inline element. Without children the glyph is a plain flex child
           * and the button centres it.
           */}
          {children === undefined || children === null ? null : (
            <HeroButton.Label
              className={labelClassName}
              key={textScale}
              style={{ lineHeight: undefined }}
            >
              {children}
            </HeroButton.Label>
          )}
        </>
      )}
    </HeroButton>
  );
}
