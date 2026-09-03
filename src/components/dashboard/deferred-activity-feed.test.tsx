// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./activity-feed', () => ({
  ActivityFeed: ({
    items,
    loading,
    failed,
  }: {
    items: Array<{ id: string }> | null;
    loading: boolean;
    failed?: boolean;
  }) => (
    <output data-testid="feed">
      {failed ? 'failed' : loading ? 'loading' : (items?.[0]?.id ?? 'empty')}
    </output>
  ),
}));

const { DeferredActivityFeed } = await import('./deferred-activity-feed');

describe('DeferredActivityFeed', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('reads recent work on its own request rather than the insights snapshot', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ activity: [{ id: 'activity-1' }] }))
    );

    render(<DeferredActivityFeed />);

    expect(screen.getByTestId('feed').textContent).toBe('loading');
    await vi.waitFor(() =>
      expect(screen.getByTestId('feed').textContent).toBe('activity-1')
    );
    expect(fetch).toHaveBeenCalledWith(
      '/api/dashboard/insights?view=activity',
      {
        cache: 'no-store',
      }
    );
  });

  it('reports a failed read instead of pulsing forever', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({ error: 'Unauthorized' }, { status: 403 })
      )
    );

    render(<DeferredActivityFeed />);

    await vi.waitFor(() =>
      expect(screen.getByTestId('feed').textContent).toBe('failed')
    );
    expect(errorSpy).toHaveBeenCalledOnce();
    errorSpy.mockRestore();
  });
});
