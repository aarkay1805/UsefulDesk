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
      expect(screen.getByText('Hello')).toBeTruthy();
    }
  );

  it('announces delivery state independently of color', () => {
    render(
      <MessageBubble
        formattedTime="1:30 pm"
        message={message({ senderType: 'agent', status: 'read' })}
        startsRun
      />
    );

    expect(screen.getByLabelText('Read')).toBeTruthy();
  });
});
