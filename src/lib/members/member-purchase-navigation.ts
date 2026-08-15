const SAFE_RETURN_ORIGIN = 'https://usefuldesk.local';

function fallbackMemberReturn(membershipId: string): URL {
  const fallback = new URL('/members', SAFE_RETURN_ORIGIN);
  if (membershipId) fallback.searchParams.set('member', membershipId);
  return fallback;
}

function relativeUrl(url: URL): string {
  return `${url.pathname}${url.search}${url.hash}`;
}

export function resolveMemberPurchaseReturn(
  returnTo: string | null | undefined,
  membershipId: string
): string {
  const fallback = fallbackMemberReturn(membershipId);
  if (!returnTo) return relativeUrl(fallback);

  try {
    const candidate = new URL(returnTo, SAFE_RETURN_ORIGIN);
    if (
      candidate.origin !== SAFE_RETURN_ORIGIN ||
      candidate.pathname !== '/members'
    ) {
      return relativeUrl(fallback);
    }
    if (membershipId) candidate.searchParams.set('member', membershipId);
    return relativeUrl(candidate);
  } catch {
    return relativeUrl(fallback);
  }
}

export function buildMemberPurchaseHref(
  currentHref: string,
  membershipId: string
): string {
  const current = new URL(currentHref);
  const branch = current.searchParams.get('branch');
  const returnTarget =
    current.pathname === '/members'
      ? new URL(`${current.pathname}${current.search}${current.hash}`, current)
      : new URL('/members', current);

  if (branch) returnTarget.searchParams.set('branch', branch);
  returnTarget.searchParams.set('member', membershipId);

  const query = new URLSearchParams();
  query.set('membership', membershipId);
  if (branch) query.set('branch', branch);
  query.set('returnTo', relativeUrl(returnTarget));
  return `/members/purchase?${query.toString()}`;
}
