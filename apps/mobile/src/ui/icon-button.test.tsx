import { fireEvent, render, screen } from '@testing-library/react-native';

import { IconButton } from './icon-button';

jest.mock('heroui-native', () => {
  const React = jest.requireActual('react') as typeof import('react');
  const { Pressable, Text } = jest.requireActual(
    'react-native'
  ) as typeof import('react-native');

  function MockButton({
    children,
    isDisabled,
    ...props
  }: import('react-native').PressableProps & {
    children?: import('react').ReactNode;
    isDisabled?: boolean;
  }) {
    return React.createElement(
      Pressable,
      {
        ...props,
        disabled: isDisabled,
        accessibilityRole: 'button',
      },
      children
    );
  }

  MockButton.Label = function MockButtonLabel({
    children,
    className,
  }: {
    children?: import('react').ReactNode;
    className?: string;
  }) {
    return React.createElement(Text, { className }, children);
  };

  return { Button: MockButton };
});

jest.mock('expo-symbols', () => {
  const React = jest.requireActual('react') as typeof import('react');
  const { View } = jest.requireActual(
    'react-native'
  ) as typeof import('react-native');

  function MockSymbolView(props: { name: string; size?: number }) {
    return React.createElement(View, { ...props, testID: 'symbol' });
  }

  return { SymbolView: MockSymbolView };
});

describe('IconButton', () => {
  it('renders a labelled SF Symbol in a 44pt rounded-rectangle target', () => {
    render(
      <IconButton
        accessibilityLabel="Send message"
        symbol="paperplane.fill"
        onPress={jest.fn()}
      />
    );

    const button = screen.getByRole('button', { name: 'Send message' });
    expect(button.props.className).toContain('min-h-11');
    expect(button.props.className).toContain('min-w-11');
    expect(button.props.className).toContain('rounded-lg');
    expect(button.props.className).not.toContain('rounded-full');
    expect(screen.getByTestId('symbol').props.name).toBe('paperplane.fill');
  });

  it('announces loading and prevents repeat presses while pending', () => {
    const onPress = jest.fn();
    render(
      <IconButton
        accessibilityLabel="Send message"
        symbol="paperplane.fill"
        onPress={onPress}
        isLoading
      />
    );

    const button = screen.getByRole('button', {
      name: 'Send message, loading',
    });
    expect(button.props.accessibilityState).toEqual({
      disabled: true,
      busy: true,
    });
    expect(screen.getByLabelText('Working')).toBeTruthy();
    expect(screen.queryByTestId('symbol')).toBeNull();

    fireEvent.press(button);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('exposes the disabled state and suppresses its press handler', () => {
    const onPress = jest.fn();
    render(
      <IconButton
        accessibilityLabel="Attach file"
        symbol="paperclip"
        onPress={onPress}
        isDisabled
      />
    );

    const button = screen.getByRole('button', { name: 'Attach file' });
    expect(button.props.accessibilityState).toEqual({
      disabled: true,
      busy: false,
    });

    fireEvent.press(button);
    expect(onPress).not.toHaveBeenCalled();
  });
});
