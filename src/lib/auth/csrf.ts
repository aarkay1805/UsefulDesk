import 'server-only';

import { ForbiddenError } from './account';

/** Mutating browser routes accept only same-origin fetches. */
export function requireSameOriginRequest(request: Request): void {
  const origin = request.headers.get('origin');
  const fetchSite = request.headers.get('sec-fetch-site');
  if (!origin || new URL(request.url).origin !== origin) {
    throw new ForbiddenError('Invalid request origin');
  }
  if (fetchSite && fetchSite !== 'same-origin') {
    throw new ForbiddenError('Cross-site request rejected');
  }
}
