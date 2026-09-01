import {
  createRemoteSessionRevoker,
  type RemoteSessionRevocation,
} from './session-revocation';

describe('createRemoteSessionRevoker', () => {
  it('revokes the captured session through the exact Supabase logout endpoint', async () => {
    let capturedInput: RequestInfo | URL | undefined;
    let capturedInit: RequestInit | undefined;
    const baseFetch: typeof fetch = async (input, init) => {
      capturedInput = input;
      capturedInit = init;
      return new Response(null, { status: 204 });
    };
    const revoker = createRemoteSessionRevoker(baseFetch, {
      supabaseUrl: 'https://example.supabase.co',
      supabaseAnonKey: 'sb_publishable_synthetic-public-key',
    });

    await expect(revoker.revoke('synthetic-access-token')).resolves.toEqual({
      status: 'success',
    });

    expect(String(capturedInput)).toBe(
      'https://example.supabase.co/auth/v1/logout?scope=global'
    );
    expect(capturedInit?.method).toBe('POST');
    const headers = new Headers(capturedInit?.headers);
    expect(headers.get('apikey')).toBe('sb_publishable_synthetic-public-key');
    expect(headers.get('authorization')).toBe('Bearer synthetic-access-token');
  });

  it.each([401, 403, 404])(
    'keeps remote revocation unconfirmed for HTTP %s without reading a body',
    async (status) => {
      const bodyRead = jest.fn(() => {
        throw new Error('response body must stay private');
      });
      const revoker = createRemoteSessionRevoker(
        async () =>
          ({
            ok: false,
            status,
            text: bodyRead,
            json: bodyRead,
          }) as unknown as Response,
        {
          supabaseUrl: 'https://example.supabase.co',
          supabaseAnonKey: 'sb_publishable_synthetic-public-key',
        }
      );

      await expect(revoker.revoke('expired-access-token')).resolves.toEqual({
        status: 'failed',
        reason: 'unconfirmed',
      });
      expect(bodyRead).not.toHaveBeenCalled();
    }
  );

  it('returns a structured unconfirmed result for any non-2xx response', async () => {
    const revoker = createRemoteSessionRevoker(
      async () => new Response(null, { status: 503 }),
      {
        supabaseUrl: 'https://example.supabase.co',
        supabaseAnonKey: 'sb_publishable_synthetic-public-key',
      }
    );

    const result: RemoteSessionRevocation = await revoker.revoke(
      'synthetic-access-token'
    );
    expect(result).toEqual({ status: 'failed', reason: 'unconfirmed' });
  });

  it('returns only a structured unavailable result when fetch rejects', async () => {
    const revoker = createRemoteSessionRevoker(
      async () => {
        throw new Error('offline diagnostic with credentials');
      },
      {
        supabaseUrl: 'https://example.supabase.co',
        supabaseAnonKey: 'sb_publishable_synthetic-public-key',
      }
    );

    await expect(revoker.revoke('synthetic-access-token')).resolves.toEqual({
      status: 'failed',
      reason: 'unavailable',
    });
  });

  it('aborts and settles a hanging revocation at its configured deadline', async () => {
    jest.useFakeTimers();
    try {
      let capturedSignal: AbortSignal | null = null;
      const revoker = createRemoteSessionRevoker(
        async (_input, init) => {
          capturedSignal = init?.signal ?? null;
          return new Promise<Response>(() => {});
        },
        {
          supabaseUrl: 'https://example.supabase.co',
          supabaseAnonKey: 'sb_publishable_synthetic-public-key',
        },
        { timeoutMs: 50 }
      );

      const pending = revoker.revoke('synthetic-access-token');
      await jest.advanceTimersByTimeAsync(50);

      await expect(pending).resolves.toEqual({
        status: 'failed',
        reason: 'timeout',
      });
      expect(capturedSignal).not.toBeNull();
      expect((capturedSignal as unknown as AbortSignal).aborted).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });
});
