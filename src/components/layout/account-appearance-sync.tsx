'use client';

import { useEffect, useRef } from 'react';

import { useAuth } from '@/hooks/use-auth';
import { useTheme } from '@/hooks/use-theme';

/**
 * Reconciles the fast browser paint cache with the authenticated user's
 * profile. A saved profile value is authoritative; a NULL value leaves
 * the pre-existing local choice alone so upgrading does not reset users.
 */
export function AccountAppearanceSync() {
  const { user, profile, profileLoading } = useAuth();
  const { applyAccountAppearance } = useTheme();
  const appliedProfileRef = useRef<string | null>(null);

  useEffect(() => {
    if (profileLoading || !user || !profile) return;

    const signature = [
      user.id,
      profile.appearance_theme ?? 'unset',
      profile.appearance_mode ?? 'unset',
    ].join(':');
    if (appliedProfileRef.current === signature) return;

    appliedProfileRef.current = signature;
    applyAccountAppearance({
      theme: profile.appearance_theme,
      mode: profile.appearance_mode,
    });
  }, [applyAccountAppearance, profile, profileLoading, user]);

  return null;
}
