import { describe, expect, it } from 'vitest';
import {
  getReminderRingPhase,
  REMINDER_CYCLE_MS,
  REMINDER_MAX_AGE_MS,
  REMINDER_RING_MS,
} from './reminder-ringtone';

describe('getReminderRingPhase', () => {
  const createdAt = 1_000_000;

  it('rings immediately for the first minute', () => {
    expect(getReminderRingPhase(createdAt, createdAt)).toMatchObject({
      active: true,
      ringing: true,
      msUntilTransition: REMINDER_RING_MS,
    });
    expect(
      getReminderRingPhase(createdAt, createdAt + REMINDER_RING_MS - 1).ringing
    ).toBe(true);
  });

  it('pauses for five minutes and rings again at the next cycle', () => {
    expect(
      getReminderRingPhase(createdAt, createdAt + REMINDER_RING_MS)
    ).toMatchObject({ active: true, ringing: false });
    expect(
      getReminderRingPhase(createdAt, createdAt + REMINDER_CYCLE_MS)
    ).toMatchObject({
      active: true,
      ringing: true,
      msUntilTransition: REMINDER_RING_MS,
    });
  });

  it('expires after one hour', () => {
    expect(
      getReminderRingPhase(createdAt, createdAt + REMINDER_MAX_AGE_MS - 1)
        .active
    ).toBe(true);
    expect(
      getReminderRingPhase(createdAt, createdAt + REMINDER_MAX_AGE_MS)
    ).toEqual({
      active: false,
      ringing: false,
      msUntilTransition: Infinity,
    });
  });

  it('waits for a future delivery timestamp and rejects invalid dates', () => {
    expect(getReminderRingPhase(createdAt, createdAt - 500)).toEqual({
      active: true,
      ringing: false,
      msUntilTransition: 500,
    });
    expect(getReminderRingPhase(Number.NaN, createdAt).active).toBe(false);
  });
});
