// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const navigation = vi.hoisted(() => ({
  pathname: '/flows',
  push: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({ push: navigation.push }),
}));

const { usePendingNavigation } = await import('./use-pending-navigation');

beforeEach(() => {
  navigation.pathname = '/flows';
  navigation.push.mockReset();
});

describe('usePendingNavigation', () => {
  it('identifies the clicked destination until the pathname changes', () => {
    const { result, rerender } = renderHook(() => usePendingNavigation());

    act(() => result.current.navigate('/flows/flow-1'));

    expect(navigation.push).toHaveBeenCalledWith('/flows/flow-1');
    expect(result.current.isPending('/flows/flow-1')).toBe(true);
    expect(result.current.isPending('/flows/flow-2')).toBe(false);

    navigation.pathname = '/flows/flow-1';
    rerender();

    expect(result.current.isPending('/flows/flow-1')).toBe(false);
  });

  it('can track a Link navigation without pushing a duplicate route', () => {
    const { result } = renderHook(() => usePendingNavigation());

    act(() => result.current.startNavigation('/dashboard'));

    expect(result.current.isPending('/dashboard')).toBe(true);
    expect(navigation.push).not.toHaveBeenCalled();
  });
});
