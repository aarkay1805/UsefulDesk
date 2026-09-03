import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';

import type { SendAttemptResult } from '../use-message-thread';
import type { PickedMediaAsset } from '../media-picker';
import { MediaValidationError } from '../../../../../../src/lib/storage/media-contract';
import { MediaUploadError } from '../media-upload-client';
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
    return React.createElement(View, null, children);
  }
  MockLabel.Text = function MockLabelText({
    children,
    style,
  }: import('react').PropsWithChildren<{
    style?: import('react-native').TextStyle;
  }>) {
    return React.createElement(Text, { style }, children);
  };

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

function pressHandlerFor(label: string): () => void {
  let current: ReturnType<typeof screen.getByText> | null =
    screen.getByText(label);
  while (current) {
    if (typeof current.props.onPress === 'function')
      return current.props.onPress;
    current = current.parent;
  }
  throw new Error(`No press handler found for ${label}`);
}

const sent = (temporaryId = 'temp-1'): SendAttemptResult => ({
  temporaryId,
  status: 'sent',
});

const failed = (
  temporaryId = 'temp-1',
  safeToRetry = true,
  message = 'Too many send attempts.'
): SendAttemptResult =>
  ({
    temporaryId,
    status: 'failed',
    safeToRetry,
    message,
  }) as SendAttemptResult;

describe('ConversationComposer', () => {
  const replyTarget = {
    messageId: 'message-parent',
    authorLabel: 'Asha',
    preview: 'Please send the renewal form',
  };
  const photo: PickedMediaAsset = {
    kind: 'image',
    uri: 'file:///cache/member.jpg',
    name: 'member.jpg',
    mimeType: 'image/jpeg',
    size: 1024,
  };
  const document: PickedMediaAsset = {
    kind: 'document',
    uri: 'file:///cache/renewal.pdf',
    name: 'renewal.pdf',
    mimeType: 'application/pdf',
    size: 2048,
  };
  const uploaded = {
    path: 'account-branch-1/1700000000000-member.jpg',
    publicUrl: 'https://cdn.example.test/member.jpg',
  };

  function mediaProps(overrides: Record<string, unknown> = {}) {
    return {
      accountId: 'branch-1',
      onSend: jest.fn().mockResolvedValue(sent()),
      onRetry: jest.fn().mockResolvedValue(sent()),
      onSendMedia: jest.fn().mockResolvedValue(sent('temp:media')),
      onRetryMedia: jest.fn().mockResolvedValue(sent('temp:media')),
      onOpenTemplates: jest.fn(),
      pickMedia: jest.fn().mockResolvedValue(photo),
      uploadMedia: jest.fn(() => ({
        promise: Promise.resolve(uploaded),
        abort: jest.fn(),
      })),
      deleteMedia: jest.fn().mockResolvedValue(undefined),
      ...overrides,
    };
  }

  it('offers four accessible attachment choices and treats picker cancellation silently', async () => {
    const props = mediaProps({ pickMedia: jest.fn().mockResolvedValue(null) });
    render(<ConversationComposer {...props} />);
    fireEvent.press(screen.getByRole('button', { name: 'Attach media' }));
    for (const name of [
      'Choose photo',
      'Choose video',
      'Choose document',
      'Choose audio',
    ]) {
      expect(screen.getByRole('button', { name })).toBeTruthy();
    }
    fireEvent.press(screen.getByRole('button', { name: 'Choose photo' }));
    await waitFor(() => expect(props.pickMedia).toHaveBeenCalledWith('image'));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByLabelText('Photo attachment preview')).toBeNull();
  });

  it('shows picker validation errors without losing the regular draft', async () => {
    const props = mediaProps({
      pickMedia: jest
        .fn()
        .mockRejectedValue(
          new MediaValidationError(
            'Choose a supported file for this attachment type.'
          )
        ),
    });
    render(<ConversationComposer {...props} />);
    fireEvent.changeText(screen.getByLabelText('Message'), 'Keep my draft');
    fireEvent.press(screen.getByRole('button', { name: 'Attach media' }));
    fireEvent.press(screen.getByRole('button', { name: 'Choose photo' }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Choose a supported file for this attachment type.'
      )
    );
    expect(screen.getByLabelText('Message').props.value).toBe('Keep my draft');
  });

  it('maps unexpected picker and upload diagnostics to safe application copy', async () => {
    const pickerProps = mediaProps({
      pickMedia: jest
        .fn()
        .mockRejectedValue(new Error('PHPhotoLibrary raw diagnostic')),
    });
    const first = render(<ConversationComposer {...pickerProps} />);
    fireEvent.press(screen.getByRole('button', { name: 'Attach media' }));
    fireEvent.press(screen.getByRole('button', { name: 'Choose photo' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not open the attachment picker.'
    );
    first.unmount();

    const uploadProps = mediaProps({
      uploadMedia: jest.fn(() => ({
        promise: Promise.reject(
          new Error('Storage response body with internals')
        ),
        abort: jest.fn(),
      })),
    });
    render(<ConversationComposer {...uploadProps} />);
    fireEvent.press(screen.getByRole('button', { name: 'Attach media' }));
    fireEvent.press(screen.getByRole('button', { name: 'Choose photo' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not upload this attachment.'
    );
  });

  it('preserves safe validation copy when the real uploaded bytes exceed the limit', async () => {
    const props = mediaProps({
      uploadMedia: jest.fn(() => ({
        promise: Promise.reject(
          new MediaValidationError(
            'This image is too large. Choose one up to 5 MB.'
          )
        ),
        abort: jest.fn(),
      })),
    });
    render(<ConversationComposer {...props} />);
    fireEvent.press(screen.getByRole('button', { name: 'Attach media' }));
    fireEvent.press(screen.getByRole('button', { name: 'Choose photo' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This image is too large. Choose one up to 5 MB.'
    );
  });

  it('previews a local image, announces real upload progress, and aborts in flight', async () => {
    const attempt = deferred<typeof uploaded>();
    const abort = jest.fn();
    let reportProgress: ((value: number) => void) | undefined;
    const props = mediaProps({
      uploadMedia: jest.fn(
        (input: { onProgress?: (value: number) => void }) => {
          reportProgress = input.onProgress;
          return { promise: attempt.promise, abort };
        }
      ),
    });
    render(<ConversationComposer {...props} />);
    fireEvent.press(screen.getByRole('button', { name: 'Attach media' }));
    fireEvent.press(screen.getByRole('button', { name: 'Choose photo' }));
    expect(
      await screen.findByLabelText('Photo attachment preview')
    ).toBeTruthy();
    act(() => reportProgress?.(0.42));
    expect(screen.getByRole('progressbar').props.accessibilityValue).toEqual({
      min: 0,
      max: 100,
      now: 42,
    });
    expect(screen.getByText('Uploading 42%')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Cancel attachment' }));
    expect(abort).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText('Photo attachment preview')).toBeNull();
  });

  it('keeps a failed local asset for deliberate upload retry or cancel', async () => {
    const uploadMedia = jest
      .fn()
      .mockReturnValueOnce({
        promise: Promise.reject(
          new MediaUploadError('storage', 'Could not upload this attachment.')
        ),
        abort: jest.fn(),
      })
      .mockReturnValueOnce({
        promise: Promise.resolve(uploaded),
        abort: jest.fn(),
      });
    const props = mediaProps({
      pickMedia: jest.fn().mockResolvedValue(document),
      uploadMedia,
    });
    render(<ConversationComposer {...props} />);
    fireEvent.press(screen.getByRole('button', { name: 'Attach media' }));
    fireEvent.press(screen.getByRole('button', { name: 'Choose document' }));
    expect(await screen.findByText('renewal.pdf')).toBeTruthy();
    expect(
      await screen.findByRole('button', { name: 'Retry upload' })
    ).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Retry upload' }));
    await waitFor(() => expect(uploadMedia).toHaveBeenCalledTimes(2));
    expect(
      await screen.findByRole('button', { name: 'Send attachment' })
    ).toBeTruthy();
  });

  it('preserves the text draft, applies caption rules, and transfers ownership on send', async () => {
    const props = mediaProps({
      pickMedia: jest.fn().mockResolvedValue(document),
    });
    render(<ConversationComposer {...props} />);
    fireEvent.changeText(screen.getByLabelText('Message'), 'Regular reply');
    fireEvent.press(screen.getByRole('button', { name: 'Attach media' }));
    fireEvent.press(screen.getByRole('button', { name: 'Choose document' }));
    const caption = await screen.findByLabelText('Caption');
    expect(caption.props.maxLength).toBe(1024);
    fireEvent.changeText(caption, '  Renewal form  ');
    fireEvent.press(
      await screen.findByRole('button', { name: 'Send attachment' })
    );
    await waitFor(() =>
      expect(props.onSendMedia).toHaveBeenCalledWith({
        mediaKind: 'document',
        mediaUrl: uploaded.publicUrl,
        caption: 'Renewal form',
        filename: 'renewal.pdf',
      })
    );
    expect(props.deleteMedia).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Message').props.value).toBe('Regular reply');
  });

  it('shows the reply quote over a staged media shell and includes it in the send', async () => {
    const onReplySent = jest.fn();
    const props = mediaProps({ onReplySent, replyTarget });
    render(<ConversationComposer {...props} />);

    fireEvent.press(screen.getByRole('button', { name: 'Attach media' }));
    fireEvent.press(screen.getByRole('button', { name: 'Choose photo' }));
    await screen.findByRole('button', { name: 'Send attachment' });
    expect(screen.getByText('Asha')).toBeTruthy();
    expect(screen.getByText('Please send the renewal form')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Send attachment' }));

    await waitFor(() =>
      expect(props.onSendMedia).toHaveBeenCalledWith(
        expect.objectContaining({ replyToMessageId: 'message-parent' })
      )
    );
    expect(onReplySent).toHaveBeenCalledWith('message-parent');
  });

  it('retains the uploaded object while the initial media send is unresolved', async () => {
    const attempt = deferred<SendAttemptResult>();
    const props = mediaProps({
      onSendMedia: jest.fn(() => attempt.promise),
    });
    const view = render(<ConversationComposer {...props} />);
    fireEvent.press(screen.getByRole('button', { name: 'Attach media' }));
    fireEvent.press(screen.getByRole('button', { name: 'Choose photo' }));
    await screen.findByRole('button', {
      name: 'Discard attachment',
    });
    const pressStaleDiscard = pressHandlerFor('Discard attachment');
    fireEvent.press(
      await screen.findByRole('button', { name: 'Send attachment' })
    );

    expect(
      screen.queryByRole('button', { name: 'Discard attachment' })
    ).toBeNull();
    act(() => pressStaleDiscard());
    expect(screen.getByLabelText('Photo attachment preview')).toBeTruthy();
    expect(props.deleteMedia).not.toHaveBeenCalled();
    view.unmount();
    expect(props.deleteMedia).not.toHaveBeenCalled();
  });

  it('retains the uploaded object while a safe media retry is unresolved', async () => {
    const retryAttempt = deferred<SendAttemptResult>();
    const props = mediaProps({
      onSendMedia: jest.fn().mockResolvedValue(failed('temp:media', true)),
      onRetryMedia: jest.fn(() => retryAttempt.promise),
    });
    render(<ConversationComposer {...props} />);
    fireEvent.press(screen.getByRole('button', { name: 'Attach media' }));
    fireEvent.press(screen.getByRole('button', { name: 'Choose photo' }));
    fireEvent.press(
      await screen.findByRole('button', { name: 'Send attachment' })
    );
    const retry = await screen.findByRole('button', {
      name: 'Retry attachment',
    });
    screen.getByRole('button', {
      name: 'Discard attachment',
    });
    const pressStaleDiscard = pressHandlerFor('Discard attachment');
    fireEvent.press(retry);

    expect(
      screen.queryByRole('button', { name: 'Discard attachment' })
    ).toBeNull();
    act(() => pressStaleDiscard());
    expect(screen.getByLabelText('Photo attachment preview')).toBeTruthy();
    expect(props.deleteMedia).not.toHaveBeenCalled();
  });

  it('omits caption for audio and best-effort deletes an uploaded draft on discard', async () => {
    const audio = {
      ...photo,
      kind: 'audio' as const,
      uri: 'file:///cache/note.ogg',
      name: 'note.ogg',
      mimeType: 'audio/ogg',
    };
    const props = mediaProps({ pickMedia: jest.fn().mockResolvedValue(audio) });
    render(<ConversationComposer {...props} />);
    fireEvent.press(screen.getByRole('button', { name: 'Attach media' }));
    fireEvent.press(screen.getByRole('button', { name: 'Choose audio' }));
    expect(await screen.findByText('note.ogg')).toBeTruthy();
    expect(screen.queryByLabelText('Caption')).toBeNull();
    fireEvent.press(screen.getByRole('button', { name: 'Discard attachment' }));
    await waitFor(() =>
      expect(props.deleteMedia).toHaveBeenCalledWith({
        accountId: 'branch-1',
        path: uploaded.path,
      })
    );
  });

  it('allows one safe provider retry but locks an ambiguous send without deleting', async () => {
    const onSendMedia = jest.fn().mockResolvedValue(failed('temp:media', true));
    const onRetryMedia = jest
      .fn()
      .mockResolvedValue(failed('temp:media', false));
    const props = mediaProps({ onSendMedia, onRetryMedia });
    render(<ConversationComposer {...props} />);
    fireEvent.press(screen.getByRole('button', { name: 'Attach media' }));
    fireEvent.press(screen.getByRole('button', { name: 'Choose photo' }));
    fireEvent.press(
      await screen.findByRole('button', { name: 'Send attachment' })
    );
    const retry = await screen.findByRole('button', {
      name: 'Retry attachment',
    });
    fireEvent.press(retry);
    fireEvent.press(retry);
    await waitFor(() => expect(onRetryMedia).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Too many send attempts.'
    );
    expect(
      screen.queryByRole('button', { name: 'Retry attachment' })
    ).toBeNull();
    expect(props.deleteMedia).not.toHaveBeenCalled();
  });

  it('keeps a staged shell when the session expires and resolves Send through templates', async () => {
    const props = mediaProps({ sessionExpired: true });
    render(<ConversationComposer {...props} />);
    fireEvent.press(screen.getByRole('button', { name: 'Attach media' }));
    fireEvent.press(screen.getByRole('button', { name: 'Choose photo' }));
    fireEvent.press(
      await screen.findByRole('button', { name: 'Send attachment' })
    );
    expect(props.onOpenTemplates).toHaveBeenCalledTimes(1);
    expect(props.onSendMedia).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Photo attachment preview')).toBeTruthy();
  });

  it('restores async lifecycle handling after an effect cleanup and setup replay', async () => {
    const picker = deferred<PickedMediaAsset | null>();
    const initialProps = mediaProps({
      pickMedia: jest.fn(() => picker.promise),
    });
    const view = render(<ConversationComposer {...initialProps} />);

    view.rerender(
      <ConversationComposer
        {...initialProps}
        deleteMedia={jest.fn().mockResolvedValue(undefined)}
      />
    );
    fireEvent.press(screen.getByRole('button', { name: 'Attach media' }));
    fireEvent.press(screen.getByRole('button', { name: 'Choose photo' }));
    await act(async () => {
      picker.resolve(photo);
      await picker.promise;
    });

    expect(
      await screen.findByLabelText('Photo attachment preview')
    ).toBeTruthy();
  });

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

  it('retains reply context after failure and reuses it for a safe text retry', async () => {
    const onReplySent = jest.fn();
    const onRetry = jest.fn().mockResolvedValue(sent('temp:reply'));
    render(
      <ConversationComposer
        onReplySent={onReplySent}
        onRetry={onRetry}
        onSend={jest.fn().mockResolvedValue(failed('temp:reply'))}
        replyTarget={replyTarget}
      />
    );

    fireEvent.changeText(screen.getByLabelText('Message'), 'Replying now');
    fireEvent.press(screen.getByRole('button', { name: 'Send message' }));
    expect(await screen.findByText('Asha')).toBeTruthy();
    expect(onReplySent).not.toHaveBeenCalled();
    fireEvent.press(screen.getByRole('button', { name: 'Retry message' }));

    await waitFor(() => expect(onRetry).toHaveBeenCalledWith('temp:reply'));
    expect(onReplySent).toHaveBeenCalledWith('message-parent');
  });

  it('dismisses only the quote and sends text with the staged reply id', async () => {
    const onDismissReply = jest.fn();
    const onSend = jest.fn().mockResolvedValue(sent());
    render(
      <ConversationComposer
        onDismissReply={onDismissReply}
        onRetry={jest.fn()}
        onSend={onSend}
        replyTarget={replyTarget}
      />
    );

    fireEvent.changeText(screen.getByLabelText('Message'), 'Keep this draft');
    fireEvent.press(screen.getByRole('button', { name: 'Dismiss reply' }));
    expect(onDismissReply).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Message').props.value).toBe(
      'Keep this draft'
    );

    fireEvent.press(screen.getByRole('button', { name: 'Send message' }));
    await waitFor(() =>
      expect(onSend).toHaveBeenCalledWith('Keep this draft', 'message-parent')
    );
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
          'The send request did not complete. Delivery could not be confirmed. Check the conversation before sending again.'
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

  it('locks the draft when a previously safe Retry ends ambiguously', async () => {
    const onRetry = jest.fn().mockRejectedValue(new Error('offline'));
    render(
      <ConversationComposer
        onRetry={onRetry}
        onSend={jest.fn().mockResolvedValue(failed('temp-failed'))}
      />
    );

    fireEvent.changeText(screen.getByLabelText('Message'), 'Retry me');
    fireEvent.press(screen.getByRole('button', { name: 'Send message' }));
    fireEvent.press(
      await screen.findByRole('button', { name: 'Retry message' })
    );

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'The send request did not complete. Delivery could not be confirmed. Check the conversation before sending again.'
      );
    });
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Retry message' })).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Send message' }).props
        .accessibilityState
    ).toMatchObject({ disabled: true });
  });

  it('locks the unchanged draft after an ambiguous outcome and unlocks genuinely new content', async () => {
    const onSend = jest
      .fn()
      .mockResolvedValueOnce(
        failed(
          'temp-ambiguous',
          false,
          'Could not reach the send service. Delivery could not be confirmed. Check the conversation before sending again.'
        )
      )
      .mockResolvedValueOnce(sent('temp-new-content'));
    render(<ConversationComposer onRetry={jest.fn()} onSend={onSend} />);

    fireEvent.changeText(screen.getByLabelText('Message'), 'May be sent');
    fireEvent.press(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Could not reach the send service. Delivery could not be confirmed. Check the conversation before sending again.'
      );
    });
    expect(screen.queryByRole('button', { name: 'Retry message' })).toBeNull();

    const lockedSend = screen.getByRole('button', { name: 'Send message' });
    expect(lockedSend.props.accessibilityState).toMatchObject({
      disabled: true,
    });
    fireEvent.press(lockedSend);
    expect(onSend).toHaveBeenCalledTimes(1);

    fireEvent.changeText(
      screen.getByLabelText('Message'),
      'May be sent with an update'
    );
    const unlockedSend = screen.getByRole('button', { name: 'Send message' });
    expect(unlockedSend.props.accessibilityState).toMatchObject({
      disabled: false,
    });
    fireEvent.press(unlockedSend);

    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(2));
    expect(onSend).toHaveBeenLastCalledWith('May be sent with an update');
  });

  it('uses the local composer masters for accessible 48pt text and send controls', () => {
    render(<ConversationComposer onRetry={jest.fn()} onSend={jest.fn()} />);

    const input = screen.getByLabelText('Message');
    const send = screen.getByRole('button', { name: 'Send message' });

    expect(input.props.allowFontScaling).toBe(true);
    expect(input.props.maxFontSizeMultiplier).toBeUndefined();
    expect(input.props.className).toContain('min-h-12');
    expect(send.props.className).toContain('min-h-12');
    expect(send.props.className).toContain('min-w-12');
    expect(send.props.className).toContain('rounded-lg');
  });
});
