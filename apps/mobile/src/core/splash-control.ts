export interface SplashControlAdapter {
  preventAutoHideAsync(): Promise<boolean | undefined>;
  hideAsync(): Promise<void>;
}

export type SplashErrorReporter = (message: string, error: unknown) => void;

export type SplashHideResult =
  | { status: 'hidden'; attempts: number }
  | { status: 'failed'; attempts: number; error: unknown };

interface SplashHideOptions {
  report?: SplashErrorReporter;
  retryDelayMs?: number;
}

const HIDE_ATTEMPTS = 3;
const HIDE_RETRY_DELAY_MS = 150;

const reportSplashError: SplashErrorReporter = (message, error) => {
  console.error(`[UsefulDesk splash] ${message}`, error);
};

export async function preventSplashAutoHide(
  splash: SplashControlAdapter,
  report: SplashErrorReporter = reportSplashError
): Promise<void> {
  try {
    await splash.preventAutoHideAsync();
  } catch (error) {
    report('Could not keep the startup splash visible.', error);
  }
}

export async function hideSplashAfterAuthResolution(
  splash: SplashControlAdapter,
  {
    report = reportSplashError,
    retryDelayMs = HIDE_RETRY_DELAY_MS,
  }: SplashHideOptions = {}
): Promise<SplashHideResult> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= HIDE_ATTEMPTS; attempt += 1) {
    try {
      await splash.hideAsync();
      return { status: 'hidden', attempts: attempt };
    } catch (error) {
      lastError = error;
      if (attempt < HIDE_ATTEMPTS) {
        report(
          `Startup splash hide attempt ${attempt} of ${HIDE_ATTEMPTS} failed; retrying.`,
          error
        );
        if (retryDelayMs > 0) {
          await new Promise<void>((resolve) => {
            setTimeout(resolve, retryDelayMs);
          });
        }
      }
    }
  }

  report(
    `Startup splash could not be hidden after ${HIDE_ATTEMPTS} attempts.`,
    lastError
  );
  return { status: 'failed', attempts: HIDE_ATTEMPTS, error: lastError };
}
