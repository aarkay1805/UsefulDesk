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
const activeReminderOscillators = new Set<OscillatorNode>();

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
    if (context?.state === 'suspended') void context.resume().catch(() => {});
    return null;
  }
  return context;
}

function scheduleBellNote(
  context: AudioContext,
  frequency: number,
  startAt: number,
  volume: number,
  duration = 0.28,
  group?: Set<OscillatorNode>
) {
  const oscillator = context.createOscillator();
  const gain = context.createGain();

  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(frequency, startAt);

  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(volume, startAt + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);

  oscillator.connect(gain);
  gain.connect(context.destination);
  group?.add(oscillator);
  oscillator.addEventListener(
    'ended',
    () => {
      group?.delete(oscillator);
      oscillator.disconnect();
      gain.disconnect();
    },
    { once: true }
  );
  oscillator.start(startAt);
  oscillator.stop(startAt + duration);
}

/** Short two-note cue for a newly received Inbox message. */
export function playInboxMessageTone(): boolean {
  const context = runningAudioContext();
  if (!context) return false;

  const now = context.currentTime + 0.01;
  scheduleBellNote(context, 659.25, now, 0.055);
  scheduleBellNote(context, 880, now + 0.105, 0.045);
  return true;
}

/** One gentle ringtone pulse; the reminder scheduler controls repetition. */
export function playFollowUpReminderTone(): boolean {
  const context = runningAudioContext();
  if (!context) return false;

  const now = context.currentTime + 0.01;
  scheduleBellNote(
    context,
    523.25,
    now,
    0.036,
    0.22,
    activeReminderOscillators
  );
  scheduleBellNote(
    context,
    659.25,
    now + 0.24,
    0.034,
    0.24,
    activeReminderOscillators
  );
  scheduleBellNote(
    context,
    523.25,
    now + 0.56,
    0.03,
    0.22,
    activeReminderOscillators
  );
  return true;
}

/** Stops a pulse immediately when every ringing reminder is read or paused. */
export function stopFollowUpReminderTone() {
  for (const oscillator of activeReminderOscillators) {
    try {
      oscillator.stop();
    } catch {
      // The oscillator may have ended between iteration and stop().
    }
  }
  activeReminderOscillators.clear();
}
