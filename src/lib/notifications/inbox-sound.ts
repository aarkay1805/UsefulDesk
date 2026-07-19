/**
 * A short, generated two-note inbox chime. Keeping the sound in Web Audio
 * avoids shipping or licensing an audio asset, while still giving Inbox a
 * distinct cue from generic product notifications.
 *
 * Browsers only allow audible playback after a user gesture. The dashboard
 * arms this context on the first pointer or keyboard interaction; messages
 * received before that remain visual-only instead of playing a delayed tone.
 */

type AudioContextConstructor = typeof AudioContext;

type WebkitAudioWindow = Window &
  typeof globalThis & {
    webkitAudioContext?: AudioContextConstructor;
  };

let audioContext: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;

  const AudioContextClass =
    window.AudioContext || (window as WebkitAudioWindow).webkitAudioContext;
  if (!AudioContextClass) return null;

  try {
    audioContext ??= new AudioContextClass();
    return audioContext;
  } catch {
    return null;
  }
}

/** Call from a real user gesture so later realtime events may play audio. */
export async function unlockInboxSound(): Promise<boolean> {
  const context = getAudioContext();
  if (!context) return false;

  try {
    if (context.state === 'suspended') await context.resume();
    return context.state === 'running';
  } catch {
    return false;
  }
}

function scheduleBellNote(
  context: AudioContext,
  frequency: number,
  startAt: number,
  volume: number
) {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const duration = 0.28;

  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(frequency, startAt);

  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(volume, startAt + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);

  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(startAt);
  oscillator.stop(startAt + duration);
}

/** Plays immediately when audio has already been unlocked. */
export function playInboxMessageTone(): boolean {
  const context = audioContext;
  if (!context || context.state !== 'running') {
    // A context can be suspended after the laptop sleeps. Resume it for the
    // next message, but do not queue this tone to play late.
    if (context?.state === 'suspended') void context.resume().catch(() => {});
    return false;
  }

  const now = context.currentTime + 0.01;
  scheduleBellNote(context, 659.25, now, 0.055);
  scheduleBellNote(context, 880, now + 0.105, 0.045);
  return true;
}
