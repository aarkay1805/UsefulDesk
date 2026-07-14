/**
 * Best-effort client IP, for rate-limiting public endpoints.
 *
 * `x-forwarded-for` is what every reverse proxy (Vercel, Hostinger,
 * Cloudflare) sets when forwarding; the leftmost entry is the original
 * client. Falls back to a constant when nothing is in front (e.g.
 * localhost in dev) so a rate-limit key still exists — the limit then
 * applies "globally," which is fine for dev.
 *
 * Spoofable in principle, which is exactly why it only ever guards a
 * rate limit and never an authorization decision.
 */
export function getClientIp(request: Request): string {
  const xff = request.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  const xri = request.headers.get('x-real-ip');
  if (xri) return xri.trim();
  return 'unknown';
}
