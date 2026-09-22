export const GYM_NAME_ERROR = 'Gym name must be between 1 and 80 characters.';

export function normalizeGymName(value: unknown): string | null {
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  const length = Array.from(trimmed).length;
  return length >= 1 && length <= 80 ? trimmed : null;
}
