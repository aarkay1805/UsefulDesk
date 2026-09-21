import { uploadResumableMedia } from '@/lib/whatsapp/meta-api';
import type { TemplatePayload } from '@/lib/whatsapp/template-validators';
import { isDeliverableUrl } from '@/lib/webhooks/ssrf';

/**
 * Meta requires an `example.header_handle` (from the Resumable Upload
 * API) to create/edit a template with an IMAGE or DOCUMENT header — a plain
 * public URL is not accepted at creation time. This helper turns the template's
 * `header_media_url` (whether the user uploaded a file or pasted a link)
 * into a handle and writes it onto the payload, so both the upload path
 * and the legacy URL path actually succeed.
 *
 * No-op unless the header is an image/document with a URL but no handle yet.
 * Video samples remain outside the current product contract.
 */

// Meta's image-header sample limits.
const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png'];
const DOCUMENT_MAX_BYTES = 100 * 1024 * 1024;
const ALLOWED_DOCUMENT_TYPES = ['application/pdf'];

export async function ensureTemplateHeaderHandle(
  payload: TemplatePayload,
  accessToken: string
): Promise<void> {
  if (!['image', 'document'].includes(payload.header_type ?? '')) return;
  if (payload.header_handle) return; // already have one
  if (!payload.header_media_url) return; // validator already requires url-or-handle

  const appId = process.env.META_APP_ID;
  if (!appId) {
    throw new Error(
      'Image-header templates need META_APP_ID set (used for Meta’s Resumable Upload). Add it to your environment, or remove the image header.'
    );
  }

  if (!(await isDeliverableUrl(payload.header_media_url))) {
    throw new Error(
      'Could not fetch the header image URL. Make sure it is publicly reachable.'
    );
  }

  // Fetch the sample image bytes (works for our uploaded chat-media URL
  // and for a manually-pasted public link).
  let res: Response;
  try {
    res = await fetch(payload.header_media_url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new Error(
      'Could not fetch the header image URL. Make sure it is publicly reachable.'
    );
  }
  if (!res.ok) {
    throw new Error(
      `Header image URL returned ${res.status}. It must be publicly reachable.`
    );
  }

  const contentType = (res.headers.get('content-type') || '')
    .split(';')[0]
    .trim()
    .toLowerCase();
  const isDocument = payload.header_type === 'document';
  const allowedTypes = isDocument
    ? ALLOWED_DOCUMENT_TYPES
    : ALLOWED_IMAGE_TYPES;
  if (contentType && !allowedTypes.includes(contentType)) {
    throw new Error(
      isDocument
        ? `Header document must be a PDF (got ${contentType}).`
        : `Header image must be JPEG or PNG (got ${contentType}).`
    );
  }

  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength === 0) {
    throw new Error('Header image is empty.');
  }
  const maxBytes = isDocument ? DOCUMENT_MAX_BYTES : IMAGE_MAX_BYTES;
  const maxMegabytes = maxBytes / 1024 / 1024;
  if (bytes.byteLength > maxBytes) {
    throw new Error(
      `Header ${isDocument ? 'document' : 'image'} is ${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB — Meta's limit is ${maxMegabytes} MB.`
    );
  }

  const mimeType = allowedTypes.includes(contentType)
    ? contentType
    : isDocument
      ? 'application/pdf'
      : 'image/jpeg';
  const fileName = isDocument
    ? 'header.pdf'
    : mimeType === 'image/png'
      ? 'header.png'
      : 'header.jpg';

  const { handle } = await uploadResumableMedia({
    appId,
    accessToken,
    fileName,
    mimeType,
    bytes,
  });
  payload.header_handle = handle;
}
