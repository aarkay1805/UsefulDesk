import type { PickedMediaAsset } from './media-picker';
import {
  MediaUploadError,
  deleteConversationMedia,
  uploadConversationMedia,
  type MediaUploadDependencies,
  type MediaUploadRequest,
} from './media-upload-client';

const ACCOUNT_ID = 'd3648c54-a4aa-4dd8-8566-1e3b38c1f497';
const OTHER_ACCOUNT_ID = '76ce2ae6-8063-4bb0-9136-2cb74c895ec1';
const SUPABASE_URL = 'https://project.supabase.test';
const ASSET: PickedMediaAsset = {
  kind: 'image',
  uri: 'file:///cache/member photo.jpg',
  name: 'member photo.jpg',
  mimeType: 'image/jpeg',
  size: 1024,
};

class FakeRequest implements MediaUploadRequest {
  method = '';
  url = '';
  headers: Record<string, string> = {};
  sent: unknown = null;
  status = 0;
  aborted = false;
  upload: { onprogress: ((event: { loaded: number; total: number }) => void) | null } = {
    onprogress: null,
  };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;

  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }

  send(body: unknown) {
    this.sent = body;
  }

  abort() {
    this.aborted = true;
    this.onabort?.();
  }

  respond(status: number) {
    this.status = status;
    this.onload?.();
  }
}

function dependencies(options: { branchId?: string | null } = {}) {
  const requests: FakeRequest[] = [];
  const blob = { size: ASSET.size, type: ASSET.mimeType } as Blob;
  const readBlob = jest.fn().mockResolvedValue(blob);
  const getSession = jest.fn().mockResolvedValue({
    data: { session: { access_token: 'current-token' } },
    error: null,
  });
  const refreshSession = jest.fn();
  const recoverUnauthorizedSession = jest.fn().mockResolvedValue(undefined);
  const selectedBranch = {
    get: jest.fn(() =>
      options.branchId === undefined ? ACCOUNT_ID : options.branchId
    ),
  };
  const result: MediaUploadDependencies = {
    supabaseUrl: SUPABASE_URL,
    anonKey: 'public-anon-key',
    auth: { getSession, refreshSession },
    selectedBranch,
    recoverUnauthorizedSession,
    readBlob,
    createRequest: () => {
      const request = new FakeRequest();
      requests.push(request);
      return request;
    },
    now: () => 1700000000000,
  };
  return {
    result,
    requests,
    readBlob,
    getSession,
    refreshSession,
    recoverUnauthorizedSession,
    selectedBranch,
    blob,
  };
}

async function nextRequest(setup: ReturnType<typeof dependencies>, index = 0) {
  for (let count = 0; count < 20 && !setup.requests[index]; count += 1) {
    await Promise.resolve();
  }
  const request = setup.requests[index];
  if (!request) throw new Error('Upload request was not created');
  return request;
}

describe('uploadConversationMedia', () => {
  it('uploads one blob to the canonical account path with auth and branch headers', async () => {
    const setup = dependencies();
    const progress = jest.fn();
    const operation = uploadConversationMedia(
      { accountId: ACCOUNT_ID, asset: ASSET, onProgress: progress },
      setup.result
    );
    const request = await nextRequest(setup);

    expect(request.method).toBe('POST');
    expect(request.url).toBe(
      `${SUPABASE_URL}/storage/v1/object/chat-media/account-${ACCOUNT_ID}/1700000000000-member_photo.jpg`
    );
    expect(request.headers).toEqual({
      Authorization: 'Bearer current-token',
      apikey: 'public-anon-key',
      'x-usefuldesk-account-id': ACCOUNT_ID,
      'Content-Type': 'image/jpeg',
      'Cache-Control': '3600',
      'x-upsert': 'false',
    });
    expect(request.sent).toBe(setup.blob);
    expect(setup.readBlob).toHaveBeenCalledTimes(1);
    expect(setup.readBlob).toHaveBeenCalledWith(ASSET.uri, expect.any(AbortSignal));

    request.upload.onprogress?.({ loaded: 400, total: 1000 });
    request.upload.onprogress?.({ loaded: 1200, total: 1000 });
    request.upload.onprogress?.({ loaded: -1, total: 1000 });
    expect(progress.mock.calls.map(([value]) => value)).toEqual([0, 0.4, 1, 0]);

    request.respond(200);
    await expect(operation.promise).resolves.toEqual({
      path: `account-${ACCOUNT_ID}/1700000000000-member_photo.jpg`,
      publicUrl: `${SUPABASE_URL}/storage/v1/object/public/chat-media/account-${ACCOUNT_ID}/1700000000000-member_photo.jpg`,
    });
  });

  it('rejects a stale branch before reading or creating a request', async () => {
    const setup = dependencies({ branchId: OTHER_ACCOUNT_ID });
    const operation = uploadConversationMedia(
      { accountId: ACCOUNT_ID, asset: ASSET },
      setup.result
    );

    await expect(operation.promise).rejects.toMatchObject({
      category: 'forbidden',
      message: 'This branch is no longer selected.',
    });
    expect(setup.readBlob).not.toHaveBeenCalled();
    expect(setup.requests).toHaveLength(0);
  });

  it('refreshes once after 401 and reuses the same blob and stable path', async () => {
    const setup = dependencies();
    setup.refreshSession.mockResolvedValue({
      data: { session: { access_token: 'fresh-token' } },
      error: null,
    });
    const operation = uploadConversationMedia(
      { accountId: ACCOUNT_ID, asset: ASSET },
      setup.result
    );
    const first = await nextRequest(setup);
    first.respond(401);
    const second = await nextRequest(setup, 1);

    expect(second.url).toBe(first.url);
    expect(second.sent).toBe(first.sent);
    expect(second.headers.Authorization).toBe('Bearer fresh-token');
    expect(setup.readBlob).toHaveBeenCalledTimes(1);
    expect(setup.refreshSession).toHaveBeenCalledTimes(1);
    second.respond(200);
    await expect(operation.promise).resolves.toMatchObject({
      path: `account-${ACCOUNT_ID}/1700000000000-member_photo.jpg`,
    });
  });

  it('recovers a same-path object-exists response only after the 401 retry', async () => {
    const recovered = dependencies();
    recovered.refreshSession.mockResolvedValue({
      data: { session: { access_token: 'fresh-token' } },
      error: null,
    });
    const retry = uploadConversationMedia(
      { accountId: ACCOUNT_ID, asset: ASSET },
      recovered.result
    );
    (await nextRequest(recovered)).respond(401);
    (await nextRequest(recovered, 1)).respond(409);
    await expect(retry.promise).resolves.toMatchObject({
      path: `account-${ACCOUNT_ID}/1700000000000-member_photo.jpg`,
    });

    const direct = dependencies();
    const collision = uploadConversationMedia(
      { accountId: ACCOUNT_ID, asset: ASSET },
      direct.result
    );
    (await nextRequest(direct)).respond(409);
    await expect(collision.promise).rejects.toMatchObject({
      category: 'storage',
    });
  });

  it('securely recovers after a second 401 and never retries a 403', async () => {
    const unauthorized = dependencies();
    unauthorized.refreshSession.mockResolvedValue({
      data: { session: { access_token: 'fresh-token' } },
      error: null,
    });
    const expired = uploadConversationMedia(
      { accountId: ACCOUNT_ID, asset: ASSET },
      unauthorized.result
    );
    (await nextRequest(unauthorized)).respond(401);
    (await nextRequest(unauthorized, 1)).respond(401);
    await expect(expired.promise).rejects.toMatchObject({
      category: 'unauthorized',
    });
    expect(unauthorized.recoverUnauthorizedSession).toHaveBeenCalledTimes(1);
    expect(unauthorized.requests).toHaveLength(2);

    const forbidden = dependencies();
    const denied = uploadConversationMedia(
      { accountId: ACCOUNT_ID, asset: ASSET },
      forbidden.result
    );
    (await nextRequest(forbidden)).respond(403);
    await expect(denied.promise).rejects.toMatchObject({ category: 'forbidden' });
    expect(forbidden.refreshSession).not.toHaveBeenCalled();
    expect(forbidden.requests).toHaveLength(1);
  });

  it('maps transport failures safely without exposing response bodies', async () => {
    const setup = dependencies();
    const operation = uploadConversationMedia(
      { accountId: ACCOUNT_ID, asset: ASSET },
      setup.result
    );
    const request = await nextRequest(setup);
    request.onerror?.();
    await expect(operation.promise).rejects.toEqual(
      new MediaUploadError('network', 'Could not upload this attachment.')
    );
  });

  it('aborts both URI reading and the active XHR without reporting success', async () => {
    const setup = dependencies();
    const operation = uploadConversationMedia(
      { accountId: ACCOUNT_ID, asset: ASSET },
      setup.result
    );
    const request = await nextRequest(setup);
    operation.abort();
    expect(request.aborted).toBe(true);
    await expect(operation.promise).rejects.toMatchObject({ category: 'aborted' });
  });
});

describe('deleteConversationMedia', () => {
  it('best-effort deletes only the exact selected-account path', async () => {
    const setup = dependencies();
    const path = `account-${ACCOUNT_ID}/1700000000000-member_photo.jpg`;
    const pending = deleteConversationMedia(
      { accountId: ACCOUNT_ID, path },
      setup.result
    );
    const request = await nextRequest(setup);
    expect(request.method).toBe('DELETE');
    expect(request.url).toBe(`${SUPABASE_URL}/storage/v1/object/chat-media`);
    expect(request.headers).toMatchObject({
      Authorization: 'Bearer current-token',
      apikey: 'public-anon-key',
      'x-usefuldesk-account-id': ACCOUNT_ID,
      'Content-Type': 'application/json',
    });
    expect(request.sent).toBe(JSON.stringify({ prefixes: [path] }));
    request.respond(500);
    await expect(pending).resolves.toBeUndefined();

    await expect(
      deleteConversationMedia(
        { accountId: ACCOUNT_ID, path: `account-${OTHER_ACCOUNT_ID}/x.jpg` },
        setup.result
      )
    ).resolves.toBeUndefined();
    expect(setup.requests).toHaveLength(1);
  });
});
