import { afterEach, describe, expect, it, vi } from 'vitest';

interface FakeOscillator {
  frequency: { setValueAtTime: ReturnType<typeof vi.fn> };
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  addEventListener: ReturnType<typeof vi.fn>;
  type: OscillatorType;
}

function audioHarness(state: AudioContextState = 'running') {
  const oscillators: FakeOscillator[] = [];
  const gains: Array<{
    gain: {
      setValueAtTime: ReturnType<typeof vi.fn>;
      exponentialRampToValueAtTime: ReturnType<typeof vi.fn>;
    };
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
  }> = [];
  const context = {
    state,
    currentTime: 1,
    destination: {},
    resume: vi.fn(async () => {
      context.state = 'running';
    }),
    createOscillator: vi.fn(() => {
      const oscillator: FakeOscillator = {
        frequency: { setValueAtTime: vi.fn() },
        connect: vi.fn(),
        disconnect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        addEventListener: vi.fn(),
        type: 'sine',
      };
      oscillators.push(oscillator);
      return oscillator;
    }),
    createGain: vi.fn(() => {
      const gain = {
        gain: {
          setValueAtTime: vi.fn(),
          exponentialRampToValueAtTime: vi.fn(),
        },
        connect: vi.fn(),
        disconnect: vi.fn(),
      };
      gains.push(gain);
      return gain;
    }),
  };
  return { context, oscillators, gains };
}

async function soundModule(
  context?: ReturnType<typeof audioHarness>['context']
) {
  vi.resetModules();
  const windowValue = context
    ? {
        AudioContext: vi.fn(function FakeAudioContext() {
          return context;
        }),
      }
    : { AudioContext: undefined };
  vi.stubGlobal('window', windowValue);
  return import('./notification-sounds');
}

afterEach(() => vi.unstubAllGlobals());

describe('notification Web Audio resilience', () => {
  it('stays nonthrowing when AudioContext is missing or its constructor fails', async () => {
    const missing = await soundModule();
    await expect(missing.unlockNotificationAudio()).resolves.toBe(false);
    expect(missing.playInboxMessageTone()).toBe(false);

    vi.resetModules();
    vi.stubGlobal('window', {
      AudioContext: vi.fn(function BrokenAudioContext() {
        throw new Error('constructor failed');
      }),
    });
    const broken = await import('./notification-sounds');
    await expect(broken.unlockNotificationAudio()).resolves.toBe(false);
  });

  it('discards the current pulse while resuming and permits the next one', async () => {
    const harness = audioHarness('suspended');
    const sounds = await soundModule(harness.context);
    await expect(sounds.unlockNotificationAudio()).resolves.toBe(true);
    harness.context.state = 'suspended';

    expect(sounds.playInboxMessageTone()).toBe(false);
    await Promise.resolve();
    expect(sounds.playInboxMessageTone()).toBe(true);
  });

  it('cleans reminder oscillators even when stop or disconnect throws', async () => {
    const harness = audioHarness();
    const sounds = await soundModule(harness.context);
    await sounds.unlockNotificationAudio();
    expect(sounds.playFollowUpReminderTone()).toBe(true);
    harness.oscillators[0].stop.mockImplementation(() => {
      throw new Error('already stopped');
    });
    harness.oscillators[0].disconnect.mockImplementation(() => {
      throw new Error('already disconnected');
    });

    expect(() => sounds.stopFollowUpReminderTone()).not.toThrow();
    expect(() => sounds.stopFollowUpReminderTone()).not.toThrow();
  });
});
