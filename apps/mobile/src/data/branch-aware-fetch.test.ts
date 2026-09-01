import 'react-native-url-polyfill/auto';

import { createBranchAwareFetch } from './branch-aware-fetch';

describe('createBranchAwareFetch', () => {
  it('attaches the selected branch header', async () => {
    const branchId = 'd3648c54-a4aa-4dd8-8566-1e3b38c1f497';
    let captured: RequestInit | undefined;
    const baseFetch: typeof fetch = async (_input, init) => {
      captured = init;
      return new Response(null, { status: 204 });
    };

    await createBranchAwareFetch(
      baseFetch,
      () => branchId
    )('https://example.supabase.co/rest/v1/members');

    expect(new Headers(captured?.headers).get('x-usefuldesk-account-id')).toBe(
      branchId
    );
  });

  it('omits the branch header and keeps Request authorization, method, and body', async () => {
    let capturedInput: RequestInfo | URL | undefined;
    let capturedInit: RequestInit | undefined;
    const baseFetch: typeof fetch = async (input, init) => {
      capturedInput = input;
      capturedInit = init;
      return new Response(null, { status: 204 });
    };
    const request = new Request('https://example.supabase.co/rest/v1/members', {
      method: 'POST',
      headers: { Authorization: 'Bearer request-token' },
      body: '{"member":"Asha"}',
    });

    await createBranchAwareFetch(baseFetch, () => null)(request);

    expect(
      new Headers(capturedInit?.headers).has('x-usefuldesk-account-id')
    ).toBe(false);
    expect(new Headers(capturedInit?.headers).get('authorization')).toBe(
      'Bearer request-token'
    );
    expect(capturedInput).toBe(request);
    expect((capturedInput as Request).method).toBe('POST');
    await expect((capturedInput as Request).text()).resolves.toBe(
      '{"member":"Asha"}'
    );
  });

  it('keeps init authorization, method, and body while adding the branch header', async () => {
    const branchId = 'f8b2a93d-bfa4-485a-8ab1-1b37862d6d72';
    let capturedInit: RequestInit | undefined;
    const baseFetch: typeof fetch = async (_input, init) => {
      capturedInit = init;
      return new Response(null, { status: 204 });
    };

    await createBranchAwareFetch(baseFetch, () => branchId)(
      'https://example.supabase.co/rest/v1/members',
      {
        method: 'PATCH',
        body: '{"status":"active"}',
        headers: { Authorization: 'Bearer init-token' },
      }
    );

    const headers = new Headers(capturedInit?.headers);
    expect(headers.get('x-usefuldesk-account-id')).toBe(branchId);
    expect(headers.get('authorization')).toBe('Bearer init-token');
    expect(capturedInit?.method).toBe('PATCH');
    expect(capturedInit?.body).toBe('{"status":"active"}');
  });

  it('lets overriding init headers win for a direct Request candidate read', async () => {
    const publishedBranch = 'd3648c54-a4aa-4dd8-8566-1e3b38c1f497';
    const candidateBranch = 'f8b2a93d-bfa4-485a-8ab1-1b37862d6d72';
    let capturedInit: RequestInit | undefined;
    const baseFetch: typeof fetch = async (_input, init) => {
      capturedInit = init;
      return new Response(null, { status: 204 });
    };
    const request = new Request(
      'https://example.supabase.co/rest/v1/accounts',
      {
        headers: {
          Authorization: 'Bearer request-token',
          'x-usefuldesk-account-id': publishedBranch,
        },
      }
    );

    await createBranchAwareFetch(baseFetch, () => publishedBranch)(request, {
      headers: {
        Authorization: 'Bearer init-token',
        'x-usefuldesk-account-id': candidateBranch,
      },
    });

    const headers = new Headers(capturedInit?.headers);
    expect(headers.get('authorization')).toBe('Bearer init-token');
    expect(headers.get('x-usefuldesk-account-id')).toBe(candidateBranch);
  });
});
