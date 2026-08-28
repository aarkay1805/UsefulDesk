// @vitest-environment jsdom

import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let notifyIntersection: IntersectionObserverCallback;

vi.mock('next/dynamic', () => ({
  default: () =>
    function LoadedInsights() {
      return <div>Insights loaded</div>;
    },
}));

const { DeferredDashboardInsights } =
  await import('./deferred-dashboard-insights');

describe('DeferredDashboardInsights', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'IntersectionObserver',
      class IntersectionObserver {
        constructor(callback: IntersectionObserverCallback) {
          notifyIntersection = callback;
        }
        observe() {}
        disconnect() {}
        unobserve() {}
        takeRecords() {
          return [];
        }
        root = null;
        rootMargin = '0px';
        thresholds = [0];
      }
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('does not mount data-fetching insights until the section approaches the viewport', () => {
    render(<DeferredDashboardInsights />);

    expect(screen.queryByText('Insights loaded')).toBeNull();
    expect(screen.getByLabelText('Dashboard insights loading')).toBeTruthy();

    act(() => {
      notifyIntersection(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver
      );
    });

    expect(screen.getByText('Insights loaded')).toBeTruthy();
  });
});
