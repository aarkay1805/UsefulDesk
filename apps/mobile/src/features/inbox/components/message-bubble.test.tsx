import { fireEvent, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo, Platform } from 'react-native';

import { message } from '../inbox-test-fixtures';
import {
  isAccessibilityTextScale,
  shouldInlineBubbleMetadata,
} from '../inbox-layout';
import { messageImageSizeForViewport, MessageBubble } from './message-bubble';

jest.mock('react-native-gesture-handler/ReanimatedSwipeable', () => {
  const React = jest.requireActual('react') as typeof import('react');
  const { View } = jest.requireActual(
    'react-native'
  ) as typeof import('react-native');
  return {
    __esModule: true,
    default: ({
      children,
      onSwipeableOpen,
      renderLeftActions,
      testID,
    }: {
      children: import('react').ReactNode;
      onSwipeableOpen?(): void;
      renderLeftActions?(
        progress: { value: number },
        translation: { value: number },
        methods: { close(): void }
      ): import('react').ReactNode;
      testID?: string;
    }) =>
      React.createElement(
        View,
        { onSwipeableOpen, testID } as never,
        renderLeftActions?.({ value: 0 }, { value: 0 }, { close: jest.fn() }),
        children
      ),
  };
});

jest.mock('../../../ui/icon-button', () => ({ IconButton: () => null }));

jest.mock('expo-image', () => {
  const React = jest.requireActual('react') as typeof import('react');
  const { Image } = jest.requireActual(
    'react-native'
  ) as typeof import('react-native');

  return {
    Image: (props: import('react-native').ImageProps) =>
      React.createElement(Image, props),
  };
});

describe('MessageBubble', () => {
  it('opens actions on long press and exposes separate Reply and React accessibility actions', () => {
    const onReply = jest.fn();
    const onOpenActions = jest.fn();
    render(
      <MessageBubble
        formattedTime="1:30 pm"
        message={message()}
        onOpenActions={onOpenActions}
        onReply={onReply}
        startsRun
      />
    );

    const bubble = screen.getByTestId('message-bubble');
    expect(bubble.props.accessibilityActions).toEqual([
      { name: 'reply', label: 'Reply to message' },
      { name: 'react', label: 'React to message' },
    ]);
    fireEvent(bubble, 'longPress');
    fireEvent(bubble, 'accessibilityAction', {
      nativeEvent: { actionName: 'reply' },
    });
    fireEvent(bubble, 'accessibilityAction', {
      nativeEvent: { actionName: 'react' },
    });
    fireEvent(screen.getByTestId('message-reply-swipeable'), 'swipeableOpen');

    expect(onOpenActions).toHaveBeenCalledTimes(2);
    expect(onReply).toHaveBeenCalledTimes(2);
    expect(
      screen.getByTestId('message-swipe-reply-affordance', {
        includeHiddenElements: true,
      })
    ).toBeTruthy();
  });

  it('keeps long-press reactions available when Reply is unavailable', () => {
    const onOpenActions = jest.fn();
    render(
      <MessageBubble
        formattedTime="1:30 pm"
        message={message()}
        onOpenActions={onOpenActions}
        startsRun
      />
    );

    const bubble = screen.getByTestId('message-bubble');
    expect(bubble.props.accessibilityActions).toEqual([
      { name: 'react', label: 'React to message' },
    ]);
    fireEvent(bubble, 'longPress');
    expect(onOpenActions).toHaveBeenCalledTimes(1);
  });

  it('renders loaded and unavailable parent quotes inside reply bubbles', () => {
    const reply = message({ replyToMessageId: 'parent-message' });
    const view = render(
      <MessageBubble
        formattedTime="1:30 pm"
        message={reply}
        replyQuote={{ authorLabel: 'You', preview: 'Earlier message' }}
        startsRun
      />
    );

    expect(screen.getByText('You')).toBeTruthy();
    expect(screen.getByText('Earlier message')).toBeTruthy();
    expect(screen.getByTestId('message-bubble')).toContainElement(
      screen.getByText('Earlier message')
    );

    view.rerender(
      <MessageBubble
        formattedTime="1:30 pm"
        message={reply}
        replyQuote={{ unavailable: true }}
        startsRun
      />
    );
    expect(screen.getByText('Original message unavailable')).toBeTruthy();
  });

  describe('iOS failed-delivery announcements', () => {
    let announce: jest.SpiedFunction<
      typeof AccessibilityInfo.announceForAccessibilityWithOptions
    >;

    beforeEach(() => {
      jest.replaceProperty(Platform, 'OS', 'ios');
      announce = jest
        .spyOn(AccessibilityInfo, 'announceForAccessibilityWithOptions')
        .mockImplementation();
      announce.mockClear();
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('queues one announcement when an existing message transitions to failed', () => {
      const sentMessage = message({ senderType: 'agent', status: 'sent' });
      const { rerender } = render(
        <MessageBubble
          formattedTime="1:30 pm"
          message={sentMessage}
          startsRun
        />
      );

      rerender(
        <MessageBubble
          formattedTime="1:30 pm"
          message={{ ...sentMessage, status: 'failed' }}
          startsRun
        />
      );

      expect(announce).toHaveBeenCalledTimes(1);
      expect(announce).toHaveBeenCalledWith('Message failed', { queue: true });
    });

    it('does not announce a failed message on initial mount', () => {
      render(
        <MessageBubble
          formattedTime="1:30 pm"
          message={message({ senderType: 'agent', status: 'failed' })}
          startsRun
        />
      );

      expect(announce).not.toHaveBeenCalled();
    });

    it('does not repeat an announcement for unrelated or failed rerenders', () => {
      const sentMessage = message({ senderType: 'agent', status: 'sent' });
      const failedMessage = { ...sentMessage, status: 'failed' as const };
      const { rerender } = render(
        <MessageBubble
          formattedTime="1:30 pm"
          message={sentMessage}
          startsRun
        />
      );

      rerender(
        <MessageBubble
          formattedTime="1:31 pm"
          message={sentMessage}
          startsRun={false}
        />
      );
      rerender(
        <MessageBubble
          formattedTime="1:31 pm"
          message={failedMessage}
          startsRun={false}
        />
      );
      rerender(
        <MessageBubble
          formattedTime="1:32 pm"
          message={failedMessage}
          startsRun
        />
      );

      expect(announce).toHaveBeenCalledTimes(1);
    });
  });

  it('clamps 4:3 photos to the padded bubble on a 320dp portrait viewport', () => {
    expect(messageImageSizeForViewport(320)).toEqual({
      height: 129,
      width: 172,
    });
    expect(messageImageSizeForViewport(768)).toEqual({
      height: 180,
      width: 240,
    });
  });

  it('switches to the reflow layout at the largest standard iOS text size', () => {
    expect(isAccessibilityTextScale(1.29)).toBe(false);
    expect(isAccessibilityTextScale(1.3)).toBe(true);
    expect(isAccessibilityTextScale(2)).toBe(true);
    expect(shouldInlineBubbleMetadata(true, 1)).toBe(true);
    expect(shouldInlineBubbleMetadata(true, 1.3)).toBe(false);
    expect(shouldInlineBubbleMetadata(false, 1)).toBe(false);
  });

  it.each([
    ['template', 'Template'],
    ['interactive', 'Button reply'],
  ] as const)(
    'marks %s provenance without a filled badge',
    (contentType, marker) => {
      render(
        <MessageBubble
          formattedTime="1:30 pm"
          message={message({ contentType, contentText: 'Hello' })}
          startsRun
        />
      );

      expect(screen.getByText(marker)).toBeTruthy();
      expect(screen.getByText(/Hello/)).toBeTruthy();
    }
  );

  it.each(['sending', 'sent', 'delivered', 'read'] as const)(
    'announces the %s delivery state independently of color',
    (status) => {
      render(
        <MessageBubble
          formattedTime="1:30 pm"
          message={message({ senderType: 'agent', status })}
          startsRun
        />
      );

      expect(
        screen.getByLabelText(
          `1:30 pm, ${status.charAt(0).toUpperCase() + status.slice(1)}`
        )
      ).toBeTruthy();
    }
  );

  it('renders a recycled failed delivery as a separate visible alert', () => {
    const sentMessage = message({ senderType: 'agent', status: 'sent' });
    const { rerender } = render(
      <MessageBubble formattedTime="1:30 pm" message={sentMessage} startsRun />
    );

    expect(screen.queryByRole('alert', { name: 'Message failed' })).toBeNull();

    rerender(
      <MessageBubble
        formattedTime="1:30 pm"
        message={{ ...sentMessage, status: 'failed' }}
        startsRun
      />
    );

    const failedStatus = screen.getByRole('alert', {
      name: 'Message failed',
    });

    expect(failedStatus).toHaveTextContent('Failed');
    expect(
      screen
        .getByTestId('message-text-content')
        .findAllByProps({ testID: 'message-failed-status' })
    ).toHaveLength(0);
  });

  it('keeps outbound time and delivery ticks in readable flow', () => {
    render(
      <MessageBubble
        formattedTime="1:30 pm"
        message={message({
          senderType: 'agent',
          status: 'read',
          contentText: 'OK',
        })}
        startsRun
      />
    );

    const metadata = screen.getByTestId('message-metadata');

    expect(
      screen
        .getByTestId('message-text-content')
        .findAllByProps({ testID: 'message-metadata' })
    ).toHaveLength(0);
    expect(metadata.props.className).not.toContain('absolute');
    expect(screen.queryByTestId('message-metadata-reservation')).toBeNull();
    expect(screen.getByLabelText('1:30 pm, Read')).toBeTruthy();
  });

  it.each([
    ['customer', 'text'],
    ['customer', 'interactive'],
    ['agent', 'template'],
  ] as const)(
    'keeps %s %s metadata visible in the accessibility reflow',
    (senderType, contentType) => {
      render(
        <MessageBubble
          formattedTime="1:30 pm"
          message={message({ senderType, contentType, contentText: 'Yes' })}
          startsRun
        />
      );

      expect(
        screen
          .getByTestId('message-text-content')
          .findAllByProps({ testID: 'message-metadata' })
      ).toHaveLength(0);
      expect(screen.getByTestId('message-metadata')).toBeTruthy();
    }
  );

  it('places non-text metadata in normal flow beneath the content', () => {
    render(
      <MessageBubble
        formattedTime="1:30 pm"
        message={message({
          senderType: 'customer',
          contentType: 'document',
          contentText: null,
          mediaUrl: null,
        })}
        startsRun
      />
    );

    const metadata = screen.getByTestId('message-metadata');
    const metadataClasses = metadata.props.className.split(/\s+/);

    expect(metadata.props.className).not.toContain('absolute');
    expect(metadataClasses).toEqual(
      expect.arrayContaining(['text-xs', 'self-end', 'pt-0.5'])
    );
    expect(screen.queryByTestId('message-text-content')).toBeNull();
    expect(screen.getByText('Document unavailable')).toBeTruthy();
  });

  it('uses opening and within-run spacing with sender alignment', () => {
    const { rerender } = render(
      <MessageBubble
        formattedTime="1:30 pm"
        message={message({ senderType: 'customer' })}
        startsRun
      />
    );

    expect(screen.getByTestId('message-bubble').props.className).toContain(
      'items-start'
    );
    expect(screen.getByTestId('message-bubble').props.className).toContain(
      'mt-3'
    );
    expect(screen.getByTestId('message-bubble-tail')).toBeTruthy();

    rerender(
      <MessageBubble
        formattedTime="1:31 pm"
        message={message({ senderType: 'agent' })}
        startsRun={false}
      />
    );

    expect(screen.getByTestId('message-bubble').props.className).toContain(
      'items-end'
    );
    expect(screen.getByTestId('message-bubble').props.className).toContain(
      'mt-0.5'
    );
    expect(screen.queryByTestId('message-bubble-tail')).toBeNull();
  });
});
