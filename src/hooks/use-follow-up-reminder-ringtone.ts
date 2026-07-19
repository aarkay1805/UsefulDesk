'use client';

import { useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { Notification } from '@/types';
import {
  playFollowUpReminderTone,
  stopFollowUpReminderTone,
} from '@/lib/notifications/notification-sounds';
import {
  getReminderRingPhase,
  REMINDER_MAX_AGE_MS,
  REMINDER_PULSE_MS,
} from '@/lib/notifications/reminder-ringtone';

type ReminderNotification = Pick<
  Notification,
  'id' | 'type' | 'read_at' | 'created_at'
>;

interface QueuedNotificationEvent {
  eventType: 'INSERT' | 'UPDATE' | 'DELETE';
  newRow: Notification | null;
  oldRow: Partial<Notification>;
}

/**
 * Rings for unread follow-up reminder notifications: one minute on, five
 * minutes off, repeating for at most one hour after notification delivery.
 */
export function useFollowUpReminderRingtone(enabled = true) {
  useEffect(() => {
    if (!enabled) return;

    const supabase = createClient();
    const reminders = new Map<string, ReminderNotification>();
    const queuedEvents: QueuedNotificationEvent[] = [];
    let cancelled = false;
    let hydrated = false;
    let hydrationStarted = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let lastPulseAt = Number.NEGATIVE_INFINITY;

    const clearTimer = () => {
      if (timer) clearTimeout(timer);
      timer = null;
    };

    const schedule = () => {
      clearTimer();
      if (cancelled) return;

      const now = Date.now();
      let ringing = false;
      let nextWakeMs = Infinity;

      for (const [id, reminder] of reminders) {
        const phase = getReminderRingPhase(
          Date.parse(reminder.created_at),
          now
        );
        if (!phase.active) {
          reminders.delete(id);
          continue;
        }
        ringing ||= phase.ringing;
        nextWakeMs = Math.min(nextWakeMs, phase.msUntilTransition);
      }

      if (ringing) {
        const untilNextPulse = REMINDER_PULSE_MS - (now - lastPulseAt);
        if (untilNextPulse <= 0) {
          // Count an attempted pulse even when autoplay is still locked. This
          // avoids a tight retry loop; the next pulse follows in six seconds.
          playFollowUpReminderTone();
          lastPulseAt = now;
          nextWakeMs = Math.min(nextWakeMs, REMINDER_PULSE_MS);
        } else {
          nextWakeMs = Math.min(nextWakeMs, untilNextPulse);
        }
      } else {
        stopFollowUpReminderTone();
      }

      if (Number.isFinite(nextWakeMs)) {
        timer = setTimeout(schedule, Math.max(250, nextWakeMs));
      }
    };

    const applyEvent = (event: QueuedNotificationEvent) => {
      if (event.eventType === 'DELETE') {
        if (event.oldRow.id) reminders.delete(event.oldRow.id);
        return;
      }

      const row = event.newRow;
      if (!row) return;
      if (row.type === 'follow_up_reminder' && !row.read_at) {
        reminders.set(row.id, row);
      } else {
        reminders.delete(row.id);
      }
    };

    const hydrate = async () => {
      const cutoff = new Date(Date.now() - REMINDER_MAX_AGE_MS).toISOString();
      const { data } = await supabase
        .from('notifications')
        .select('id, type, read_at, created_at')
        .eq('type', 'follow_up_reminder')
        .is('read_at', null)
        .gte('created_at', cutoff);
      if (cancelled) return;

      for (const row of (data ?? []) as ReminderNotification[]) {
        reminders.set(row.id, row);
      }
      hydrated = true;
      for (const event of queuedEvents) applyEvent(event);
      queuedEvents.length = 0;
      schedule();
    };

    const channel = supabase
      .channel('follow-up-reminder-ringtone')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'notifications' },
        (payload) => {
          const event: QueuedNotificationEvent = {
            eventType:
              payload.eventType as QueuedNotificationEvent['eventType'],
            newRow:
              payload.eventType === 'DELETE'
                ? null
                : (payload.new as Notification),
            oldRow: payload.old as Partial<Notification>,
          };
          if (!hydrated) {
            queuedEvents.push(event);
            return;
          }
          applyEvent(event);
          schedule();
        }
      )
      .subscribe((status) => {
        // Query only after the subscription is live: rows inserted before
        // this point land in the snapshot; rows inserted during it queue in
        // the callback above, so there is no query/subscription gap.
        if (status === 'SUBSCRIBED' && !hydrationStarted) {
          hydrationStarted = true;
          void hydrate();
        }
      });

    return () => {
      cancelled = true;
      clearTimer();
      stopFollowUpReminderTone();
      supabase.removeChannel(channel);
    };
  }, [enabled]);
}
