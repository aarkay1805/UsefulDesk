import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Stub the Meta resumable upload so the helper is tested in isolation.
vi.mock('./meta-api', () => ({
  uploadResumableMedia: vi.fn(async () => ({ handle: 'HANDLE123' })),
}));

vi.mock('@/lib/webhooks/ssrf', () => ({
  isDeliverableUrl: vi.fn(async () => true),
}));

import { ensureImageHeaderHandle } from './template-header-handle';
import { uploadResumableMedia } from './meta-api';
import { isDeliverableUrl } from '@/lib/webhooks/ssrf';
import type { TemplatePayload } from './template-validators';

function payload(over: Partial<TemplatePayload> = {}): TemplatePayload {
  return {
    name: 't',
    category: 'Utility',
    language: 'en_US',
    body_text: 'hi',
    header_type: 'image',
    header_media_url: 'https://x.test/img.jpg',
    ...over,
  };
}

function imgResponse(
  type = 'image/jpeg',
  size = 1024,
  ok = true,
  status = 200
): Response {
  return {
    ok,
    status,
    headers: {
      get: (h: string) => (h.toLowerCase() === 'content-type' ? type : null),
    },
    arrayBuffer: async () => new ArrayBuffer(size),
  } as unknown as Response;
}

describe('ensureImageHeaderHandle', () => {
  beforeEach(() => {
    vi.mocked(uploadResumableMedia).mockClear();
    vi.mocked(isDeliverableUrl).mockReset();
    vi.mocked(isDeliverableUrl).mockResolvedValue(true);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('is a no-op for non-image headers', async () => {
    const p = payload({ header_type: 'text', header_content: 'Hi' });
    await ensureImageHeaderHandle(p, 'tok');
    expect(uploadResumableMedia).not.toHaveBeenCalled();
    expect(p.header_handle).toBeUndefined();
  });

  it('is a no-op when a handle already exists', async () => {
    const p = payload({ header_handle: 'existing' });
    await ensureImageHeaderHandle(p, 'tok');
    expect(uploadResumableMedia).not.toHaveBeenCalled();
    expect(p.header_handle).toBe('existing');
  });

  it('throws an actionable error when META_APP_ID is unset', async () => {
    const p = payload();
    await expect(ensureImageHeaderHandle(p, 'tok')).rejects.toThrow(
      /META_APP_ID/
    );
  });

  it('derives + sets header_handle from a valid image URL', async () => {
    vi.stubEnv('META_APP_ID', 'app-1');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => imgResponse('image/jpeg', 2048))
    );
    const p = payload();
    await ensureImageHeaderHandle(p, 'tok');
    expect(uploadResumableMedia).toHaveBeenCalledOnce();
    expect(p.header_handle).toBe('HANDLE123');
  });

  it('rejects a non-image content type', async () => {
    vi.stubEnv('META_APP_ID', 'app-1');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => imgResponse('text/html'))
    );
    await expect(ensureImageHeaderHandle(payload(), 'tok')).rejects.toThrow(
      /JPEG or PNG/
    );
  });

  it('rejects an image over 5 MB', async () => {
    vi.stubEnv('META_APP_ID', 'app-1');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => imgResponse('image/png', 6 * 1024 * 1024))
    );
    await expect(ensureImageHeaderHandle(payload(), 'tok')).rejects.toThrow(
      /5 MB/
    );
  });

  it('blocks a non-public URL before fetch', async () => {
    vi.stubEnv('META_APP_ID', 'app-1');
    vi.mocked(isDeliverableUrl).mockResolvedValue(false);
    const fetchSpy = vi.fn(async () => imgResponse());
    vi.stubGlobal('fetch', fetchSpy);

    await expect(
      ensureImageHeaderHandle(
        payload({
          header_media_url: 'http://169.254.169.254/latest/meta-data/',
        }),
        'tok'
      )
    ).rejects.toThrow(/publicly reachable/);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(uploadResumableMedia).not.toHaveBeenCalled();
  });

  it('refuses redirects instead of following them', async () => {
    vi.stubEnv('META_APP_ID', 'app-1');
    const fetchSpy = vi.fn(async () =>
      imgResponse('text/plain', 0, false, 302)
    );
    vi.stubGlobal('fetch', fetchSpy);

    await expect(ensureImageHeaderHandle(payload(), 'tok')).rejects.toThrow(
      /returned 302/
    );
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://x.test/img.jpg',
      expect.objectContaining({ redirect: 'manual' })
    );
    expect(uploadResumableMedia).not.toHaveBeenCalled();
  });

  it('bounds the fetch to ten seconds and normalizes timeout errors', async () => {
    vi.stubEnv('META_APP_ID', 'app-1');
    const fetchSpy = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      throw new DOMException('timed out', 'TimeoutError');
    });
    vi.stubGlobal('fetch', fetchSpy);

    await expect(ensureImageHeaderHandle(payload(), 'tok')).rejects.toThrow(
      'Could not fetch the header image URL. Make sure it is publicly reachable.'
    );
    expect(uploadResumableMedia).not.toHaveBeenCalled();
  });
});
