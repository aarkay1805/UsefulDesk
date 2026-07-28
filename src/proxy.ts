import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { isDashboardPath } from '@/lib/auth/dashboard-routes';
import {
  BRANCH_QUERY_PARAM,
  isBranchAccountId,
} from '@/lib/auth/branch-context';

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // getUser() transparently refreshes an expired access token, which
  // ROTATES the refresh token and writes the new cookies onto
  // `supabaseResponse` via setAll() above. Any response we return in
  // place of `supabaseResponse` (every redirect / JSON branch below)
  // is a fresh object that does NOT carry those Set-Cookie headers, so
  // the rotated token never reaches the browser. The next request then
  // replays the old, now-consumed refresh token, the refresh fails, and
  // the session wedges — the user gets a broken reload after idling and
  // can only recover by manually clearing cookies (issue #288). Copy the
  // refreshed cookies onto whatever response we hand back to fix that.
  const withRefreshedCookies = <T extends NextResponse>(response: T): T => {
    supabaseResponse.cookies.getAll().forEach((cookie) => {
      response.cookies.set(cookie);
    });
    return response;
  };

  // Auth pages - redirect to dashboard if already logged in.
  // Exception: when an invite token is in the query string we
  // send the already-signed-in user to /join/<token> instead so
  // they can accept the invitation in one click. Without this,
  // a forwarded invite link to someone who's already signed in
  // would silently drop them on /dashboard.
  if (
    user &&
    (request.nextUrl.pathname === '/login' ||
      request.nextUrl.pathname === '/signup' ||
      request.nextUrl.pathname === '/forgot-password')
  ) {
    const url = request.nextUrl.clone();
    const inviteToken = request.nextUrl.searchParams.get('invite');
    if (
      inviteToken &&
      (request.nextUrl.pathname === '/login' ||
        request.nextUrl.pathname === '/signup')
    ) {
      url.pathname = `/join/${encodeURIComponent(inviteToken)}`;
      url.search = '';
    } else {
      url.pathname = '/dashboard';
      url.search = '';
    }
    return withRefreshedCookies(NextResponse.redirect(url));
  }

  // Authenticated dashboard pages get an early redirect here. The dashboard
  // server layout independently verifies the user before rendering so this
  // proxy check is not the sole authentication boundary.
  if (!user && isDashboardPath(request.nextUrl.pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return withRefreshedCookies(NextResponse.redirect(url));
  }

  // Preserve the durable branch query across legacy dashboard links that
  // navigate by pathname only. The same-origin Referer is tab-local, so this
  // does not create a globally mutable branch that can invalidate another tab
  // or device. The redirect also forces a clean route render before any
  // branch-scoped request can start.
  if (
    user &&
    isDashboardPath(request.nextUrl.pathname) &&
    !request.nextUrl.searchParams.has(BRANCH_QUERY_PARAM)
  ) {
    const referer = request.headers.get('referer');
    if (referer) {
      try {
        const from = new URL(referer);
        const branch = from.searchParams.get(BRANCH_QUERY_PARAM);
        if (
          from.origin === request.nextUrl.origin &&
          isBranchAccountId(branch)
        ) {
          const url = request.nextUrl.clone();
          url.searchParams.set(BRANCH_QUERY_PARAM, branch);
          return withRefreshedCookies(NextResponse.redirect(url));
        }
      } catch {
        // A malformed Referer is untrusted input; fall through to the legacy
        // branch default rather than guessing.
      }
    }
  }

  // API routes that need auth (not webhooks)
  if (
    !user &&
    request.nextUrl.pathname.startsWith('/api/whatsapp/') &&
    !request.nextUrl.pathname.includes('/webhook')
  ) {
    return withRefreshedCookies(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    );
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
