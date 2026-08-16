import { describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  cleanup: vi.fn(),
}));

vi.mock('@/lib/cron/auth', () => ({
  cronSecretConfigured: () => true,
  isAuthorizedCronRequest: () => true,
}));

vi.mock('@/lib/memberships/import-draft-admin', () => ({
  cleanupExpiredMemberImportDrafts: h.cleanup,
}));

import { GET } from './route';

describe('member import draft cleanup route', () => {
  it('reports the bounded cleanup result', async () => {
    h.cleanup.mockResolvedValue({ claimed: 2, deleted: 1, failed: 1 });

    const response = await GET(
      new Request('https://desk.example/api/members/import-draft/cleanup')
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      claimed: 2,
      deleted: 1,
      failed: 1,
    });
  });
});
