type ClipboardImageData = Pick<DataTransfer, 'items' | 'files'>;

/**
 * Returns the first image file pasted from the clipboard.
 *
 * Clipboard implementations normally expose pasted images through `items`,
 * but the `files` fallback keeps this working in browsers that only populate
 * the file list.
 */
export function getClipboardImageFile(
  clipboardData: ClipboardImageData
): File | null {
  for (const item of Array.from(clipboardData.items)) {
    if (item.kind !== 'file' || !item.type.startsWith('image/')) continue;
    const file = item.getAsFile();
    if (file) return file;
  }

  return (
    Array.from(clipboardData.files).find((file) =>
      file.type.startsWith('image/')
    ) ?? null
  );
}
