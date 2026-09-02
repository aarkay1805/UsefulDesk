import type { ComponentProps, ReactNode } from 'react';
import { ActivityIndicator } from 'react-native';
import { Button as HeroButton } from 'heroui-native';

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, Extract<keyof T, K>>
  : never;

type ButtonProps = DistributiveOmit<
  ComponentProps<typeof HeroButton>,
  'children' | 'isDisabled'
> & {
  children: ReactNode;
  disabled?: boolean;
  labelClassName?: string;
  loading?: boolean;
};

const SIZE_CLASS_NAMES = {
  sm: 'h-auto min-h-11 py-2',
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
  ...props
}: ButtonProps) {
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
        <HeroButton.Label className={labelClassName}>
          {children}
        </HeroButton.Label>
      )}
    </HeroButton>
  );
}
