import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { Linking } from 'react-native';

import { message } from '../inbox-test-fixtures';
import { MessageContent } from './message-content';

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

describe('MessageContent', () => {
  it('renders unsafe media as unavailable instead of opening it', () => {
    render(
      <MessageContent
        message={message({
          contentType: 'document',
          mediaUrl: 'file:///secret',
        })}
      />
    );

    expect(screen.getByText('Document unavailable')).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders a safe photo with a native accessibility description', () => {
    render(
      <MessageContent
        message={message({
          contentType: 'image',
          mediaUrl: 'https://cdn.example.com/photo.jpg',
        })}
      />
    );

    expect(screen.getByLabelText('Photo attachment')).toBeTruthy();
  });

  it('shows an inline failure when opening a safe attachment fails', async () => {
    jest
      .spyOn(Linking, 'openURL')
      .mockRejectedValueOnce(new Error('Unavailable'));

    render(
      <MessageContent
        message={message({
          contentType: 'audio',
          mediaUrl: 'https://cdn.example.com/voice.ogg',
        })}
      />
    );

    fireEvent.press(screen.getByRole('button', { name: 'Open audio' }));

    await waitFor(() => {
      expect(screen.getByText('Unable to open audio')).toBeTruthy();
    });
  });
});
