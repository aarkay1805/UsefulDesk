export type MediaKind = 'image' | 'video' | 'document' | 'audio';

/** Mirrors the public chat-media bucket allow-list in migration 023. */
export const MEDIA_MIME_TYPES_BY_KIND = {
  image: ['image/png', 'image/jpeg', 'image/webp'],
  video: ['video/mp4', 'video/3gpp'],
  document: [
    'application/pdf',
    'application/vnd.ms-powerpoint',
    'application/msword',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain',
  ],
  audio: [
    'audio/ogg',
    'audio/mpeg',
    'audio/aac',
    'audio/mp4',
    'audio/amr',
  ],
} as const satisfies Record<MediaKind, readonly string[]>;

/** Per-kind ceilings shared by browser and native Inbox uploads. */
export const MEDIA_MAX_BYTES_BY_KIND = {
  image: 5 * 1024 * 1024,
  video: 16 * 1024 * 1024,
  audio: 16 * 1024 * 1024,
  document: 16 * 1024 * 1024,
} as const satisfies Record<MediaKind, number>;

export interface MediaAssetValidationInput {
  kind: MediaKind;
  mimeType: string | null | undefined;
  size: number | null | undefined;
}

export interface ValidatedMediaAsset {
  kind: MediaKind;
  mimeType: string;
  size: number;
}

export class MediaValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MediaValidationError';
  }
}

export function validateMediaAsset(
  input: MediaAssetValidationInput
): ValidatedMediaAsset {
  if (
    !input.mimeType ||
    !(MEDIA_MIME_TYPES_BY_KIND[input.kind] as readonly string[]).includes(
      input.mimeType
    )
  ) {
    throw new MediaValidationError(
      'Choose a supported file for this attachment type.'
    );
  }
  if (
    typeof input.size !== 'number' ||
    !Number.isFinite(input.size) ||
    input.size <= 0
  ) {
    throw new MediaValidationError('Choose a non-empty file.');
  }
  if (input.size > MEDIA_MAX_BYTES_BY_KIND[input.kind]) {
    throw new MediaValidationError(
      `This ${input.kind} is too large. Choose one up to ${
        MEDIA_MAX_BYTES_BY_KIND[input.kind] / 1024 / 1024
      } MB.`
    );
  }
  return { kind: input.kind, mimeType: input.mimeType, size: input.size };
}

/** Build the account-scoped object path consumed by chat/flow Storage RLS. */
export function buildMediaPath(
  accountId: string,
  fileName: string,
  now: number = Date.now()
): string {
  const extensionMatch = /\.([a-zA-Z0-9]+)$/.exec(fileName);
  const ext = extensionMatch?.[1].toLowerCase() ?? 'bin';
  const baseSource = extensionMatch
    ? fileName.slice(0, extensionMatch.index)
    : fileName;
  const safeBase =
    baseSource.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 40) || 'file';
  return `account-${accountId}/${now}-${safeBase}.${ext}`;
}
