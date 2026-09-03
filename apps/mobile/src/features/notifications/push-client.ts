import type { InstallationRegistration } from './notification-types';
import { mobileEnvironment } from '../../core/env';

export type PushClientErrorCode =
  'unauthorized' | 'unavailable' | 'invalid_response';

export class PushClientError extends Error {
  constructor(public readonly code: PushClientErrorCode) {
    super(`Push registration failed: ${code}`);
    this.name = 'PushClientError';
  }
}

interface PushClientDependencies {
  baseUrl: string;
  fetcher?: typeof fetch;
  timeoutMs?: number;
}

export interface PushClient {
  register(
    accessToken: string,
    registration: InstallationRegistration
  ): Promise<void>;
  revoke(accessToken: string, installationId: string): Promise<void>;
}

export function createPushClient({
  baseUrl,
  fetcher = fetch,
  timeoutMs = 10_000,
}: PushClientDependencies): PushClient {
  const endpoint = new URL('/api/mobile/push/installation', baseUrl).toString();

  const request = async (
    method: 'PUT' | 'DELETE',
    accessToken: string,
    body: unknown
  ) => {
    let response: Response;
    try {
      response = await fetcher(endpoint, {
        method,
        headers: {
          authorization: `Bearer ${accessToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new PushClientError('unavailable');
    }
    if (response.status === 401) throw new PushClientError('unauthorized');
    if (!response.ok) throw new PushClientError('unavailable');
  };

  return {
    register: (accessToken, registration) =>
      request('PUT', accessToken, registration),
    revoke: (accessToken, installationId) =>
      request('DELETE', accessToken, { installationId }),
  };
}

export const pushClient = createPushClient({
  baseUrl: mobileEnvironment.apiBaseUrl,
});
