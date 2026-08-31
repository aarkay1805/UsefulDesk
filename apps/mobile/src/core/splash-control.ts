export interface SplashControlAdapter {
  preventAutoHideAsync(): Promise<boolean | undefined>;
  hideAsync(): Promise<void>;
  hide(): void;
}

export type SplashErrorReporter = (message: string, error: unknown) => void;

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
  report: SplashErrorReporter = reportSplashError
): Promise<void> {
  try {
    await splash.hideAsync();
  } catch (error) {
    report('Could not hide the startup splash asynchronously.', error);
    try {
      splash.hide();
    } catch (fallbackError) {
      report(
        'Could not hide the startup splash with the fallback.',
        fallbackError
      );
    }
  }
}
