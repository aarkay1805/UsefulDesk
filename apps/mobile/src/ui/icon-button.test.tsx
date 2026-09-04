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

  function MockSymbolView(props: { name: unknown; size?: number }) {
    return React.createElement(View, { ...props, testID: 'symbol' });
  }

  return { SymbolView: MockSymbolView };
});

describe('IconButton', () => {
  it('renders a labelled SF Symbol in a 48pt rounded-rectangle target', () => {
    render(
      <IconButton
        accessibilityLabel="Attach media"
        symbol="paperclip"
        onPress={jest.fn()}
      />
    );

    const button = screen.getByRole('button', { name: 'Attach media' });
    expect(button.props.className).toContain('min-h-12');
    expect(button.props.className).toContain('min-w-12');
    expect(button.props.className).toContain('rounded-lg');
    expect(button.props.className).not.toContain('rounded-full');
    expect(screen.getByTestId('symbol').props.name).toEqual({
      ios: 'paperclip',
      android: 'attach_file',
    });
    expect(screen.getByTestId('symbol').props.tintColor).toBe('#18181b');
  });

  it.each([
    ['chevron.down', 'expand_more'],
    ['chevron.left', 'arrow_back'],
    ['doc', 'description'],
    ['person.crop.circle', 'account_circle'],
    ['paperclip', 'attach_file'],
    ['photo', 'image'],
    ['video', 'videocam'],
    ['waveform', 'graphic_eq'],
    ['xmark', 'close'],
  ] as const)('maps %s to its Android Material Symbol', (ios, android) => {
    render(<IconButton accessibilityLabel={ios} symbol={ios} />);

    expect(screen.getByTestId('symbol').props.name).toEqual({ ios, android });
  });

  it('supports a circular, contrast-safe accent action without changing the default shape', () => {
    render(
      <IconButton
        accessibilityLabel="Send message"
        shape="circle"
        symbol="send"
        tone="on-accent"
      />
    );

    const button = screen.getByRole('button', { name: 'Send message' });
    expect(button.props.className).toContain('rounded-full');
    expect(button.props.className).not.toContain('rounded-lg');
    // Send is Lucide's plane, drawn rather than an SF Symbol.
    expect(screen.queryByTestId('symbol')).toBeNull();
    expect(screen.getByTestId('glyph-send')).toBeTruthy();
  });

  it('announces loading and prevents repeat presses while pending', () => {
    const onPress = jest.fn();
    render(
      <IconButton
        accessibilityLabel="Send message"
        symbol="send"
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
    expect(screen.queryByTestId('glyph-send')).toBeNull();

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
