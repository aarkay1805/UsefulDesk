'use client';

import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { Conversation, Message } from '@/types';
import {
  playInboxMessageTone,
  unlockInboxSound,
} from '@/lib/notifications/inbox-sound';

interface UseTotalUnreadOptions {
  /** Play the generated inbox chime for each new inbound customer message. */
  sound?: boolean;
}

/**
 * Count of conversations with at least one unread inbound message for
 * the current user. Used by the sidebar to surface a green dot on the
 * Inbox nav entry when the user is elsewhere in the app.
 *
 * Lives on its own realtime channel (distinct from the inbox page's
 * "inbox-realtime") so both can coexist without sharing state.
 */
export function useTotalUnread({
  sound = false,
}: UseTotalUnreadOptions = {}): number {
  const [total, setTotal] = useState(0);

  // Keep a live local mirror of {id: unread_count} so INSERT/UPDATE/DELETE
  // events can adjust the total in O(1) without refetching.
  const countsRef = useRef<Map<string, number>>(new Map());

  // Autoplay policies require a user gesture before Web Audio may run. Arm
  // the shared context on the first interaction; there is deliberately no
  // prompt and no delayed playback for messages received before that point.
  useEffect(() => {
    if (!sound) return;

    const unlock = () => void unlockInboxSound();
    window.addEventListener('pointerdown', unlock, {
      capture: true,
      once: true,
    });
    window.addEventListener('keydown', unlock, { capture: true, once: true });
    return () => {
      window.removeEventListener('pointerdown', unlock, true);
      window.removeEventListener('keydown', unlock, true);
    };
  }, [sound]);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    // Initial load. RLS scopes this to the signed-in user automatically —
    // no explicit user_id filter needed here.
    (async () => {
      const { data, error } = await supabase
        .from('conversations')
        .select('id, unread_count');
      if (cancelled || error || !data) return;

      const map = new Map<string, number>();
      let sum = 0;
      for (const row of data as { id: string; unread_count: number }[]) {
        const n = row.unread_count ?? 0;
        map.set(row.id, n);
        if (n > 0) sum += 1;
      }
      countsRef.current = map;
      setTotal(sum);
    })();

    const channel = supabase
      .channel('total-unread-realtime')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        (payload) => {
          const message = payload.new as Message;
          if (sound && message.sender_type === 'customer') {
            playInboxMessageTone();
          }
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'conversations' },
        (payload) => {
          const map = countsRef.current;
          if (payload.eventType === 'DELETE') {
            const oldRow = payload.old as Partial<Conversation>;
            if (oldRow.id) map.delete(oldRow.id);
          } else {
            const row = payload.new as Conversation;
            const nextCount = row.unread_count ?? 0;
            map.set(row.id, nextCount);
          }
          // Recompute — cheap, conversations per user stay small.
          let sum = 0;
          for (const n of map.values()) if (n > 0) sum += 1;
          setTotal(sum);
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [sound]);

  return total;
}
