import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { BRANCH_HEADER, browserBranchId } from '@/lib/auth/branch-context';

// Singleton instance — one client shared across the whole browser session.
// Creating multiple clients causes auth-lock contention ("Lock was released
// because another request stole it") and intermittent fetch failures.
let browserClient: SupabaseClient | undefined;

export function createClient() {
  if (browserClient) return browserClient;

  browserClient = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: {
        fetch(input, init = {}) {
          const headers = new Headers(init.headers);
          const accountId = browserBranchId();
          if (accountId) headers.set(BRANCH_HEADER, accountId);
          return fetch(input, { ...init, headers });
        },
      },
    }
  );

  return browserClient;
}
