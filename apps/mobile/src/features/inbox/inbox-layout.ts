export const ACCESSIBILITY_TEXT_SCALE = 1.3;

export function isAccessibilityTextScale(fontScale: number): boolean {
  return fontScale >= ACCESSIBILITY_TEXT_SCALE;
}

export function shouldInlineBubbleMetadata(
  hasTrailingText: boolean,
  fontScale: number
): boolean {
  return hasTrailingText && !isAccessibilityTextScale(fontScale);
}
