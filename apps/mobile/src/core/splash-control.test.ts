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

  it('recovers from a transient failure by retrying the one native hide operation', async () => {
    const error = new Error('native hide temporarily unavailable');
    const report = jest.fn();
    const adapter = splashAdapter({
      hideAsync: jest
        .fn()
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce(undefined),
    });

    const result = await hideSplashAfterAuthResolution(adapter, {
      report,
      retryDelayMs: 0,
    });

    expect(report).toHaveBeenCalledWith(
      'Startup splash hide attempt 1 of 3 failed; retrying.',
      error
    );
    expect(adapter.hideAsync).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ status: 'hidden', attempts: 2 });
  });

  it('returns and reports a terminal failure after bounded retries', async () => {
    const error = new Error('native hide unavailable');
    const report = jest.fn();
    const adapter = splashAdapter({
      hideAsync: jest.fn().mockRejectedValue(error),
    });

    const result = await hideSplashAfterAuthResolution(adapter, {
      report,
      retryDelayMs: 0,
    });

    expect(adapter.hideAsync).toHaveBeenCalledTimes(3);
    expect(report).toHaveBeenLastCalledWith(
      'Startup splash could not be hidden after 3 attempts.',
      error
    );
    expect(result).toEqual({
      status: 'failed',
      attempts: 3,
      error,
    });
  });

  it('resolves terminal failure state without an unhandled rejection contract', async () => {
    const error = new Error('native hide unavailable');

    await expect(
      hideSplashAfterAuthResolution(
        splashAdapter({ hideAsync: jest.fn().mockRejectedValue(error) }),
        { report: jest.fn(), retryDelayMs: 0 }
      )
    ).resolves.toMatchObject({
      status: 'failed',
      attempts: 3,
      error,
    });
  });
});
