import 'server-only';

import { ForbiddenError } from './account';

function isConfiguredDevelopmentTunnel(
  request: Request,
  origin: string
): boolean {
  const configuredHost =
    process.env.META_REVIEW_TUNNEL_HOST?.trim().toLowerCase();
  if (process.env.NODE_ENV === 'production' || !configuredHost) return false;

  let originUrl: URL;
  try {
    originUrl = new URL(origin);
  } catch {
    return false;
  }
  if (
    originUrl.protocol !== 'https:' ||
    originUrl.host.toLowerCase() !== configuredHost
  ) {
    return false;
  }

  // A local HTTPS tunnel terminates TLS at its edge and forwards the request
  // to the development server on localhost. Accept that proxy boundary only
  // when both forwarded values exactly match the opt-in environment variable.
  const forwardedHost = request.headers
    .get('x-forwarded-host')
    ?.split(',')[0]
    ?.trim()
    .toLowerCase();
  const forwardedProto = request.headers
    .get('x-forwarded-proto')
    ?.split(',')[0]
    ?.trim()
    .toLowerCase();
  return forwardedHost === configuredHost && forwardedProto === 'https';
}

/** Mutating browser routes accept only same-origin fetches. */
export function requireSameOriginRequest(request: Request): void {
  const origin = request.headers.get('origin');
  const fetchSite = request.headers.get('sec-fetch-site');
  if (
    !origin ||
    (new URL(request.url).origin !== origin &&
      !isConfiguredDevelopmentTunnel(request, origin))
  ) {
    throw new ForbiddenError('Invalid request origin');
  }
  if (fetchSite && fetchSite !== 'same-origin') {
    throw new ForbiddenError('Cross-site request rejected');
  }
}
