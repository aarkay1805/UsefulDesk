export const REMINDER_RING_MS = 60_000;
export const REMINDER_PAUSE_MS = 5 * 60_000;
export const REMINDER_CYCLE_MS = REMINDER_RING_MS + REMINDER_PAUSE_MS;
export const REMINDER_MAX_AGE_MS = 60 * 60_000;
export const REMINDER_PULSE_MS = 6_000;

export interface ReminderRingPhase {
  active: boolean;
  ringing: boolean;
  /** Time until this reminder starts/stops ringing or expires. */
  msUntilTransition: number;
}

/**
 * Resolve the repeating 1-minute-ring / 5-minute-pause schedule for one
 * unread reminder. The whole schedule expires one hour after delivery.
 */
export function getReminderRingPhase(
  createdAtMs: number,
  nowMs: number
): ReminderRingPhase {
  if (!Number.isFinite(createdAtMs) || !Number.isFinite(nowMs)) {
    return { active: false, ringing: false, msUntilTransition: Infinity };
  }

  const ageMs = nowMs - createdAtMs;
  if (ageMs < 0) {
    return {
      active: true,
      ringing: false,
      msUntilTransition: -ageMs,
    };
  }
  if (ageMs >= REMINDER_MAX_AGE_MS) {
    return { active: false, ringing: false, msUntilTransition: Infinity };
  }

  const cycleOffset = ageMs % REMINDER_CYCLE_MS;
  const ringing = cycleOffset < REMINDER_RING_MS;
  const untilPhaseChange = ringing
    ? REMINDER_RING_MS - cycleOffset
    : REMINDER_CYCLE_MS - cycleOffset;

  return {
    active: true,
    ringing,
    msUntilTransition: Math.max(
      1,
      Math.min(untilPhaseChange, REMINDER_MAX_AGE_MS - ageMs)
    ),
  };
}
