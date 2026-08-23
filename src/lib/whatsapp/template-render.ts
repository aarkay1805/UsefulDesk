/**
 * Render what a template send actually delivered.
 *
 * A template message is stored as an approved header + body with
 * `{{n}}` placeholders plus the per-send values; nothing in the row
 * says what the customer read. Until this module existed, only the
 * inbox composer bothered to substitute the two together, so every
 * other send path (member detail, reminders, service renewals,
 * payment links, the public API, automations) persisted
 * `content_text = null` and the inbox rendered a bare "Template" tag
 * with no message under it.
 *
 * Scope is the HEADER and the BODY — the parts of a template that
 * carry the message. A TEXT header is folded onto the front of the
 * text (blank-line separated, the way WhatsApp stacks it above the
 * body); a media header resolves to the URL the send delivered, which
 * the message row keeps in `media_url`. Footer and buttons stay out:
 * they are chrome Meta appends, and folding them in would turn a
 * bubble into a reconstructed transcript of every component.
 */

/** Send-time values may arrive positionally or as structured params. */
export interface TemplateSendParamSource {
  /** Structured `template_message_params` — untrusted at API boundaries. */
  messageParams?: unknown;
  /** Legacy positional body params. */
  params?: readonly string[] | null;
}

/**
 * The parts of a `message_templates` row this module reads. Structural
 * so a caller can pass a full `MessageTemplate` or a fixture.
 */
export interface TemplateRenderRow {
  header_type?: string | null;
  header_content?: string | null;
  header_media_url?: string | null;
  body_text?: string | null;
}

/** The header media a send delivered, resolved to a storable URL. */
export interface TemplateHeaderMedia {
  url: string;
  kind: 'image' | 'video' | 'document';
}

/** Narrow the untrusted structured params to the fields we read. */
function structuredParams(messageParams: unknown): {
  body?: unknown;
  headerText?: unknown;
  headerMediaUrl?: unknown;
} {
  return messageParams && typeof messageParams === 'object'
    ? (messageParams as {
        body?: unknown;
        headerText?: unknown;
        headerMediaUrl?: unknown;
      })
    : {};
}

function trimmedString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

/**
 * Substitute `{{n}}` with the value sent for this delivery. An
 * unfilled placeholder is left verbatim rather than blanked, so a
 * short param list reads as an obvious gap instead of a broken
 * sentence.
 */
export function renderTemplateBody(
  bodyText: string,
  params: readonly string[] = []
): string {
  return bodyText.replace(/\{\{(\d+)\}\}/g, (_, raw: string) => {
    const value = params[Number(raw) - 1];
    return value ?? `{{${raw}}}`;
  });
}

/**
 * Pull the body values out of whichever param shape the caller used.
 * `messageParams.body` wins because that is the shape the send
 * builder feeds Meta; the positional array is the legacy fallback.
 */
export function resolveTemplateBodyParams({
  messageParams,
  params,
}: TemplateSendParamSource): string[] {
  const structured = structuredParams(messageParams).body;
  const source = Array.isArray(structured) ? structured : (params ?? []);
  return source.map((value) => (value == null ? '' : String(value)));
}

/**
 * The delivered TEXT header, with its `{{1}}` filled from `headerText`.
 * Null for a media header or a template with no header at all — those
 * carry no text to fold in.
 */
export function renderTemplateHeaderText(
  template: TemplateRenderRow | null | undefined,
  source: TemplateSendParamSource
): string | null {
  if (template?.header_type !== 'text') return null;
  const content = template.header_content;
  if (!content) return null;
  const value = trimmedString(
    structuredParams(source.messageParams).headerText
  );
  return renderTemplateBody(content, value ? [value] : []);
}

/**
 * The media a header delivered. Prefers the caller's per-send override
 * (the same precedence `buildSendComponents` uses), then the
 * template's stored URL. A send that supplied only a Meta media id
 * resolves to null — there is no URL worth keeping on the row.
 */
export function resolveTemplateHeaderMedia(
  template: TemplateRenderRow | null | undefined,
  source: TemplateSendParamSource
): TemplateHeaderMedia | null {
  const kind = template?.header_type;
  if (kind !== 'image' && kind !== 'video' && kind !== 'document') return null;
  const url =
    trimmedString(structuredParams(source.messageParams).headerMediaUrl) ??
    trimmedString(template?.header_media_url);
  return url ? { url: url.trim(), kind } : null;
}

/**
 * The text to persist on a template message row: the header line, a
 * blank line, then the body. Returns `null` when the template row is
 * missing locally (an un-synced template), which keeps the caller's
 * existing "no text" behaviour rather than inventing a message.
 */
export function renderTemplateMessageText(
  template: TemplateRenderRow | null | undefined,
  source: TemplateSendParamSource
): string | null {
  if (!template) return null;
  const header = renderTemplateHeaderText(template, source);
  const body = template.body_text
    ? renderTemplateBody(template.body_text, resolveTemplateBodyParams(source))
    : null;
  const parts = [header, body].filter((part): part is string => Boolean(part));
  return parts.length ? parts.join('\n\n') : null;
}

const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'gif'];
const VIDEO_EXTENSIONS = ['mp4', '3gp', '3gpp', 'mov', 'webm'];

function urlPath(url: string): string {
  // Header media is a plain public URL (never a signed one — those are
  // not persisted), but strip any query/hash before reading the name.
  return url.split(/[?#]/)[0];
}

/**
 * Which of Meta's three media-header kinds a stored header URL is.
 *
 * The message row keeps only the URL — `content_type` stays
 * `template` — so the bubble re-derives the kind from the extension.
 * Meta accepts a narrow set per kind (JPEG/PNG, MP4/3GPP, PDF), and
 * anything unrecognised falls back to `document`, which renders as a
 * link and therefore works for any URL.
 */
export function templateHeaderMediaKind(
  url: string
): TemplateHeaderMedia['kind'] {
  const extension = urlPath(url).split('.').pop()?.toLowerCase() ?? '';
  if (IMAGE_EXTENSIONS.includes(extension)) return 'image';
  if (VIDEO_EXTENSIONS.includes(extension)) return 'video';
  return 'document';
}

/** Readable file name for a document header, for use as a link label. */
export function templateHeaderMediaLabel(url: string): string {
  // Read the name off the path only — a bare origin has no file to name,
  // and splitting the whole URL would label the link with the hostname.
  let path = urlPath(url);
  try {
    path = new URL(url).pathname;
  } catch {
    // Not an absolute URL; the stripped string is the best we have.
  }
  const name = path.split('/').filter(Boolean).pop() ?? '';
  if (!name) return 'Attachment';
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}
