import {
  hideSplashAfterAuthResolution,
  preventSplashAutoHide,
  type SplashControlAdapter,
} from './splash-control';

function splashAdapter(
  overrides: Partial<SplashControlAdapter> = {}
): SplashControlAdapter {
  return {
    preventAutoHideAsync: jest.fn().mockResolvedValue(true),
    hideAsync: jest.fn().mockResolvedValue(undefined),
    hide: jest.fn(),
    ...overrides,
  };
}

describe('splash control', () => {
  it('reports a module-scope prevention failure', async () => {
    const error = new Error('native splash unavailable');
    const report = jest.fn();

    await preventSplashAutoHide(
      splashAdapter({
        preventAutoHideAsync: jest.fn().mockRejectedValue(error),
      }),
      report
    );

    expect(report).toHaveBeenCalledWith(
      'Could not keep the startup splash visible.',
      error
    );
  });

  it('reports an async hide failure and uses the synchronous hide fallback', async () => {
    const error = new Error('async hide unavailable');
    const report = jest.fn();
    const adapter = splashAdapter({
      hideAsync: jest.fn().mockRejectedValue(error),
    });

    await hideSplashAfterAuthResolution(adapter, report);

    expect(report).toHaveBeenCalledWith(
      'Could not hide the startup splash asynchronously.',
      error
    );
    expect(adapter.hide).toHaveBeenCalledTimes(1);
  });

  it('reports a synchronous fallback failure instead of swallowing it', async () => {
    const asyncError = new Error('async hide unavailable');
    const fallbackError = new Error('sync hide unavailable');
    const report = jest.fn();

    await hideSplashAfterAuthResolution(
      splashAdapter({
        hideAsync: jest.fn().mockRejectedValue(asyncError),
        hide: jest.fn(() => {
          throw fallbackError;
        }),
      }),
      report
    );

    expect(report).toHaveBeenLastCalledWith(
      'Could not hide the startup splash with the fallback.',
      fallbackError
    );
  });
});
