import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import {
  QUICK_REACTION_EMOJIS,
  MessageActionSheet,
} from './message-action-sheet';

jest.mock('heroui-native', () => {
  const React = jest.requireActual('react') as typeof import('react');
  const { Pressable, Text } = jest.requireActual(
    'react-native'
  ) as typeof import('react-native');
  function MockButton({
    isDisabled,
    ...props
  }: import('react-native').PressableProps & { isDisabled?: boolean }) {
    return React.createElement(Pressable, {
      ...props,
      accessibilityRole: props.accessibilityRole ?? 'button',
      disabled: isDisabled,
    });
  }
  MockButton.Label = function MockButtonLabel({
    children,
  }: import('react').PropsWithChildren) {
    return React.createElement(Text, null, children);
  };
  return { Button: MockButton };
});

describe('MessageActionSheet', () => {
  it('offers the familiar quick reactions and closes after a pick', () => {
    const onClose = jest.fn();
    const onReact = jest.fn();
    render(
      <MessageActionSheet
        onClose={onClose}
        onReact={onReact}
        onReply={jest.fn()}
        preview="Can you send the renewal link?"
      />
    );

    expect(screen.getByText('Message actions')).toBeTruthy();
    expect(
      StyleSheet.flatten(
        screen.getByTestId('message-action-sheet-surface').props.style
      )
    ).toMatchObject({ flex: 0 });
    for (const emoji of QUICK_REACTION_EMOJIS) {
      expect(
        screen.getByRole('button', { name: `React with ${emoji}` })
      ).toBeTruthy();
    }

    fireEvent.press(screen.getByRole('button', { name: 'React with 👍' }));
    expect(onReact).toHaveBeenCalledWith('👍');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('starts Reply from the action row and omits it when the composer is unavailable', () => {
    const onClose = jest.fn();
    const onReply = jest.fn();
    const view = render(
      <MessageActionSheet
        onClose={onClose}
        onReact={jest.fn()}
        onReply={onReply}
        preview="Earlier message"
      />
    );

    fireEvent.press(screen.getByRole('button', { name: 'Reply to message' }));
    expect(onReply).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);

    view.rerender(
      <MessageActionSheet
        onClose={onClose}
        onReact={jest.fn()}
        preview="Earlier message"
      />
    );
    expect(
      screen.queryByRole('button', { name: 'Reply to message' })
    ).toBeNull();
  });

  it('provides an explicit backdrop dismissal target', () => {
    const onClose = jest.fn();
    render(
      <MessageActionSheet
        onClose={onClose}
        onReact={jest.fn()}
        preview="Earlier message"
      />
    );

    fireEvent.press(
      screen.getByRole('button', { name: 'Dismiss message actions' })
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
