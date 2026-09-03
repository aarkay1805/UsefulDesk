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
  afterEach(() => jest.restoreAllMocks());

  it.each([
    ['text', null, 'Hello'],
    ['template', null, 'Template content'],
    ['interactive', null, 'Button reply content'],
    ['image', 'https://cdn.example.com/photo.jpg', 'Photo caption'],
    ['video', 'https://cdn.example.com/video.mp4', 'Video caption'],
    ['audio', 'https://cdn.example.com/voice.ogg', 'Audio caption'],
    ['document', 'https://cdn.example.com/receipt.pdf', 'Document caption'],
    ['location', 'https://maps.example.com/place', 'Location caption'],
  ] as const)(
    'renders %s content and its caption honestly',
    (contentType, mediaUrl, contentText) => {
      render(
        <MessageContent
          message={message({ contentType, contentText, mediaUrl })}
        />
      );

      expect(screen.getByText(contentText)).toBeTruthy();
    }
  );

  it('renders a safe photo with its native accessibility description and no redundant label', () => {
    render(
      <MessageContent
        message={message({
          contentType: 'image',
          contentText: null,
          mediaUrl: 'https://cdn.example.com/photo.jpg',
        })}
      />
    );

    expect(screen.getByLabelText('Photo attachment')).toBeTruthy();
    expect(screen.queryByText('Photo')).toBeNull();
  });

  it('renders a narrow-bubble photo at the supplied 4:3 bounds', () => {
    render(
      <MessageContent
        imageSize={{ height: 129, width: 172 }}
        message={message({
          contentType: 'image',
          contentText: null,
          mediaUrl: 'https://cdn.example.com/photo.jpg',
        })}
      />
    );

    expect(screen.getByLabelText('Photo attachment').props.style).toEqual({
      height: 129,
      width: 172,
    });
  });

  it.each(['video', 'audio', 'document', 'location'] as const)(
    'renders safe %s media with its open action',
    (contentType) => {
      render(
        <MessageContent
          message={message({
            contentType,
            contentText: null,
            mediaUrl: `https://cdn.example.com/${contentType}`,
          })}
        />
      );

      expect(
        screen.getByRole('button', { name: `Open ${contentType}` })
      ).toBeTruthy();
    }
  );

  it('renders the local filename for an optimistic document without changing its open action', () => {
    render(
      <MessageContent
        message={message({
          id: 'temp:optimistic-document',
          senderType: 'agent',
          status: 'sending',
          contentType: 'document',
          contentText: null,
          mediaFilename: 'renewal.pdf',
          mediaUrl: 'https://cdn.example.com/renewal.pdf',
        })}
      />
    );

    expect(screen.getByText('renewal.pdf')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open document' })).toBeTruthy();
  });

  it.each([
    ['image', 'Photo'],
    ['video', 'Video'],
    ['audio', 'Audio'],
    ['document', 'Document'],
    ['location', 'Location'],
  ] as const)(
    'does not repeat the %s preview beside unavailable no-caption media',
    (contentType, label) => {
      render(
        <MessageContent
          message={message({
            contentType,
            contentText: null,
            mediaUrl: 'file:///secret',
          })}
        />
      );

      expect(screen.getByText(`${label} unavailable`)).toBeTruthy();
      expect(screen.queryByText(label)).toBeNull();
    }
  );

  it.each([
    ['image', 'Photo'],
    ['video', 'Video'],
    ['audio', 'Audio'],
    ['document', 'Document'],
    ['location', 'Location'],
  ] as const)(
    'renders unsafe %s media as unavailable while preserving its caption',
    (contentType, label) => {
      render(
        <MessageContent
          message={message({
            contentType,
            contentText: `${label} caption`,
            mediaUrl: 'file:///secret',
          })}
        />
      );

      expect(screen.getByText(`${label} unavailable`)).toBeTruthy();
      expect(screen.getByText(`${label} caption`)).toBeTruthy();
      expect(screen.queryByRole('button')).toBeNull();
    }
  );

  it('keeps location text visible without a URL', () => {
    render(
      <MessageContent
        message={message({
          contentType: 'location',
          contentText: 'Front desk, 14 MG Road',
          mediaUrl: null,
        })}
      />
    );

    expect(screen.getByText('Location unavailable')).toBeTruthy();
    expect(screen.getByText('Front desk, 14 MG Road')).toBeTruthy();
  });

  it('falls back when a safe photo fails to load', () => {
    render(
      <MessageContent
        message={message({
          contentType: 'image',
          mediaUrl: 'https://cdn.example.com/photo.jpg',
        })}
      />
    );

    fireEvent(screen.getByLabelText('Photo attachment'), 'error');

    expect(screen.getByText('Photo unavailable')).toBeTruthy();
  });

  it('disables repeated attachment opens while the URL is opening', async () => {
    let rejectOpen: (reason?: unknown) => void = () => undefined;
    jest.spyOn(Linking, 'openURL').mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectOpen = reject;
        })
    );

    render(
      <MessageContent
        message={message({
          contentType: 'audio',
          mediaUrl: 'https://cdn.example.com/voice.ogg',
        })}
      />
    );

    const openButton = screen.getByRole('button', { name: 'Open audio' });
    fireEvent.press(openButton);

    expect(openButton.props.accessibilityState).toEqual({
      busy: true,
      disabled: true,
    });
    fireEvent.press(openButton);
    expect(Linking.openURL).toHaveBeenCalledTimes(1);

    rejectOpen(new Error('Unavailable'));

    await waitFor(() => {
      expect(screen.getByText('Unable to open audio')).toBeTruthy();
    });
  });
});
