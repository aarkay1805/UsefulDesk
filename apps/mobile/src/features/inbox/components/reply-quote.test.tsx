import { fireEvent, render, screen } from '@testing-library/react-native';

import { ReplyQuote } from './reply-quote';

jest.mock('heroui-native', () => {
  const React = jest.requireActual('react') as typeof import('react');
  const { Pressable, Text } = jest.requireActual(
    'react-native'
  ) as typeof import('react-native');
  function MockButton({ children, isDisabled, ...props }: any) {
    return React.createElement(
      Pressable,
      { ...props, disabled: isDisabled, accessibilityRole: 'button' },
      children
    );
  }
  MockButton.Label = function MockButtonLabel({
    children,
  }: import('react').PropsWithChildren) {
    return React.createElement(Text, null, children);
  };
  return { Button: MockButton };
});

jest.mock('expo-symbols', () => {
  const React = jest.requireActual('react') as typeof import('react');
  const { View } = jest.requireActual(
    'react-native'
  ) as typeof import('react-native');
  return {
    SymbolView: (props: { name: string }) =>
      React.createElement(View, { ...props, testID: 'reply-quote-symbol' }),
  };
});

describe('ReplyQuote', () => {
  it('renders author and preview with the deliberate primary marker and dismiss action', () => {
    const onDismiss = jest.fn();
    render(
      <ReplyQuote
        authorLabel="Asha"
        onDismiss={onDismiss}
        preview="Please send the renewal form"
      />
    );

    expect(screen.getByText('Asha')).toBeTruthy();
    expect(screen.getByText('Please send the renewal form')).toBeTruthy();
    expect(screen.getByTestId('reply-quote').props.className).toContain(
      'border-l-4'
    );
    expect(screen.getByTestId('reply-quote').props.className).toContain(
      'border-l-primary'
    );
    const dismiss = screen.getByRole('button', { name: 'Dismiss reply' });
    expect(dismiss.props.variant).toBe('ghost');
    expect(dismiss.props.className).toContain('min-h-12');
    fireEvent.press(dismiss);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('renders a missing parent without a dismiss control inside a bubble', () => {
    render(<ReplyQuote unavailable />);

    expect(screen.getByText('Original message unavailable')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Dismiss reply' })).toBeNull();
  });
});
