'use client';

import { useEffect } from 'react';

import { createClient } from '@/lib/supabase/client';

/** Keep profiles.email aligned only after Supabase Auth confirms the change. */
export function useConfirmedProfileEmail({
  userId,
  authEmail,
  profileEmail,
  onSynced,
}: {
  userId: string | null;
  authEmail: string | null;
  profileEmail: string | null;
  onSynced: () => Promise<void>;
}) {
  useEffect(() => {
    if (
      !userId ||
      !authEmail ||
      !profileEmail ||
      authEmail.toLowerCase() === profileEmail.toLowerCase()
    ) {
      return;
    }

    let cancelled = false;
    void (async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('profiles')
        .update({ email: authEmail })
        .eq('user_id', userId)
        .select('id');
      if (error || !data?.length) {
        console.warn('[LoginSecurity] confirmed email sync failed:', {
          message: error?.message ?? 'profile row was not updated',
        });
        return;
      }
      if (!cancelled) await onSynced();
    })();

    return () => {
      cancelled = true;
    };
  }, [authEmail, onSynced, profileEmail, userId]);
}
