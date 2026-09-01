import { render, screen } from '@testing-library/react-native';

import { message } from '../inbox-test-fixtures';
import { messageImageSizeForViewport, MessageBubble } from './message-bubble';

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

  it.each(['sending', 'sent', 'delivered', 'read', 'failed'] as const)(
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
        screen.getByLabelText(status.charAt(0).toUpperCase() + status.slice(1))
      ).toBeTruthy();
    }
  );

  it('keeps outbound time and delivery ticks inline with a short text reply', () => {
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
        .findByProps({ testID: 'message-metadata' })
    ).toBeTruthy();
    expect(metadata.props.className).not.toContain('absolute');
    expect(screen.queryByTestId('message-metadata-reservation')).toBeNull();
    expect(screen.getByLabelText('Read')).toBeTruthy();
  });

  it.each([
    ['customer', 'text'],
    ['customer', 'interactive'],
    ['agent', 'template'],
  ] as const)(
    'keeps %s %s metadata in the text flow',
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
          .findByProps({ testID: 'message-metadata' })
      ).toBeTruthy();
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
