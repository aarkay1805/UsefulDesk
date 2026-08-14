'use client';

import { useCallback, useEffect, useState } from 'react';
import type { UserIdentity } from '@supabase/supabase-js';

import { createClient } from '@/lib/supabase/client';
import { getErrorMessage } from '@/lib/errors';

interface AuthIdentitiesState {
  identities: UserIdentity[];
  loading: boolean;
  error: string | null;
}

const INITIAL_STATE: AuthIdentitiesState = {
  identities: [],
  loading: true,
  error: null,
};

/** Load the authoritative linked identities with an explicit retry boundary. */
export function useAuthIdentities() {
  const [state, setState] = useState<AuthIdentitiesState>(INITIAL_STATE);
  const [refreshNonce, setRefreshNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setState((current) => ({ ...current, loading: true, error: null }));
      try {
        const supabase = createClient();
        const { data, error } = await supabase.auth.getUserIdentities();
        if (error) throw error;
        if (cancelled) return;
        setState({ identities: data.identities, loading: false, error: null });
      } catch (error) {
        if (cancelled) return;
        setState({
          identities: [],
          loading: false,
          error: getErrorMessage(
            error,
            'Your sign-in methods could not be loaded.'
          ),
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshNonce]);

  const refresh = useCallback(() => {
    setRefreshNonce((nonce) => nonce + 1);
  }, []);

  return { ...state, refresh };
}
