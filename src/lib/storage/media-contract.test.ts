import { describe, expect, it } from 'vitest';

import {
  MEDIA_MIME_TYPES_BY_KIND,
  MEDIA_MAX_BYTES_BY_KIND,
  MediaValidationError,
  buildMediaPath,
  validateMediaAsset,
  type MediaKind,
} from './media-contract';

const ACCOUNT = '11111111-2222-3333-4444-555555555555';

const ACCEPTED: Record<MediaKind, readonly string[]> = {
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
};

describe('media contract', () => {
  it('accepts every literal chat-media MIME type only for its declared kind', () => {
    expect(MEDIA_MIME_TYPES_BY_KIND).toEqual(ACCEPTED);

    for (const [kind, mimeTypes] of Object.entries(ACCEPTED) as [
      MediaKind,
      readonly string[],
    ][]) {
      for (const mimeType of mimeTypes) {
        expect(
          validateMediaAsset({
            kind,
            mimeType,
            size: 1,
          })
        ).toEqual({ kind, mimeType, size: 1 });
      }
    }
  });

  it.each([
    ['missing MIME', 'image', null],
    ['unsupported MIME', 'document', 'application/zip'],
    ['MIME from another kind', 'image', 'video/mp4'],
  ] as const)('rejects %s before upload', (_label, kind, mimeType) => {
    expect(() => validateMediaAsset({ kind, mimeType, size: 1 })).toThrow(
      MediaValidationError
    );
    expect(() => validateMediaAsset({ kind, mimeType, size: 1 })).toThrow(
      'Choose a supported file for this attachment type.'
    );
  });

  it.each([
    ['image', 5 * 1024 * 1024],
    ['video', 16 * 1024 * 1024],
    ['document', 16 * 1024 * 1024],
    ['audio', 16 * 1024 * 1024],
  ] as const)('accepts %s at its exact byte ceiling', (kind, size) => {
    const mimeType = ACCEPTED[kind][0];
    expect(validateMediaAsset({ kind, mimeType, size })).toEqual({
      kind,
      mimeType,
      size,
    });
    expect(MEDIA_MAX_BYTES_BY_KIND[kind]).toBe(size);
  });

  it.each(['image', 'video', 'document', 'audio'] as const)(
    'rejects empty and over-limit %s files',
    (kind) => {
      const mimeType = ACCEPTED[kind][0];
      expect(() => validateMediaAsset({ kind, mimeType, size: 0 })).toThrow(
        'Choose a non-empty file.'
      );
      expect(() =>
        validateMediaAsset({
          kind,
          mimeType,
          size: MEDIA_MAX_BYTES_BY_KIND[kind] + 1,
        })
      ).toThrow(
        `This ${kind} is too large. Choose one up to ${
          kind === 'image' ? 5 : 16
        } MB.`
      );
    }
  );

  it('builds a canonical account path with a safe basename and extension', () => {
    expect(
      buildMediaPath(ACCOUNT, '../Member / invoice FINAL.PDF', 1700000000000)
    ).toBe(
      `account-${ACCOUNT}/1700000000000-_Member_invoice_FINAL.pdf`
    );
    expect(buildMediaPath(ACCOUNT, 'README', 1700000000000)).toBe(
      `account-${ACCOUNT}/1700000000000-README.bin`
    );
    expect(buildMediaPath(ACCOUNT, '.hidden', 1700000000000)).toBe(
      `account-${ACCOUNT}/1700000000000-file.hidden`
    );
  });
});
