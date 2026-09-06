// @vitest-environment jsdom
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  fireEvent,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const rpc = vi.hoisted(() => vi.fn());
const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
const auth = vi.hoisted(() => ({
  accountId: 'branch-1',
  organizationId: 'org-1',
  accountStatus: 'ready',
  branches: [],
  switchBranch: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => auth }));
vi.mock('@/hooks/use-locale', () => ({
  useLocale: () => ({ fmt: { dateTime: (value: string) => value } }),
}));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ rpc }) }));
import { ProductAccessGate } from './product-access-gate';
import { useEffect } from 'react';
const access = {
  organization_id: 'org-1',
  mode: 'trial',
  trial_started_at: '2026-09-01T00:00:00Z',
  trial_ends_at: '2026-09-15T00:00:00Z',
  access_starts_at: null,
  access_ends_at: null,
  suspended_at: null,
  version: 1,
};
const snapshot = {
  access,
  allowed: true,
  status: 'trial',
  enforcement_enabled: true,
  support_email: null,
  support_whatsapp: '919056208861',
};
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
beforeEach(() => {
  auth.accountId = 'branch-1';
  rpc.mockReset();
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-06T00:00:00Z'));
});
describe('ProductAccessGate', () => {
  it('shows only a spinner until access is confirmed, then mounts operational children', async () => {
    let finish: (value: unknown) => void = () => {};
    rpc.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    render(
      <ProductAccessGate>
        <div>Operations</div>
      </ProductAccessGate>
    );
    expect(screen.queryByText('Operations')).toBeNull();
    expect(
      screen.getByRole('status', { name: 'Loading UsefulDesk' })
    ).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
    await act(async () => {
      finish({ data: snapshot, error: null });
    });
    expect(screen.getByText('Operations')).toBeTruthy();
    expect(
      screen.queryByRole('status', { name: 'Loading UsefulDesk' })
    ).toBeNull();
  });
  it('mounts active trial and closes at its exact deadline before a refresh finishes', async () => {
    vi.useFakeTimers();
    const start = Date.parse('2026-09-06T00:00:00Z');
    rpc.mockResolvedValueOnce({
      data: {
        ...snapshot,
        access: {
          ...access,
          trial_ends_at: new Date(start + 1000).toISOString(),
        },
      },
      error: null,
    });
    await act(async () => {
      render(
        <ProductAccessGate>
          <div>Operations</div>
        </ProductAccessGate>
      );
    });
    expect(screen.getByText('Operations')).toBeTruthy();
    rpc.mockReturnValue(new Promise(() => {}));
    vi.spyOn(Date, 'now').mockReturnValue(start + 1000);
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.queryByText('Operations')).toBeNull();
    expect(screen.getByText('Contact support')).toBeTruthy();
  });
  it('retains support and sign-out while expired and refreshes on focus', async () => {
    rpc.mockResolvedValue({
      data: {
        ...snapshot,
        allowed: false,
        access: { ...access, trial_ends_at: '2026-09-05T00:00:00Z' },
      },
      error: null,
    });
    render(
      <ProductAccessGate>
        <div>Operations</div>
      </ProductAccessGate>
    );
    await waitFor(() =>
      expect(screen.getByText('WhatsApp support')).toBeTruthy()
    );
    expect(screen.queryByText('Operations')).toBeNull();
    expect(screen.getByText('Sign out')).toBeTruthy();
    rpc.mockResolvedValue({ data: snapshot, error: null });
    fireEvent.focus(window);
    await waitFor(() => expect(screen.getByText('Operations')).toBeTruthy());
    expect(router.refresh).toHaveBeenCalledTimes(1);
    fireEvent.focus(window);
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(3));
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });
  it('fails closed after RPC error and never reuses another branch access', async () => {
    rpc.mockResolvedValueOnce({ data: snapshot, error: null });
    const view = render(
      <ProductAccessGate>
        <div>Operations</div>
      </ProductAccessGate>
    );
    await waitFor(() => expect(screen.getByText('Operations')).toBeTruthy());
    auth.accountId = 'branch-2';
    rpc.mockResolvedValue({
      data: null,
      error: { message: 'Access check unavailable' },
    });
    view.rerender(
      <ProductAccessGate>
        <div>Operations</div>
      </ProductAccessGate>
    );
    expect(screen.queryByText('Operations')).toBeNull();
    await waitFor(() =>
      expect(screen.getByText('Access check unavailable')).toBeTruthy()
    );
  });
  it('keeps operational children mounted throughout a routine refresh', async () => {
    const mounted = vi.fn();
    const unmounted = vi.fn();
    function Operations() {
      useEffect(() => {
        mounted();
        return unmounted;
      }, []);
      return <div>Operations</div>;
    }
    rpc.mockResolvedValue({ data: snapshot, error: null });
    render(
      <ProductAccessGate>
        <Operations />
      </ProductAccessGate>
    );
    await waitFor(() => expect(screen.getByText('Operations')).toBeTruthy());
    let finish: (value: unknown) => void = () => {};
    rpc.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    fireEvent.focus(window);
    expect(screen.getByText('Operations')).toBeTruthy();
    expect(mounted).toHaveBeenCalledTimes(1);
    expect(unmounted).not.toHaveBeenCalled();
    await act(async () => {
      finish({ data: snapshot, error: null });
    });
    expect(mounted).toHaveBeenCalledTimes(1);
    expect(unmounted).not.toHaveBeenCalled();
    const link = screen.getByRole('link', { name: 'Contact support' });
    expect(
      new URL(link.getAttribute('href')!).searchParams.get('text')
    ).toContain('Support reference: org-1');
  });
  it.each([
    {},
    { ...snapshot, enforcement_enabled: undefined },
    { ...snapshot, enforcement_enabled: 'false' },
    { ...snapshot, allowed: false, enforcement_enabled: false },
    { ...snapshot, allowed: 'true', enforcement_enabled: false },
    { ...snapshot, access: { ...access, organization_id: 'another-org' } },
    { ...snapshot, access: null, enforcement_enabled: false },
  ])(
    'never mounts operational content for a malformed, denied, or wrong-organization grant: %j',
    async (payload) => {
      rpc.mockResolvedValue({ data: payload, error: null });
      render(
        <ProductAccessGate>
          <div>Operations</div>
        </ProductAccessGate>
      );
      await waitFor(() =>
        expect(
          screen.queryByRole('status', { name: 'Loading UsefulDesk' })
        ).toBeNull()
      );
      expect(screen.queryByText('Operations')).toBeNull();
    }
  );
  it('allows a valid explicitly granted rollout-disabled snapshot', async () => {
    rpc.mockResolvedValue({
      data: { ...snapshot, allowed: true, enforcement_enabled: false },
      error: null,
    });
    render(
      <ProductAccessGate>
        <div>Operations</div>
      </ProductAccessGate>
    );
    await waitFor(() => expect(screen.getByText('Operations')).toBeTruthy());
  });
});
