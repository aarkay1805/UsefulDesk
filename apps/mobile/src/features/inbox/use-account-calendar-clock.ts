import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

import {
  dayStartInTz,
  todayInTz,
} from '../../../../../src/lib/locale/format';

const DAY_MS = 86_400_000;
const BOUNDARY_GRACE_MS = 100;

function nextCalendarDay(day: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return null;
  return new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + 1)
  )
    .toISOString()
    .slice(0, 10);
}

function delayUntilNextDay(timeZone: string, now: Date): number {
  const tomorrow = nextCalendarDay(todayInTz(timeZone, now));
  const boundary = tomorrow ? dayStartInTz(tomorrow, timeZone) : null;
  const delay = (boundary?.getTime() ?? now.getTime() + DAY_MS) - now.getTime();
  return Math.max(BOUNDARY_GRACE_MS, delay + BOUNDARY_GRACE_MS);
}

/**
 * A clock that advances when the account's calendar day changes.
 *
 * Chat timestamps only need a new instant at day boundaries, rather than a
 * timer per row. Resuming the app refreshes immediately because native timers
 * may have been suspended while the app was in the background.
 */
export function useAccountCalendarClock(timeZone: string): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout> | null = null;

    const schedule = () => {
      if (timeout) clearTimeout(timeout);
      const current = new Date();
      timeout = setTimeout(() => {
        setNow(new Date());
        schedule();
      }, delayUntilNextDay(timeZone, current));
    };

    schedule();
    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      setNow(new Date());
      schedule();
    });

    return () => {
      if (timeout) clearTimeout(timeout);
      appStateSubscription.remove();
    };
  }, [timeZone]);

  return now;
}
