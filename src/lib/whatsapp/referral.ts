/**
 * Meta Click-to-WhatsApp referral parsing.
 *
 * The webhook payload is external input, so callers must not persist or
 * render it directly. This module keeps only Meta's documented scalar
 * fields, bounds their size, accepts only HTTPS URLs, and derives a
 * platform only from a trusted Meta-owned hostname. `source_type` says
 * ad/post; it does not identify Instagram vs Facebook on its own.
 */

import type { MessageReferral } from '@/types';

export type WhatsAppReferralPlatform = NonNullable<
  MessageReferral['source_platform']
>;
export type WhatsAppReferral = MessageReferral;

const TEXT_LIMITS = {
  source_id: 512,
  headline: 2_000,
  body: 8_000,
  ctwa_clid: 2_000,
} as const;

function boundedString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

function httpsUrl(value: unknown): string | null {
  const raw = boundedString(value, 2_048);
  if (!raw) return null;

  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:') return null;
    return url.toString();
  } catch {
    return null;
  }
}

function isHost(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

/**
 * Classify only from an HTTPS source URL on a known platform hostname.
 * A payload that merely says `source_type: "ad"` remains platform-neutral.
 */
export function classifyReferralPlatform(
  sourceUrl: string | null
): WhatsAppReferralPlatform | null {
  if (!sourceUrl) return null;

  try {
    const url = new URL(sourceUrl);
    if (url.protocol !== 'https:') return null;
    const hostname = url.hostname.toLowerCase().replace(/\.$/, '');

    if (isHost(hostname, 'instagram.com')) return 'instagram';
    if (isHost(hostname, 'facebook.com') || isHost(hostname, 'fb.com')) {
      return 'facebook';
    }
  } catch {
    return null;
  }

  return null;
}

/**
 * Normalize Meta's inbound `message.referral` object. Returns null when
 * the value is absent or contains none of the documented usable fields.
 */
export function parseWhatsAppReferral(input: unknown): WhatsAppReferral | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const row = input as Record<string, unknown>;

  const sourceUrl = httpsUrl(row.source_url);
  const sourceType =
    row.source_type === 'ad' || row.source_type === 'post'
      ? row.source_type
      : null;
  const mediaType =
    row.media_type === 'image' || row.media_type === 'video'
      ? row.media_type
      : null;

  const referral: WhatsAppReferral = {
    source_url: sourceUrl,
    source_id: boundedString(row.source_id, TEXT_LIMITS.source_id),
    source_type: sourceType,
    headline: boundedString(row.headline, TEXT_LIMITS.headline),
    body: boundedString(row.body, TEXT_LIMITS.body),
    media_type: mediaType,
    image_url: httpsUrl(row.image_url),
    video_url: httpsUrl(row.video_url),
    thumbnail_url: httpsUrl(row.thumbnail_url),
    ctwa_clid: boundedString(row.ctwa_clid, TEXT_LIMITS.ctwa_clid),
    source_platform: classifyReferralPlatform(sourceUrl),
  };

  const hasPayload = Object.entries(referral).some(
    ([key, value]) => key !== 'source_platform' && value !== null
  );
  return hasPayload ? referral : null;
}

/** Contact-level acquisition source for a trusted first-touch platform. */
export function contactSourceFromReferral(
  referral: WhatsAppReferral | null
): WhatsAppReferralPlatform | null {
  return referral?.source_platform ?? null;
}

/** Human-readable label for the Inbox referral context. */
export function referralDisplayLabel(referral: WhatsAppReferral): string {
  const platform =
    referral.source_platform === 'instagram'
      ? 'Instagram'
      : referral.source_platform === 'facebook'
        ? 'Facebook'
        : 'Meta';
  const kind =
    referral.source_type === 'ad'
      ? 'ad'
      : referral.source_type === 'post'
        ? 'post'
        : 'referral';
  return `${platform} ${kind}`;
}

/** Defense-in-depth for rendering a stored source link in the Inbox. */
export function referralSourceHref(referral: WhatsAppReferral): string | null {
  return httpsUrl(referral.source_url);
}
