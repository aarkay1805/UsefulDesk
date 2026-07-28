import { createServerClient } from '@supabase/ssr';
import { cookies, headers } from 'next/headers';
import {
  BRANCH_HEADER,
  BRANCH_QUERY_PARAM,
  isBranchAccountId,
} from '@/lib/auth/branch-context';

export async function createClient(accountId?: string | null) {
  const [cookieStore, requestHeaders] = await Promise.all([
    cookies(),
    headers().catch(() => null),
  ]);
  let requestedBranch: string | null | undefined = accountId;
  if (requestedBranch === undefined && requestHeaders) {
    const direct = requestHeaders.get(BRANCH_HEADER);
    if (direct !== null) {
      requestedBranch = direct;
    } else {
      const referer = requestHeaders.get('referer');
      if (referer) {
        try {
          const url = new URL(referer);
          if (url.searchParams.has(BRANCH_QUERY_PARAM)) {
            requestedBranch =
              url.searchParams.get(BRANCH_QUERY_PARAM) ?? 'invalid';
          }
        } catch {
          requestedBranch = null;
        }
      }
    }
  }
  const branchHeaders =
    requestedBranch !== null && requestedBranch !== undefined
      ? {
          [BRANCH_HEADER]: isBranchAccountId(requestedBranch)
            ? requestedBranch
            : 'invalid',
        }
      : undefined;

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: {
        headers: branchHeaders,
      },
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // The `setAll` method was called from a Server Component.
            // This can be ignored if you have middleware refreshing sessions.
          }
        },
      },
    }
  );
}
