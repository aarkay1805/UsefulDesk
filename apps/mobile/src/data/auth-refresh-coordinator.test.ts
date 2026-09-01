import { createAuthRefreshCoordinator } from './auth-refresh-coordinator';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}

const okResponse = { ok: true, status: 200 } as Response;

describe('createAuthRefreshCoordinator', () => {
  it('retires only the exact Supabase refresh-token grant request', async () => {
    const ordinaryResponse = deferred<Response>();
    const refreshResponse = deferred<Response>();
    const signals: (AbortSignal | undefined)[] = [];
    const baseFetch = jest.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        signals.push(init?.signal ?? undefined);
        return String(input).includes('/auth/v1/token?grant_type=refresh_token')
          ? refreshResponse.promise
          : ordinaryResponse.promise;
      }
    );
    const coordinator = createAuthRefreshCoordinator(
      baseFetch,
      'https://example.supabase.co'
    );

    const ordinary = coordinator.fetch(
      'https://example.supabase.co/rest/v1/token?grant_type=refresh_token',
      { method: 'POST' }
    );
    const refresh = coordinator.fetch(
      'https://example.supabase.co/auth/v1/token?grant_type=refresh_token',
      { method: 'POST' }
    );
    await Promise.resolve();

    const retirement = coordinator.retire();

    await expect(refresh).resolves.toMatchObject({ ok: false, status: 400 });
    await expect(retirement.waitForRequests()).resolves.toBeUndefined();
    expect(signals[0]).toBeUndefined();
    expect(signals[1]?.aborted).toBe(true);

    ordinaryResponse.resolve(okResponse);
    refreshResponse.resolve(okResponse);
    await expect(ordinary).resolves.toBe(okResponse);
  });

  it('bounds a never-settling refresh and terminates refreshes while retired', async () => {
    const baseFetch = jest.fn(() => new Promise<Response>(() => undefined));
    const coordinator = createAuthRefreshCoordinator(
      baseFetch,
      'https://example.supabase.co'
    );
    const refresh = coordinator.fetch(
      'https://example.supabase.co/auth/v1/token?grant_type=refresh_token',
      { method: 'POST' }
    );
    await Promise.resolve();

    const retirement = coordinator.retire();

    await expect(refresh).resolves.toMatchObject({ ok: false, status: 400 });
    await expect(retirement.waitForRequests()).resolves.toBeUndefined();
    await expect(
      coordinator.fetch(
        'https://example.supabase.co/auth/v1/token?grant_type=refresh_token',
        { method: 'POST' }
      )
    ).resolves.toMatchObject({ ok: false, status: 400 });
    expect(baseFetch).toHaveBeenCalledTimes(1);
    expect(coordinator.isQuiescent()).toBe(false);
  });

  it('recognizes a refresh grant supplied as a Request object', async () => {
    const signal = new AbortController().signal;
    let underlyingSignal: AbortSignal | null | undefined;
    const baseFetch = jest.fn(
      (_input: RequestInfo | URL, init?: RequestInit) => {
        underlyingSignal = init?.signal;
        return new Promise<Response>(() => undefined);
      }
    );
    const coordinator = createAuthRefreshCoordinator(
      baseFetch,
      'https://example.supabase.co'
    );
    const request = {
      method: 'POST',
      signal,
      url: 'https://example.supabase.co/auth/v1/token?grant_type=refresh_token',
    } as Request;

    const refresh = coordinator.fetch(request);
    await Promise.resolve();
    const retirement = coordinator.retire();

    await expect(refresh).resolves.toMatchObject({ ok: false, status: 400 });
    await expect(retirement.waitForRequests()).resolves.toBeUndefined();
    expect(underlyingSignal?.aborted).toBe(true);
  });

  it('cannot reopen a newer generation by completing an obsolete retirement', () => {
    const coordinator = createAuthRefreshCoordinator(
      jest.fn().mockResolvedValue(okResponse),
      'https://example.supabase.co'
    );
    const first = coordinator.retire();
    expect(coordinator.complete(first)).toBe(true);
    expect(coordinator.isQuiescent()).toBe(true);

    const second = coordinator.retire();
    expect(coordinator.complete(first)).toBe(false);
    expect(coordinator.isQuiescent()).toBe(false);
    expect(coordinator.complete(second)).toBe(true);
    expect(coordinator.isQuiescent()).toBe(true);
  });
});
