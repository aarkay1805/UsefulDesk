export const BRANCH_QUERY_PARAM = 'branch';
export const BRANCH_HEADER = 'x-usefuldesk-account-id';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isBranchAccountId(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

export function branchIdFromUrl(value: string | URL): string | null {
  const url =
    value instanceof URL ? value : new URL(value, 'https://usefuldesk.local');
  const branchId = url.searchParams.get(BRANCH_QUERY_PARAM);
  return isBranchAccountId(branchId) ? branchId : null;
}

export function branchHref(href: string, accountId: string | null): string {
  if (!accountId || !isBranchAccountId(accountId)) return href;
  if (
    href.startsWith('http://') ||
    href.startsWith('https://') ||
    href.startsWith('mailto:') ||
    href.startsWith('tel:')
  ) {
    return href;
  }

  const url = new URL(href, 'https://usefuldesk.local');
  url.searchParams.set(BRANCH_QUERY_PARAM, accountId);
  return `${url.pathname}${url.search}${url.hash}`;
}

export function browserBranchId(): string | null {
  if (typeof window === 'undefined') return null;
  return branchIdFromUrl(window.location.href);
}
