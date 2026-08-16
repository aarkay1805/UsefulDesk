import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  generateReply: vi.fn(),
  loadAiConfig: vi.fn(),
  requireRole: vi.fn(),
}));

vi.mock('@/lib/auth/account', () => ({
  requireRole: h.requireRole,
  toErrorResponse: (error: unknown) =>
    Response.json(
      { error: error instanceof Error ? error.message : 'Request failed' },
      { status: 500 }
    ),
}));

vi.mock('@/lib/ai/generate', () => ({ generateReply: h.generateReply }));
vi.mock('@/lib/ai/config', () => ({ loadAiConfig: h.loadAiConfig }));
vi.mock('@/lib/rate-limit', () => ({
  RATE_LIMITS: { adminAction: {} },
  checkRateLimit: () => ({ success: true }),
  rateLimitResponse: vi.fn(),
}));

import { suggestMemberMigrationRecipe } from '@/lib/memberships/migration-recipe';
import { POST } from './route';

const summary = {
  headers: ['MEMBER NAME', 'CONTACT', 'FEE'],
  rowCount: 2,
  inferredTypes: {
    'MEMBER NAME': 'text',
    CONTACT: 'phone',
    FEE: 'number',
  },
  blankCounts: {
    'MEMBER NAME': 0,
    CONTACT: 0,
    FEE: 0,
  },
  distinctCounts: {
    'MEMBER NAME': 2,
    CONTACT: 2,
    FEE: 2,
  },
  formatStatistics: {
    'MEMBER NAME': { text: 2 },
    CONTACT: { phone: 2 },
    FEE: { number: 2 },
  },
};

function request(body: unknown) {
  return new Request('https://desk.example/api/members/import-analyze', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/members/import-analyze privacy boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.requireRole.mockResolvedValue({
      supabase: {},
      accountId: 'account-1',
      userId: 'user-1',
    });
    h.loadAiConfig.mockResolvedValue({ provider: 'openai' });
    h.generateReply.mockResolvedValue({
      text: JSON.stringify(suggestMemberMigrationRecipe(summary.headers)),
    });
  });

  it.each([
    ['samples', [{ header: 'MEMBER NAME', values: ['Asha Kapoor'] }]],
    ['explanation', 'Asha Kapoor owes 12000 on 9876543210'],
    ['names', ['Asha Kapoor']],
    ['phones', ['9876543210']],
    ['legacyIds', ['LEGACY-7781']],
    ['notes', ['Call after 6pm']],
    ['rawFinancialValues', [12000]],
  ])('rejects %s before any provider request', async (field, value) => {
    const response = await POST(request({ ...summary, [field]: value }));

    expect(response.status).toBe(400);
    expect(h.generateReply).not.toHaveBeenCalled();
  });

  it('sends only aggregate metadata to the provider and keeps the local recipe authoritative', async () => {
    const localRecipe = suggestMemberMigrationRecipe(summary.headers);
    const modelRecipe = {
      ...localRecipe,
      mappings: { ...localRecipe.mappings, plan: 'FEE' },
    };
    h.generateReply.mockResolvedValue({ text: JSON.stringify(modelRecipe) });

    const response = await POST(request(summary));
    const body = await response.json();
    const providerRequest = h.generateReply.mock.calls[0][0];

    expect(response.status).toBe(200);
    expect(JSON.parse(providerRequest.messages[0].content)).toEqual(summary);
    expect(providerRequest.systemPrompt).not.toContain('Asha Kapoor');
    expect(providerRequest.systemPrompt).not.toContain('9876543210');
    expect(providerRequest.systemPrompt).not.toContain('12000');
    expect(providerRequest.messages[0].content).not.toContain('Asha Kapoor');
    expect(providerRequest.messages[0].content).not.toContain('9876543210');
    expect(providerRequest.messages[0].content).not.toContain('12000');
    expect(body.recipe).toEqual(localRecipe);
    expect(body.suggestion.mappings.plan).toBe('FEE');
  });

  it('strips provider-authored prose from an otherwise safe suggestion', async () => {
    const localRecipe = suggestMemberMigrationRecipe(summary.headers);
    h.generateReply.mockResolvedValue({
      text: JSON.stringify({
        ...localRecipe,
        summary: ['Asha Kapoor has a balance of 12000.'],
        warnings: ['Call 9876543210.'],
      }),
    });

    const body = await (await POST(request(summary))).json();

    expect(body.suggestion.summary).toEqual(localRecipe.summary);
    expect(body.suggestion.warnings).toEqual(localRecipe.warnings);
    expect(JSON.stringify(body)).not.toContain('Asha Kapoor');
    expect(JSON.stringify(body)).not.toContain('9876543210');
    expect(JSON.stringify(body)).not.toContain('12000');
  });

  it('returns the local recipe when the provider is unavailable', async () => {
    h.generateReply.mockRejectedValue(new Error('provider unavailable'));

    const response = await POST(request(summary));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      configured: true,
      recipe: suggestMemberMigrationRecipe(summary.headers),
      warning: expect.stringContaining('safe local interpretation'),
    });
  });

  it('returns the local recipe when the provider response is malformed', async () => {
    h.generateReply.mockResolvedValue({ text: 'definitely not JSON' });

    const response = await POST(request(summary));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      configured: true,
      recipe: suggestMemberMigrationRecipe(summary.headers),
      warning: expect.stringContaining('unreadable suggestion'),
    });
  });

  it('rejects a provider suggestion with a non-allowlisted mapping', async () => {
    const localRecipe = suggestMemberMigrationRecipe(summary.headers);
    h.generateReply.mockResolvedValue({
      text: JSON.stringify({
        ...localRecipe,
        mappings: { ...localRecipe.mappings, executeSql: 'FEE' },
      }),
    });

    const response = await POST(request(summary));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      recipe: localRecipe,
      warning: expect.stringContaining('unsafe suggestion'),
    });
    expect(body.suggestion).toBeUndefined();
  });
});
