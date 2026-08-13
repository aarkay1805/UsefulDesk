import { beforeEach, describe, expect, it, vi } from 'vitest';

const { downloadMedia, getCurrentAccount, getMediaUrl } = vi.hoisted(() => ({
  downloadMedia: vi.fn(),
  getCurrentAccount: vi.fn(),
  getMediaUrl: vi.fn(),
}));

vi.mock('@/lib/auth/account', () => ({ getCurrentAccount }));
vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: vi.fn(() => 'plain-access-token'),
}));
vi.mock('@/lib/whatsapp/meta-api', () => ({ downloadMedia, getMediaUrl }));

import { GET } from './route';

function makeSupabase() {
  const config = {
    account_id: 'account-1',
    access_token: 'encrypted-access-token',
  };
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    single: vi.fn(async () => ({ data: config, error: null })),
  };

  return { from: vi.fn(() => builder) };
}

describe('GET /api/whatsapp/media/[mediaId]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCurrentAccount.mockResolvedValue({
      accountId: 'account-1',
      supabase: makeSupabase(),
    });
    getMediaUrl.mockResolvedValue({
      url: 'https://lookaside.example/media',
      mimeType: 'image/jpeg',
    });
    downloadMedia.mockResolvedValue({
      buffer: Uint8Array.from([1, 2, 3]).buffer,
      contentType: 'image/jpeg',
    });
  });

  it('prevents authenticated private media bytes from entering any cache', async () => {
    const response = await GET(
      new Request('https://desk.example/api/whatsapp/media/media-1'),
      { params: Promise.resolve({ mediaId: 'media-1' }) }
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/jpeg');
    expect(response.headers.get('cache-control')).toBe(
      'private, no-store, max-age=0'
    );
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([
      1, 2, 3,
    ]);
    expect(getMediaUrl).toHaveBeenCalledWith({
      mediaId: 'media-1',
      accessToken: 'plain-access-token',
    });
  });
});
