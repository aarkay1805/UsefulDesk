export type RemoteSessionRevocation =
  { status: 'success' } | { status: 'failed' };

export interface RemoteSessionRevoker {
  revoke(accessToken: string): Promise<RemoteSessionRevocation>;
}

interface RemoteSessionEnvironment {
  supabaseUrl: string;
  supabaseAnonKey: string;
}

export function createRemoteSessionRevoker(
  baseFetch: typeof fetch,
  environment: RemoteSessionEnvironment
): RemoteSessionRevoker {
  const logoutUrl = new URL(
    '/auth/v1/logout?scope=global',
    environment.supabaseUrl
  ).toString();

  return {
    async revoke(accessToken) {
      try {
        const response = await baseFetch(logoutUrl, {
          method: 'POST',
          headers: {
            apikey: environment.supabaseAnonKey,
            Authorization: `Bearer ${accessToken}`,
          },
        });
        if (
          response.ok ||
          response.status === 401 ||
          response.status === 403 ||
          response.status === 404
        ) {
          return { status: 'success' };
        }
      } catch {
        // The caller still owns guaranteed local cleanup.
      }
      return { status: 'failed' };
    },
  };
}
