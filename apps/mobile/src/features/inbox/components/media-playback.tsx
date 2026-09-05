import { useEvent } from 'expo';
import {
  setAudioModeAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
} from 'expo-audio';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, View } from 'react-native';

import { Button } from '../../../ui/button';
import { IconButton } from '../../../ui/icon-button';
import { Notice } from '../../../ui/notice';
import { Text } from '../../../ui/text';

// Only one attachment speaks at a time, including a staged preview.
let activePlayback: (() => void) | null = null;
function claimPlayback(pause: () => void) {
  if (activePlayback !== pause) activePlayback?.();
  activePlayback = pause;
}

function usePlaybackLifetime(pause: () => void) {
  const stopForLifecycle = useCallback(() => {
    try {
      pause();
    } catch {
      // Expo's player hook can release its native object before our cleanup.
      // Disposal already stops playback; navigation must still finish.
    }
  }, [pause]);
  useFocusEffect(
    useCallback(
      () => () => {
        stopForLifecycle();
        if (activePlayback === pause) activePlayback = null;
      },
      [pause, stopForLifecycle]
    )
  );
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') stopForLifecycle();
    });
    return () => subscription.remove();
  }, [stopForLifecycle]);
}

function playbackTime(seconds: number) {
  const value = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
}

export function AudioAttachment({ uri }: { uri: string }) {
  // Loading starts only after a deliberate Play, not for every row in history.
  const player = useAudioPlayer(null);
  const status = useAudioPlayerStatus(player);
  const [requested, setRequested] = useState(false);
  const [failed, setFailed] = useState(false);
  const [speed, setSpeed] = useState(1);
  const wantsPlayback = useRef(false);
  const generation = useRef(0);
  const pause = useCallback(() => {
    generation.current += 1;
    wantsPlayback.current = false;
    player.pause();
  }, [player]);
  usePlaybackLifetime(pause);

  useEffect(() => {
    if (!status.isLoaded || !wantsPlayback.current) return;
    wantsPlayback.current = false;
    player.play();
  }, [player, status.isLoaded]);

  const toggle = async (restart = false) => {
    if (status.playing) {
      pause();
      return;
    }
    claimPlayback(pause);
    setFailed(false);
    const attempt = ++generation.current;
    try {
      await setAudioModeAsync({
        playsInSilentMode: true,
        shouldPlayInBackground: false,
        interruptionMode: 'doNotMix',
      });
      if (generation.current !== attempt) return;
      if (
        restart ||
        !requested ||
        status.playbackState === 'error' ||
        Boolean(status.error)
      ) {
        wantsPlayback.current = true;
        setRequested(true);
        player.replace(uri);
      } else {
        if (status.didJustFinish || status.currentTime >= status.duration)
          await player.seekTo(0);
        if (generation.current !== attempt) return;
        player.play();
      }
    } catch {
      if (generation.current !== attempt) return;
      wantsPlayback.current = false;
      setFailed(true);
    }
  };
  const hasError =
    failed || status.playbackState === 'error' || Boolean(status.error);
  const loading =
    requested && !hasError && (!status.isLoaded || status.isBuffering);
  const duration = status.duration || 0;
  const progress =
    duration > 0 ? Math.min(100, (status.currentTime / duration) * 100) : 0;

  return (
    <View className="gap-2">
      <View className="flex-row items-center gap-2">
        <IconButton
          accessibilityLabel={status.playing ? 'Pause audio' : 'Play audio'}
          isLoading={loading}
          onPress={() => void toggle()}
          symbol={status.playing ? 'pause.fill' : 'play.fill'}
          variant="ghost"
        />
        <View className="min-w-0 flex-1 gap-2">
          <Text className="text-foreground text-sm font-medium">Audio</Text>
          <View
            accessible
            accessibilityLabel="Audio playback"
            accessibilityRole="progressbar"
            accessibilityValue={{
              min: 0,
              max: 100,
              now: Math.round(progress),
              text: `${playbackTime(status.currentTime)} of ${playbackTime(duration)}`,
            }}
            className="bg-foreground/15 h-1 overflow-hidden rounded-full"
          >
            <View
              className="bg-foreground h-1"
              style={{ width: `${progress}%` }}
            />
          </View>
          <Text className="text-foreground text-xs tabular-nums">
            {requested
              ? `${playbackTime(status.currentTime)} / ${playbackTime(duration)}`
              : 'Tap play to listen'}
          </Text>
        </View>
        {status.isLoaded ? (
          <Button
            accessibilityLabel={`Playback speed ${speed} times. Change speed`}
            onPress={() => {
              const next = speed === 1 ? 1.5 : speed === 1.5 ? 2 : 1;
              player.setPlaybackRate(next);
              setSpeed(next);
            }}
            size="sm"
            variant="ghost"
          >
            {speed}×
          </Button>
        ) : null}
      </View>
      {hasError ? (
        <Notice
          tone="danger"
          action={
            <Button
              onPress={() => {
                void toggle(true);
              }}
              size="sm"
              variant="ghost"
            >
              Retry audio
            </Button>
          }
        >
          Audio unavailable. Try loading it again.
        </Notice>
      ) : null}
    </View>
  );
}

export function VideoAttachment({
  uri,
  width = 240,
  height = 180,
}: {
  uri: string;
  width?: number | '100%';
  height?: number;
}) {
  const player = useVideoPlayer(uri, (instance) => {
    instance.loop = false;
    instance.showNowPlayingNotification = false;
  });
  const { status } = useEvent(player, 'statusChange', {
    status: player.status,
  });
  const pause = useCallback(() => player.pause(), [player]);
  usePlaybackLifetime(pause);
  useEffect(() => {
    const subscription = player.addListener(
      'playingChange',
      ({ isPlaying }) => {
        if (isPlaying) claimPlayback(pause);
      }
    );
    return () => subscription.remove();
  }, [pause, player]);
  return (
    <View className="gap-2">
      <View className="overflow-hidden rounded-xl" style={{ width, height }}>
        <VideoView
          accessibilityLabel="Video attachment"
          contentFit="contain"
          fullscreenOptions={{ enable: true }}
          nativeControls
          player={player}
          style={{ width: '100%', height: '100%' }}
        />
      </View>
      {status === 'loading' ? (
        <Text
          accessibilityLiveRegion="polite"
          className="text-foreground text-sm"
        >
          Loading video…
        </Text>
      ) : null}
      {status === 'error' ? (
        <Notice
          tone="danger"
          action={
            <Button
              onPress={() =>
                void player.replaceAsync(uri).catch(() => undefined)
              }
              size="sm"
              variant="ghost"
            >
              Retry video
            </Button>
          }
        >
          Video unavailable. Try loading it again.
        </Notice>
      ) : null}
    </View>
  );
}
