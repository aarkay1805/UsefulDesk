/**
 * Presentation model for the Meta diagnostics retained on a failed send.
 *
 * Meta's `error_data.details` is free prose that frequently embeds a Business
 * Manager URL (`…/billing_hub/accounts/details/?business_id=…&asset_id=…`).
 * Rendered raw that is a single ~200-character unbreakable token: it blows
 * past the bubble's measure and pushes the sentence around it out of reach.
 * Splitting the prose lets the call site keep Meta's wording intact while
 * showing the link as its hostname, with the full URL only in the href.
 */

export type ProviderDetailSegment =
  | { kind: 'text'; value: string }
  | { kind: 'link'; href: string; label: string };

/** An http(s) URL running to the first whitespace character. */
const URL_PATTERN = /https?:\/\/[^\s<>"']+/gi;

/** Meta's prose usually closes the sentence right after the URL. */
const TRAILING_PUNCTUATION = /[.,;:!?]+$/;

/**
 * Hostname of a URL we are willing to link, or null. Anything that is not a
 * parseable http(s) URL stays inert text rather than becoming an anchor.
 */
function linkLabel(href: string): string | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  return url.hostname.replace(/^www\./, '') || null;
}

export function splitProviderDetail(detail: string): ProviderDetailSegment[] {
  const segments: ProviderDetailSegment[] = [];
  let cursor = 0;

  for (const match of detail.matchAll(URL_PATTERN)) {
    const start = match.index;
    if (start === undefined) continue;

    const trailing = match[0].match(TRAILING_PUNCTUATION)?.[0] ?? '';
    const href = trailing ? match[0].slice(0, -trailing.length) : match[0];
    const label = linkLabel(href);
    if (!label) continue;

    if (start > cursor) {
      segments.push({ kind: 'text', value: detail.slice(cursor, start) });
    }
    segments.push({ kind: 'link', href, label });
    cursor = start + href.length;
  }

  if (cursor < detail.length) {
    segments.push({ kind: 'text', value: detail.slice(cursor) });
  }
  return segments;
}
