'use client';

import { useEffect } from 'react';
import { unlockNotificationAudio } from '@/lib/notifications/notification-sounds';

/** Arms the shared Web Audio context without prompting for permissions. */
export function useNotificationAudio(enabled = true) {
  useEffect(() => {
    if (!enabled) return;

    const unlock = () => void unlockNotificationAudio();
    if (navigator.userActivation?.hasBeenActive) unlock();

    window.addEventListener('pointerdown', unlock, {
      capture: true,
      once: true,
    });
    window.addEventListener('keydown', unlock, { capture: true, once: true });
    return () => {
      window.removeEventListener('pointerdown', unlock, true);
      window.removeEventListener('keydown', unlock, true);
    };
  }, [enabled]);
}
