/** File metadata is available while picking; persisted messages currently lack it. */
export function attachmentSize(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${Math.ceil(bytes / 1024)} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function documentType(uri: string): string {
  try {
    const extension = new URL(uri).pathname.match(/\.([a-z0-9]{1,8})$/i)?.[1];
    return extension ? `${extension.toUpperCase()} document` : 'Document';
  } catch {
    return 'Document';
  }
}
