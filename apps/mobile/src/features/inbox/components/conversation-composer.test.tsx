import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';

import type { SendAttemptResult } from '../use-message-thread';
import { ConversationComposer } from './conversation-composer';

const mockFocusWhenEditable = jest.fn();

jest.mock('heroui-native', () => {
  const React = jest.requireActual('react') as typeof import('react');
  const {
    Pressable,
    Text,
    TextInput: NativeTextInput,
    View,
  } = jest.requireActual('react-native') as typeof import('react-native');

  function MockTextField({ children }: import('react').PropsWithChildren) {
    return React.createElement(View, null, children);
  }

  function MockLabel({ children }: import('react').PropsWithChildren) {
    return React.createElement(Text, null, children);
  }

  function MockFieldError({ children }: import('react').PropsWithChildren) {
    return React.createElement(Text, { accessibilityRole: 'alert' }, children);
  }

  const MockInput = React.forwardRef(function MockInput(
    { isDisabled, onChangeText, ...props }: any,
    ref: any
  ) {
    React.useImperativeHandle(ref, () => ({
      focus: () => {
        if (!isDisabled) mockFocusWhenEditable();
      },
    }));
    return React.createElement(NativeTextInput, {
      ...props,
      editable: !isDisabled && props.editable,
      onChangeText: isDisabled ? undefined : onChangeText,
    });
  });

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
        accessibilityRole: 'button',
        disabled: isDisabled,
      },
      children
    );
  }
  MockButton.Label = function MockButtonLabel({
    children,
  }: import('react').PropsWithChildren) {
    return React.createElement(Text, null, children);
  };

  return {
    Button: MockButton,
    FieldError: MockFieldError,
    Input: MockInput,
    Label: MockLabel,
    TextField: MockTextField,
  };
});

jest.mock('expo-symbols', () => {
  const React = jest.requireActual('react') as typeof import('react');
  const { View } = jest.requireActual(
    'react-native'
  ) as typeof import('react-native');

  return {
    SymbolView: (props: { name: string }) =>
      React.createElement(View, { ...props, testID: 'composer-symbol' }),
  };
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

const sent = (temporaryId = 'temp-1'): SendAttemptResult => ({
  temporaryId,
  status: 'sent',
});

const failed = (temporaryId = 'temp-1'): SendAttemptResult => ({
  temporaryId,
  status: 'failed',
});

describe('ConversationComposer', () => {
  it('sends trimmed nonempty text once and clears the draft only after success', async () => {
    const attempt = deferred<SendAttemptResult>();
    const onSend = jest.fn(() => attempt.promise);

    render(<ConversationComposer onRetry={jest.fn()} onSend={onSend} />);

    const input = screen.getByLabelText('Message');
    fireEvent.changeText(input, '  See you tomorrow  ');
    fireEvent.press(screen.getByRole('button', { name: 'Send message' }));
    fireEvent.press(
      screen.getByRole('button', { name: 'Send message, loading' })
    );

    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith('See you tomorrow');
    expect(input.props.value).toBe('  See you tomorrow  ');
    expect(input.props.editable).toBe(false);

    await act(async () => {
      attempt.resolve(sent());
      await attempt.promise;
    });

    expect(screen.getByLabelText('Message').props.value).toBe('');
  });

  it('keeps multiline Return behavior and leaves whitespace-only drafts unsent', () => {
    const onSend = jest.fn();
    render(<ConversationComposer onRetry={jest.fn()} onSend={onSend} />);

    const input = screen.getByLabelText('Message');
    fireEvent.changeText(input, 'First line\nSecond line');
    fireEvent(input, 'onSubmitEditing');

    expect(input.props.value).toBe('First line\nSecond line');
    expect(input.props.multiline).toBe(true);
    expect(input.props.returnKeyType).toBe('default');
    expect(input.props.submitBehavior).toBe('newline');
    expect(onSend).not.toHaveBeenCalled();

    fireEvent.changeText(input, '   ');
    fireEvent.press(screen.getByRole('button', { name: 'Send message' }));
    expect(onSend).not.toHaveBeenCalled();
  });

  it.each([
    'Network unavailable',
    'Provider rejected the message',
    '429 Too Many Requests',
  ])(
    'retains and refocuses the draft after %s failure',
    async (failureMessage) => {
      const onSend = jest.fn().mockRejectedValue(new Error(failureMessage));
      mockFocusWhenEditable.mockClear();

      render(<ConversationComposer onRetry={jest.fn()} onSend={onSend} />);

      const input = screen.getByLabelText('Message');
      fireEvent.changeText(input, 'Keep this draft');
      fireEvent.press(screen.getByRole('button', { name: 'Send message' }));

      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent(
          'Could not send message. Check your connection and try again.'
        );
      });

      expect(screen.getByLabelText('Message').props.value).toBe(
        'Keep this draft'
      );
      expect(screen.getByLabelText('Message').props.accessibilityState).toEqual(
        { disabled: false }
      );
      expect(mockFocusWhenEditable).toHaveBeenCalledTimes(1);
      expect(
        screen.queryByRole('button', { name: 'Retry message' })
      ).toBeNull();
    }
  );

  it('shows Retry only for the failed optimistic row and prevents overlapping retries', async () => {
    const retry = deferred<SendAttemptResult>();
    const onRetry = jest.fn(() => retry.promise);

    render(
      <ConversationComposer
        onRetry={onRetry}
        onSend={jest.fn().mockResolvedValue(failed('temp-failed'))}
      />
    );

    fireEvent.changeText(screen.getByLabelText('Message'), 'Retry me');
    fireEvent.press(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Retry message' })
      ).toBeTruthy();
    });

    fireEvent.press(screen.getByRole('button', { name: 'Retry message' }));
    const retryButton = screen.getByRole('button', { name: 'Retry message' });
    expect(retryButton.props.accessibilityState).toEqual({
      disabled: true,
      busy: true,
    });
    fireEvent.press(retryButton);

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith('temp-failed');

    await act(async () => {
      retry.resolve(sent('temp-failed'));
      await retry.promise;
    });

    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByLabelText('Message').props.value).toBe('');
  });

  it('uses the local composer masters for accessible 44pt text and send controls', () => {
    render(<ConversationComposer onRetry={jest.fn()} onSend={jest.fn()} />);

    const input = screen.getByLabelText('Message');
    const send = screen.getByRole('button', { name: 'Send message' });

    expect(input.props.allowFontScaling).toBe(true);
    expect(input.props.maxFontSizeMultiplier).toBe(1.5);
    expect(input.props.className).toContain('min-h-11');
    expect(send.props.className).toContain('min-h-11');
    expect(send.props.className).toContain('min-w-11');
    expect(send.props.className).toContain('rounded-lg');
  });
});
