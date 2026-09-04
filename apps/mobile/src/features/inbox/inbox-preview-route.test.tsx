import { render, screen } from '@testing-library/react-native';

import InboxPreview from '../../../app/inbox-preview';

jest.mock('expo-router', () => {
  const React = jest.requireActual('react') as typeof import('react');
  const { View } = jest.requireActual(
    'react-native'
  ) as typeof import('react-native');

  return {
    Redirect: ({ href }: { href: string }) =>
      React.createElement(View, {
        accessibilityLabel: `Redirect to ${href}`,
        testID: 'preview-redirect',
      }),
    Stack: { Screen: () => null },
  };
});

jest.mock('../../ui', () => {
  const React = jest.requireActual('react') as typeof import('react');
  const { Text, View } = jest.requireActual(
    'react-native'
  ) as typeof import('react-native');

  return {
    ScreenSafeAreaView: ({ children }: import('react').PropsWithChildren) =>
      React.createElement(View, null, children),
    Text,
  };
});

jest.mock('./components/conversation-row', () => ({
  ConversationRow: () => null,
}));

jest.mock('./components/message-bubble', () => ({
  MessageBubble: () => null,
}));

describe('InboxPreview', () => {
  const originalDev = __DEV__;

  afterEach(() => {
    Object.defineProperty(globalThis, '__DEV__', {
      configurable: true,
      value: originalDev,
    });
  });

  it('redirects production deep links instead of rendering a blank route', () => {
    Object.defineProperty(globalThis, '__DEV__', {
      configurable: true,
      value: false,
    });

    render(<InboxPreview />);

    expect(screen.getByLabelText('Redirect to /')).toBeTruthy();
  });
});
