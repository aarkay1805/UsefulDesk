import { render, screen } from '@testing-library/react-native';

import { message } from '../inbox-test-fixtures';
import { MessageBubble } from './message-bubble';

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

  it('reserves text metadata inline and overlays the visible metadata', () => {
    const result = render(
      <MessageBubble
        formattedTime="1:30 pm"
        message={message({ senderType: 'agent', contentText: 'A short reply' })}
        startsRun
      />
    );

    expect(
      result.UNSAFE_getByProps({ testID: 'message-metadata-reservation' }).props
        .className
    ).toContain('opacity-0');
    expect(screen.getByTestId('message-metadata')).toBeTruthy();
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
