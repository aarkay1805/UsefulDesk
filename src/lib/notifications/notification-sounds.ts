/**
 * Generated product notification sounds. Web Audio keeps these cues distinct
 * without shipping or licensing audio files.
 *
 * Browsers only allow audible playback after a user gesture. The dashboard
 * unlocks this shared context after the first pointer or keyboard interaction;
 * sounds attempted before that remain silent rather than playing late.
 */

type AudioContextConstructor = typeof AudioContext;

type WebkitAudioWindow = Window &
  typeof globalThis & {
    webkitAudioContext?: AudioContextConstructor;
  };

let audioContext: AudioContext | null = null;
const activeReminderOscillators = new Map<OscillatorNode, GainNode>();

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
export async function unlockNotificationAudio(): Promise<boolean> {
  const context = getAudioContext();
  if (!context) return false;

  try {
    if (context.state === 'suspended') await context.resume();
    return context.state === 'running';
  } catch {
    return false;
  }
}

function runningAudioContext(): AudioContext | null {
  const context = audioContext;
  if (!context || context.state !== 'running') {
    // A context can be suspended after the laptop sleeps. Resume it for the
    // next pulse, but never queue the current sound to play late.
    if (context?.state === 'suspended') {
      try {
        void Promise.resolve(context.resume()).catch(() => {});
      } catch {
        // A resume failure only discards this pulse.
      }
    }
    return null;
  }
  return context;
}

function safeDisconnect(node: { disconnect(): void }) {
  try {
    node.disconnect();
  } catch {
    // Web Audio nodes may already be disconnected by the browser.
  }
}

function scheduleBellNote(
  context: AudioContext,
  frequency: number,
  startAt: number,
  volume: number,
  duration = 0.28,
  group?: Map<OscillatorNode, GainNode>,
  waveform: OscillatorType = 'sine',
  sustain = 0
): boolean {
  let oscillator: OscillatorNode | null = null;
  let gain: GainNode | null = null;
  try {
    oscillator = context.createOscillator();
    gain = context.createGain();

    oscillator.type = waveform;
    oscillator.frequency.setValueAtTime(frequency, startAt);

    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(volume, startAt + 0.012);
    if (sustain > 0)
      gain.gain.setValueAtTime(volume, startAt + 0.012 + sustain);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);

    oscillator.connect(gain);
    gain.connect(context.destination);
    group?.set(oscillator, gain);
    oscillator.addEventListener(
      'ended',
      () => {
        group?.delete(oscillator!);
        safeDisconnect(oscillator!);
        safeDisconnect(gain!);
      },
      { once: true }
    );
    oscillator.start(startAt);
    oscillator.stop(startAt + duration);
    return true;
  } catch {
    if (oscillator) group?.delete(oscillator);
    if (oscillator) safeDisconnect(oscillator);
    if (gain) safeDisconnect(gain);
    return false;
  }
}

/** Full, system-style bell: two strikes with bright upper partials. */
export function playInboxMessageTone(): boolean {
  try {
    const context = runningAudioContext();
    if (!context) return false;

    const now = context.currentTime + 0.01;
    // Frequency, onset, gain, decay length, and hold. The strong fundamental
    // provides body; shorter upper partials make the strike cut through noise.
    // These levels apply only to Inbox, not the repeating reminder ringtone.
    const partials = [
      [880, 0, 0.58, 0.8, 0.16],
      [1760, 0, 0.2, 0.45, 0.06],
      [2640, 0, 0.1, 0.3, 0.02],
      [1174.66, 0.3, 0.62, 0.95, 0.19],
      [2349.32, 0.3, 0.17, 0.5, 0.08],
      [3523.98, 0.3, 0.07, 0.35, 0.03],
    ] as const;
    return partials.every(([frequency, offset, gain, duration, sustain]) =>
      scheduleBellNote(
        context,
        frequency,
        now + offset,
        gain,
        duration,
        undefined,
        'sine',
        sustain
      )
    );
  } catch {
    return false;
  }
}

/** One gentle ringtone pulse; the reminder scheduler controls repetition. */
export function playFollowUpReminderTone(): boolean {
  try {
    const context = runningAudioContext();
    if (!context) return false;

    const now = context.currentTime + 0.01;
    return (
      scheduleBellNote(
        context,
        523.25,
        now,
        0.036,
        0.22,
        activeReminderOscillators
      ) &&
      scheduleBellNote(
        context,
        659.25,
        now + 0.24,
        0.034,
        0.24,
        activeReminderOscillators
      ) &&
      scheduleBellNote(
        context,
        523.25,
        now + 0.56,
        0.03,
        0.22,
        activeReminderOscillators
      )
    );
  } catch {
    return false;
  }
}

/** Stops a pulse immediately when every ringing reminder is read or paused. */
export function stopFollowUpReminderTone() {
  for (const [oscillator, gain] of activeReminderOscillators) {
    try {
      oscillator.stop();
    } catch {
      // The oscillator may have ended between iteration and stop().
    }
    safeDisconnect(oscillator);
    safeDisconnect(gain);
  }
  activeReminderOscillators.clear();
}
