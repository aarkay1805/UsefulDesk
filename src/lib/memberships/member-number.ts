/**
 * Parse the front-desk Member ID field. IDs are positive database integers;
 * reject decimals, signs, whitespace-only values, and unsafe JS integers.
 */
export function parseMemberNumber(value: string): number | null {
  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) return null;

  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}
