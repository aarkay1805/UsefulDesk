import { act, render, screen } from '@testing-library/react-native';
import { Dimensions } from 'react-native';

import { conversation } from '../inbox-test-fixtures';
import { ConversationRow } from './conversation-row';

jest.mock('heroui-native', () => {
  const React = jest.requireActual('react') as typeof import('react');
  const { Image, Text, View } = jest.requireActual(
    'react-native'
  ) as typeof import('react-native');

  function MockAvatar(props: import('react-native').ViewProps) {
    return React.createElement(View, props);
  }

  function MockAvatarImage(props: import('react-native').ImageProps) {
    return React.createElement(Image, props);
  }

  function MockAvatarFallback({
    children,
  }: {
    children?: import('react').ReactNode;
  }) {
    return React.createElement(Text, null, children);
  }

  MockAvatar.Image = MockAvatarImage;
  MockAvatar.Fallback = MockAvatarFallback;

  return { Avatar: MockAvatar };
});

describe('ConversationRow', () => {
  const initialWindow = Dimensions.get('window');
  const initialScreen = Dimensions.get('screen');

  beforeEach(() => {
    act(() => {
      Dimensions.set({
        window: { ...initialWindow, fontScale: 1 },
        screen: { ...initialScreen, fontScale: 1 },
      });
    });
  });

  afterEach(() => {
    act(() => {
      Dimensions.set({ window: initialWindow, screen: initialScreen });
    });
  });

  it('renders a scannable row with formatted identity, preview, time, and unread count', () => {
    render(
      <ConversationRow
        conversation={conversation({ unreadCount: 3 })}
        formattedPhone="+919876543210"
        formattedTime="1:30 pm"
        onPress={jest.fn()}
      />
    );

    expect(screen.getByText('Asha Rao')).toBeTruthy();
    expect(screen.getByText('Your membership expires tomorrow')).toBeTruthy();
    expect(screen.getByText('1:30 pm')).toBeTruthy();
    expect(screen.getByLabelText('3 unread messages')).toBeTruthy();
    expect(screen.queryByText('+919876543210')).toBeNull();
    expect(
      screen.getByRole('button', {
        name: 'Open chat with Asha Rao, Your membership expires tomorrow, 1:30 pm, 3 unread messages',
      })
    ).toBeTruthy();
    expect(screen.getByText('Asha Rao').props.numberOfLines).toBeUndefined();
    expect(
      screen.getByText('Your membership expires tomorrow').props.numberOfLines
    ).toBe(2);
    expect(screen.getByTestId('conversation-row-metadata')).toBeTruthy();
    expect(screen.getByText('1:30 pm').props.className).toContain(
      'text-accent'
    );
    expect(
      screen.getByRole('button', {
        name: 'Open chat with Asha Rao, Your membership expires tomorrow, 1:30 pm, 3 unread messages',
      }).props.className
    ).not.toContain('bg-accent-soft');
  });

  it('uses the formatted phone as identity when the contact has no name', () => {
    render(
      <ConversationRow
        conversation={conversation({
          contact: {
            id: 'ba8df73d-a33e-4236-a93b-357149bc6ea0',
            name: null,
            phone: '9876543210',
            avatarUrl: null,
          },
          unreadCount: 0,
        })}
        formattedPhone="+91 98765 43210"
        formattedTime="1:30 pm"
        onPress={jest.fn()}
      />
    );

    expect(screen.getByText('+91 98765 43210')).toBeTruthy();
    expect(
      screen.getByRole('button', {
        name: 'Open chat with +91 98765 43210, Your membership expires tomorrow, 1:30 pm',
      })
    ).toBeTruthy();
    expect(screen.queryByLabelText(/unread message/)).toBeNull();
  });

  it('keeps the complete preview accessible while large text can reflow', () => {
    const preview =
      'Your membership expires tomorrow. Please visit the desk before the evening class to renew your plan.';

    render(
      <ConversationRow
        conversation={conversation({
          lastMessageText: preview,
          unreadCount: 20,
        })}
        formattedPhone="+91 98765 43210"
        formattedTime="Yesterday"
        onPress={jest.fn()}
      />
    );

    expect(screen.getByText(preview).props.numberOfLines).toBe(2);
    expect(
      screen.getByRole('button', {
        name: `Open chat with Asha Rao, ${preview}, Yesterday, 20 unread messages`,
      })
    ).toBeTruthy();

    act(() => {
      Dimensions.set({
        window: { ...initialWindow, fontScale: 2.643 },
        screen: { ...initialScreen, fontScale: 2.643 },
      });
    });

    expect(screen.getByText(preview).props.numberOfLines).toBeUndefined();
    expect(screen.getByText('20')).toBeTruthy();
    expect(screen.getByText('Yesterday')).toBeTruthy();
  });
});
