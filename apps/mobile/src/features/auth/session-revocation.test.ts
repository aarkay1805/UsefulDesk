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
    'treats terminal session status %s as remotely closed',
    async (status) => {
      const revoker = createRemoteSessionRevoker(
        async () => new Response(null, { status }),
        {
          supabaseUrl: 'https://example.supabase.co',
          supabaseAnonKey: 'sb_publishable_synthetic-public-key',
        }
      );

      await expect(revoker.revoke('expired-access-token')).resolves.toEqual({
        status: 'success',
      });
    }
  );

  it.each([
    async () => new Response(null, { status: 503 }),
    async () => {
      throw new Error('offline diagnostic with credentials');
    },
  ])(
    'returns only a structured failure for an unavailable remote',
    async (run) => {
      const revoker = createRemoteSessionRevoker(run as typeof fetch, {
        supabaseUrl: 'https://example.supabase.co',
        supabaseAnonKey: 'sb_publishable_synthetic-public-key',
      });

      const result: RemoteSessionRevocation = await revoker.revoke(
        'synthetic-access-token'
      );
      expect(result).toEqual({ status: 'failed' });
    }
  );
});
