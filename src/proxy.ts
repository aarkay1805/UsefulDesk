import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { isDashboardPath } from '@/lib/auth/dashboard-routes';
import {
  BRANCH_HEADER,
  BRANCH_QUERY_PARAM,
  isBranchAccountId,
} from '@/lib/auth/branch-context';
import {
  invitationJoinPath,
  normalizeInvitationToken,
} from '@/lib/auth/invitation-continuation';

export async function proxy(request: NextRequest) {
  const isNativeWhatsAppRequest =
    (request.nextUrl.pathname === '/api/whatsapp/send' ||
      request.nextUrl.pathname === '/api/whatsapp/react') &&
    request.headers.get('authorization') !== null;
  const requestHeaders = new Headers(request.headers);
  // Never trust a caller-authored tenant header on cookie-authenticated paths.
  // Native sends and reactions are exceptions: each route validates the bearer
  // and independently verifies membership in this explicit branch via RLS.
  if (!isNativeWhatsAppRequest) requestHeaders.delete(BRANCH_HEADER);
  if (
    isDashboardPath(request.nextUrl.pathname) &&
    request.nextUrl.searchParams.has(BRANCH_QUERY_PARAM)
  ) {
    const branch = request.nextUrl.searchParams.get(BRANCH_QUERY_PARAM);
    requestHeaders.set(
      BRANCH_HEADER,
      isBranchAccountId(branch) ? branch : 'invalid'
    );
  }
  const nextResponse = () =>
    NextResponse.next({ request: { headers: requestHeaders } });
  let supabaseResponse = nextResponse();

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
          supabaseResponse = nextResponse();
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const { data: claimsData } = await supabase.auth.getClaims();
  const authenticated = Boolean(claimsData?.claims?.sub);

  // getClaims() securely verifies the signed access token locally when the
  // project uses asymmetric keys. It still loads/refreshes an expired session,
  // which can rotate the refresh token and write new cookies onto
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
    authenticated &&
    (request.nextUrl.pathname === '/login' ||
      request.nextUrl.pathname === '/signup' ||
      request.nextUrl.pathname === '/forgot-password')
  ) {
    const url = request.nextUrl.clone();
    const inviteToken = normalizeInvitationToken(
      request.nextUrl.searchParams.get('invite')
    );
    const joinPath = invitationJoinPath(inviteToken);
    if (joinPath) {
      url.pathname = joinPath;
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
  if (!authenticated && isDashboardPath(request.nextUrl.pathname)) {
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
    authenticated &&
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
    !authenticated &&
    request.nextUrl.pathname.startsWith('/api/whatsapp/') &&
    !request.nextUrl.pathname.includes('/webhook') &&
    !isNativeWhatsAppRequest
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
