/**
 * Plain-language replacements for technical failures. Gym staff read these
 * in toasts, so a Postgres or browser message must never reach them as-is.
 * Order matters: the first match wins. See docs/ux-copy.md.
 */
const TECHNICAL_ERRORS: ReadonlyArray<{
  test: (message: string, code: string) => boolean;
  text: string | null;
}> = [
  {
    test: (m) =>
      /^(?:(?:typeerror|fetcherror):\s*)?(?:failed to fetch|networkerror(?: when attempting to fetch resource\.?)?|network request failed|load failed|fetch failed|(?:net::)?err_internet_disconnected)$/i.test(
        m.trim()
      ),
    text: 'No internet connection. Check your internet and try again.',
  },
  {
    test: (m) => /jwt expired|invalid jwt|refresh token not found/i.test(m),
    text: 'Your login has expired. Log in again.',
  },
  {
    test: (m, c) =>
      c === '42501' ||
      /row-level security|permission denied for|insufficient_privilege/i.test(
        m
      ),
    text: 'You do not have permission to do this. Ask the owner or an admin.',
  },
  {
    test: (m, c) => c === '23505' || /duplicate key value/i.test(m),
    text: 'This already exists.',
  },
  {
    test: (m, c) => c === '57014' || /statement timeout|timed out/i.test(m),
    text: 'This took too long. Try again.',
  },
  {
    test: (m, c) => c === '23503' || /violates foreign key/i.test(m),
    text: 'This is linked to other details, so it cannot be changed.',
  },
  {
    // Messages that only make sense to a developer: fall back to the
    // caller's own plain sentence.
    test: (m, c) =>
      /^(PGRST|22|23|42)/.test(c) ||
      /violates (check|not-null) constraint|relation ".*" does not exist|column ".*" does not exist|function .* does not exist|syntax error|unexpected token|internal server error|^\s*\d{3}\s*$/i.test(
        m
      ),
    text: null,
  },
];

function translate(message: string, code: string, fallback: string): string {
  for (const rule of TECHNICAL_ERRORS) {
    if (rule.test(message, code)) return rule.text ?? fallback;
  }
  return message;
}

export function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return translate(error.message, '', fallback);
  }

  if (
    error !== null &&
    typeof error === 'object' &&
    'message' in error &&
    typeof error.message === 'string' &&
    error.message.trim()
  ) {
    const code =
      'code' in error && typeof error.code === 'string' ? error.code : '';
    return translate(error.message, code, fallback);
  }

  return fallback;
}
