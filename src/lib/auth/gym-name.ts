export const GYM_NAME_ERROR = 'Gym name must be 1 to 80 letters long.';

export function normalizeGymName(value: unknown): string | null {
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  const length = Array.from(trimmed).length;
  return length >= 1 && length <= 80 ? trimmed : null;
}
