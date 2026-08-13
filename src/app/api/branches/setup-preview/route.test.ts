import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getCurrentAccount } = vi.hoisted(() => ({
  getCurrentAccount: vi.fn(),
}));

vi.mock('@/lib/auth/account', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/account')>();
  return { ...actual, getCurrentAccount };
});

import { __resetRateLimitForTests } from '@/lib/rate-limit';
import { GET } from './route';

const ENTITY_ID = '22222222-2222-4222-8222-222222222222';
const SOURCE_ID = '44444444-4444-4444-8444-444444444444';

describe('GET /api/branches/setup-preview', () => {
  const rpc = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    __resetRateLimitForTests();
    rpc.mockResolvedValue({
      data: { eligible: true, warnings: [], copied: { totalRows: 0 } },
      error: null,
    });
    getCurrentAccount.mockResolvedValue({
      supabase: { rpc },
      userId: 'preview-user',
      account: { organizationId: 'organization-1' },
    });
  });

  it('normalizes repeated packs and their dependencies before the RPC', async () => {
    const url = new URL('https://desk.example/api/branches/setup-preview');
    url.searchParams.set('legalEntityId', ENTITY_ID);
    url.searchParams.set('startMode', 'copy');
    url.searchParams.set('sourceAccountId', SOURCE_ID);
    url.searchParams.append('pack', 'flows');
    url.searchParams.append('pack', 'flows');

    const response = await GET(new Request(url));

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('preview_organization_branch_setup', {
      p_organization_id: 'organization-1',
      p_legal_entity_id: ENTITY_ID,
      p_start_mode: 'copy',
      p_source_account_id: SOURCE_ID,
      p_packs: ['lead_setup', 'flows'],
    });
  });

  it('uses a dedicated 60-per-minute user bucket', async () => {
    const url = `https://desk.example/api/branches/setup-preview?legalEntityId=${ENTITY_ID}&startMode=blank`;
    for (let index = 0; index < 60; index += 1) {
      expect((await GET(new Request(url))).status).toBe(200);
    }

    const response = await GET(new Request(url));
    expect(response.status).toBe(429);
    expect(response.headers.get('X-RateLimit-Limit')).toBe('60');
  });

  it('maps cross-organization/source permission failures to 403', async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: '42501', message: 'Source branch is unavailable' },
    });
    const url = `https://desk.example/api/branches/setup-preview?legalEntityId=${ENTITY_ID}&startMode=copy&sourceAccountId=${SOURCE_ID}&pack=lead_setup`;

    const response = await GET(new Request(url));

    expect(response.status).toBe(403);
  });
});
