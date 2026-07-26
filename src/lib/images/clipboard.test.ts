import { describe, expect, it } from 'vitest';

import { getClipboardImageFile } from './clipboard';

function clipboardData({
  items = [],
  files = [],
}: {
  items?: Array<Partial<DataTransferItem>>;
  files?: Array<Partial<File>>;
}) {
  return {
    items,
    files,
  } as unknown as Pick<DataTransfer, 'items' | 'files'>;
}

describe('getClipboardImageFile', () => {
  it('returns the first image exposed as a clipboard item', () => {
    const image = { type: 'image/png', name: 'clipboard.png' } as File;

    const result = getClipboardImageFile(
      clipboardData({
        items: [
          { kind: 'string', type: 'text/plain' },
          { kind: 'file', type: 'application/pdf', getAsFile: () => null },
          { kind: 'file', type: 'image/png', getAsFile: () => image },
        ],
      })
    );

    expect(result).toBe(image);
  });

  it('falls back to the clipboard file list', () => {
    const image = { type: 'image/jpeg', name: 'clipboard.jpg' } as File;

    expect(
      getClipboardImageFile(
        clipboardData({
          files: [{ type: 'text/plain' }, image],
        })
      )
    ).toBe(image);
  });

  it('returns null when the clipboard has no image', () => {
    expect(
      getClipboardImageFile(
        clipboardData({
          items: [{ kind: 'string', type: 'text/plain' }],
          files: [{ type: 'application/pdf' }],
        })
      )
    ).toBeNull();
  });
});
