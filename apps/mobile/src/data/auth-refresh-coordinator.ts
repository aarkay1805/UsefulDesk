import { processLock, type LockFunc } from '@supabase/supabase-js';

export const AUTH_QUIESCENCE_TIMEOUT_MS = 5_000;

export interface AuthRefreshRetirement {
  readonly generation: number;
  waitForRequests(): Promise<void>;
}

export interface AuthRefreshCoordinator {
  readonly fetch: typeof fetch;
  readonly lock: LockFunc;
  retire(): AuthRefreshRetirement;
  complete(retirement: AuthRefreshRetirement): boolean;
  isQuiescent(): boolean;
}

export type AuthRefreshLifecycle = Pick<
  AuthRefreshCoordinator,
  'retire' | 'complete' | 'isQuiescent'
>;

interface TrackedRefresh {
  readonly generation: number;
  readonly controller: AbortController;
  readonly settled: Promise<void>;
  retire(): void;
}

function abortError(): Error {
  const error = new Error('Auth refresh request retired');
  error.name = 'AbortError';
  return error;
}

function retiredResponse(): Response {
  // Auth JS retries thrown/aborted fetches. A local terminal response lets its
  // current refresh continuation finish under the configured auth lock without
  // waiting on, or exposing data from, the retired transport request.
  return {
    ok: false,
    status: 400,
    headers: {
      get: (name: string) =>
        name.toLowerCase() === 'content-type' ? 'application/json' : null,
    },
    json: async () => ({
      error_code: 'refresh_request_retired',
      message: 'Auth refresh request retired',
    }),
  } as unknown as Response;
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  if (typeof input === 'object' && input !== null && 'url' in input) {
    const url = input.url;
    if (typeof url === 'string') return url;
  }
  return String(input);
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit): string {
  if (init?.method) return init.method.toUpperCase();
  if (typeof input === 'object' && input !== null && 'method' in input) {
    const method = input.method;
    if (typeof method === 'string') return method.toUpperCase();
  }
  return 'GET';
}

function requestSignal(
  input: RequestInfo | URL,
  init?: RequestInit
): AbortSignal | null {
  if (init?.signal) return init.signal;
  if (typeof input === 'object' && input !== null && 'signal' in input) {
    const signal = input.signal;
    if (
      typeof signal === 'object' &&
      signal !== null &&
      'aborted' in signal &&
      'addEventListener' in signal
    ) {
      return signal as AbortSignal;
    }
  }
  return null;
}

export function createAuthRefreshCoordinator(
  baseFetch: typeof fetch,
  supabaseUrl: string
): AuthRefreshCoordinator {
  const refreshEndpoint = new URL('/auth/v1/token', supabaseUrl);
  const active = new Set<TrackedRefresh>();
  const ownedRetirements = new Set<AuthRefreshRetirement>();
  let generation = 0;
  let acceptingRefreshes = true;
  let quiescent = true;

  const isRefreshGrant = (
    input: RequestInfo | URL,
    init?: RequestInit
  ): boolean => {
    if (requestMethod(input, init) !== 'POST') return false;
    try {
      const url = new URL(requestUrl(input));
      return (
        url.origin === refreshEndpoint.origin &&
        url.pathname === refreshEndpoint.pathname &&
        url.searchParams.get('grant_type') === 'refresh_token'
      );
    } catch {
      return false;
    }
  };

  const trackedFetch: typeof fetch = async (input, init) => {
    if (!isRefreshGrant(input, init)) return baseFetch(input, init);
    if (!acceptingRefreshes) return retiredResponse();

    const requestGeneration = generation;
    const controller = new AbortController();
    const callerSignal = requestSignal(input, init);
    const abortFromCaller = () => controller.abort();
    if (callerSignal?.aborted) throw abortError();
    callerSignal?.addEventListener('abort', abortFromCaller, {
      once: true,
    });

    let markSettled!: () => void;
    const settled = new Promise<void>((resolve) => {
      markSettled = resolve;
    });
    let finishRetirement!: () => void;
    const retirementTerminal = new Promise<Response>((resolve) => {
      finishRetirement = () => resolve(retiredResponse());
    });
    let retired = false;
    const tracked: TrackedRefresh = {
      generation: requestGeneration,
      controller,
      settled,
      retire() {
        retired = true;
        finishRetirement();
        controller.abort();
      },
    };
    active.add(tracked);

    let rejectForCallerAbort: (() => void) | null = null;
    const callerAbort = new Promise<Response>((_resolve, reject) => {
      rejectForCallerAbort = () => {
        if (!retired) reject(abortError());
      };
      controller.signal.addEventListener('abort', rejectForCallerAbort, {
        once: true,
      });
    });

    try {
      return await Promise.race([
        baseFetch(input, { ...init, signal: controller.signal }),
        retirementTerminal,
        callerAbort,
      ]);
    } finally {
      callerSignal?.removeEventListener('abort', abortFromCaller);
      if (rejectForCallerAbort) {
        controller.signal.removeEventListener('abort', rejectForCallerAbort);
      }
      active.delete(tracked);
      markSettled();
    }
  };

  return {
    fetch: trackedFetch,
    lock: processLock,
    retire() {
      generation += 1;
      acceptingRefreshes = false;
      quiescent = false;
      const retired = [...active].filter(
        (request) => request.generation < generation
      );
      const retirement: AuthRefreshRetirement = {
        generation,
        async waitForRequests() {
          await Promise.all(retired.map((request) => request.settled));
        },
      };
      ownedRetirements.clear();
      ownedRetirements.add(retirement);
      retired.forEach((request) => request.retire());
      return retirement;
    },
    complete(retirement) {
      if (
        !ownedRetirements.delete(retirement) ||
        retirement.generation !== generation
      ) {
        return false;
      }
      acceptingRefreshes = true;
      quiescent = true;
      return true;
    },
    isQuiescent: () => quiescent,
  };
}
