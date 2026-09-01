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
  loading?: boolean;
};

export function Button({
  children,
  disabled = false,
  loading = false,
  ...props
}: ButtonProps) {
  const isDisabled = disabled || loading;
  const heroButtonProps = {
    ...props,
    isDisabled,
    accessibilityState: { disabled: isDisabled, busy: loading },
  } as ComponentProps<typeof HeroButton>;

  return (
    <HeroButton {...heroButtonProps}>
      {loading ? (
        <ActivityIndicator accessibilityLabel="Working" />
      ) : (
        <HeroButton.Label>{children}</HeroButton.Label>
      )}
    </HeroButton>
  );
}
