export function normalizeSignupFullName(value: string): string | null {
  const trimmed = value.trim();
  return trimmed || null;
}
