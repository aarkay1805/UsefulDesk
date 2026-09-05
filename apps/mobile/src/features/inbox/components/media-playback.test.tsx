import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { AudioAttachment, VideoAttachment } from './media-playback';

const mockAudio = {
  pause: jest.fn(),
  play: jest.fn(),
  replace: jest.fn(),
  seekTo: jest.fn().mockResolvedValue(undefined),
  setPlaybackRate: jest.fn(),
};
const mockVideo = {
  pause: jest.fn(),
  addListener: jest.fn(() => ({ remove: jest.fn() })),
  status: 'readyToPlay',
  replaceAsync: jest.fn().mockResolvedValue(undefined),
};
let mockStatus: any;
jest.mock('expo-audio', () => ({
  setAudioModeAsync: jest.fn().mockResolvedValue(undefined),
  useAudioPlayer: () => mockAudio,
  useAudioPlayerStatus: () => mockStatus,
}));
jest.mock('expo-video', () => {
  const React = jest.requireActual('react');
  const { View } = jest.requireActual('react-native');
  return {
    useVideoPlayer: () => mockVideo,
    VideoView: (props: any) => React.createElement(View, props),
  };
});
jest.mock('expo', () => ({
  useEvent: (_player: any, _event: any, fallback: any) => fallback,
}));
jest.mock('expo-router', () => ({
  useFocusEffect: (effect: any) =>
    jest.requireActual('react').useEffect(effect, [effect]),
}));
jest.mock('../../../ui/button', () => {
  const React = jest.requireActual('react');
  const { Pressable, Text } = jest.requireActual('react-native');
  return {
    Button: ({ children, ...props }: any) =>
      React.createElement(
        Pressable,
        { ...props, accessibilityRole: 'button' },
        React.createElement(Text, null, children)
      ),
  };
});
jest.mock('../../../ui/icon-button', () => {
  const React = jest.requireActual('react');
  const { Pressable } = jest.requireActual('react-native');
  return {
    IconButton: ({ isLoading, ...props }: any) =>
      React.createElement(Pressable, {
        ...props,
        accessibilityRole: 'button',
        disabled: isLoading,
      }),
  };
});

describe('attachment playback', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest
      .spyOn(AppState, 'addEventListener')
      .mockReturnValue({ remove: jest.fn() });
    mockStatus = {
      currentTime: 0,
      duration: 0,
      isLoaded: false,
      isBuffering: false,
      playing: false,
      playbackState: 'idle',
      error: null,
    };
  });
  it('loads audio only on Play and resumes once ready', async () => {
    const view = render(
      <AudioAttachment uri="https://example.com/audio.mp3" />
    );
    expect(mockAudio.replace).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Play audio'));
    });
    expect(mockAudio.replace).toHaveBeenCalledWith(
      'https://example.com/audio.mp3'
    );
    expect(mockAudio.play).not.toHaveBeenCalled();
    mockStatus = { ...mockStatus, isLoaded: true, duration: 25 };
    view.rerender(<AudioAttachment uri="https://example.com/audio.mp3" />);
    expect(mockAudio.play).toHaveBeenCalledTimes(1);
    expect(screen.getByText('0:00 / 0:25')).toBeTruthy();
  });
  it('pauses playing audio and supports deliberate speed changes', () => {
    mockStatus = {
      ...mockStatus,
      isLoaded: true,
      duration: 25,
      currentTime: 3,
      playing: true,
    };
    render(<AudioAttachment uri="https://example.com/audio.mp3" />);
    fireEvent.press(screen.getByLabelText('Pause audio'));
    expect(mockAudio.pause).toHaveBeenCalled();
    fireEvent.press(
      screen.getByLabelText('Playback speed 1 times. Change speed')
    );
    expect(mockAudio.setPlaybackRate).toHaveBeenCalledWith(1.5);
  });
  it('keeps raw playback errors private and reloads on Retry', async () => {
    mockStatus = {
      ...mockStatus,
      error: 'private URL diagnostic',
      playbackState: 'error',
    };
    render(<AudioAttachment uri="https://example.com/audio.mp3" />);
    expect(
      screen.getByText('Audio unavailable. Try loading it again.')
    ).toBeTruthy();
    expect(screen.queryByText('private URL diagnostic')).toBeNull();
    await act(async () => {
      fireEvent.press(screen.getByText('Retry audio'));
    });
    expect(mockAudio.replace).toHaveBeenCalledWith(
      'https://example.com/audio.mp3'
    );
  });
  it('does not begin delayed audio after the app backgrounds', async () => {
    let changed: any;
    const spy = jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation((_event, fn) => {
        changed = fn;
        return { remove: jest.fn() };
      });
    const view = render(
      <AudioAttachment uri="https://example.com/audio.mp3" />
    );
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Play audio'));
    });
    act(() => changed('background'));
    mockStatus = { ...mockStatus, isLoaded: true, duration: 25 };
    view.rerender(<AudioAttachment uri="https://example.com/audio.mp3" />);
    expect(mockAudio.play).not.toHaveBeenCalled();
    spy.mockRestore();
  });
  it('uses native video controls and releases playback when leaving', () => {
    const view = render(
      <VideoAttachment uri="https://example.com/video.mp4" />
    );
    expect(screen.getByLabelText('Video attachment').props.nativeControls).toBe(
      true
    );
    expect(
      screen.getByLabelText('Video attachment').props.fullscreenOptions
    ).toEqual({ enable: true });
    view.unmount();
    expect(mockVideo.pause).toHaveBeenCalled();
  });
  it('tolerates native players already released before screen cleanup', () => {
    const audio = render(<AudioAttachment uri="https://example.com/audio.mp3" />);
    const video = render(<VideoAttachment uri="https://example.com/video.mp4" />);
    const released = () => { throw new Error('Cannot use shared object that was already released'); };
    mockAudio.pause.mockImplementationOnce(released);
    mockVideo.pause.mockImplementationOnce(released);
    expect(() => audio.unmount()).not.toThrow();
    expect(() => video.unmount()).not.toThrow();
  });
  it('does not restart completed audio if the app backgrounds while seeking', async () => {
    let changed: any;
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, fn) => {
      changed = fn;
      return { remove: jest.fn() };
    });
    const view = render(<AudioAttachment uri="https://example.com/audio.mp3" />);
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Play audio'));
    });
    mockStatus = {
      ...mockStatus,
      isLoaded: true,
      duration: 25,
      currentTime: 25,
      didJustFinish: true,
    };
    view.rerender(<AudioAttachment uri="https://example.com/audio.mp3" />);
    mockAudio.play.mockClear();
    let finishSeek!: () => void;
    mockAudio.seekTo.mockImplementationOnce(
      () => new Promise<void>((resolve) => { finishSeek = resolve; })
    );
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Play audio'));
    });
    expect(mockAudio.seekTo).toHaveBeenCalledWith(0);
    await act(async () => {
      changed('background');
      finishSeek();
    });
    expect(mockAudio.play).not.toHaveBeenCalled();
  });
});
