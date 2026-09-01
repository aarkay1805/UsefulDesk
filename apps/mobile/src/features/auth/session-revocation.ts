export type RemoteSessionRevocation =
  | { status: 'success' }
  | {
      status: 'failed';
      reason: 'timeout' | 'unavailable' | 'unconfirmed';
    };

export interface RemoteSessionRevoker {
  revoke(accessToken: string): Promise<RemoteSessionRevocation>;
}

interface RemoteSessionEnvironment {
  supabaseUrl: string;
  supabaseAnonKey: string;
}

interface RemoteSessionRevokerOptions {
  timeoutMs?: number;
}

const DEFAULT_REVOCATION_TIMEOUT_MS = 8_000;

export function createRemoteSessionRevoker(
  baseFetch: typeof fetch,
  environment: RemoteSessionEnvironment,
  options: RemoteSessionRevokerOptions = {}
): RemoteSessionRevoker {
  const logoutUrl = new URL(
    '/auth/v1/logout?scope=global',
    environment.supabaseUrl
  ).toString();

  return {
    async revoke(accessToken) {
      const controller = new AbortController();
      let timedOut = false;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const request = (async (): Promise<RemoteSessionRevocation> => {
        try {
          const response = await baseFetch(logoutUrl, {
            method: 'POST',
            headers: {
              apikey: environment.supabaseAnonKey,
              Authorization: `Bearer ${accessToken}`,
            },
            signal: controller.signal,
          });
          return response.ok
            ? { status: 'success' }
            : { status: 'failed', reason: 'unconfirmed' };
        } catch {
          return {
            status: 'failed',
            reason: timedOut ? 'timeout' : 'unavailable',
          };
        }
      })();
      const deadline = new Promise<RemoteSessionRevocation>((resolve) => {
        timeout = setTimeout(() => {
          timedOut = true;
          controller.abort();
          resolve({ status: 'failed', reason: 'timeout' });
        }, options.timeoutMs ?? DEFAULT_REVOCATION_TIMEOUT_MS);
      });

      try {
        return await Promise.race([request, deadline]);
      } finally {
        if (timeout !== undefined) clearTimeout(timeout);
      }
    },
  };
}
