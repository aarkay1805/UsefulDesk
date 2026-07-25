import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requireOperationalAccess, supabaseAdmin } = vi.hoisted(() => ({
  requireOperationalAccess: vi.fn(),
  supabaseAdmin: vi.fn(),
}));

vi.mock('@/lib/auth/account', () => ({
  requireOperationalAccess,
  toErrorResponse: (err: { status?: number; message?: string }) =>
    Response.json(
      { error: err.message ?? 'Internal server error' },
      { status: err.status ?? 500 }
    ),
}));

vi.mock('@/lib/automations/admin-client', () => ({ supabaseAdmin }));

import { POST } from './route';

const original = {
  id: 'automation-1',
  account_id: 'acct-old',
  user_id: 'former-user',
  name: 'Renewals',
  description: null,
  trigger_type: 'manual',
  trigger_config: {},
};

function makeAdmin() {
  const inserts: Record<string, unknown>[] = [];

  function from(table: string) {
    const filters = new Map<string, unknown>();
    let insertPayload: Record<string, unknown> | null = null;

    const result = () => {
      if (table === 'automations' && insertPayload) {
        return {
          data: { id: 'automation-copy', ...insertPayload },
          error: null,
        };
      }
      if (table === 'automations') {
        const visible =
          filters.get('id') === original.id &&
          filters.get('account_id') === original.account_id;
        return { data: visible ? original : null, error: null };
      }
      if (table === 'automation_steps') {
        return { data: [], error: null };
      }
      return { data: null, error: null };
    };

    const builder: Record<string, unknown> = {};
    const chain = () => builder;
    builder.select = vi.fn(chain);
    builder.eq = vi.fn((column: string, value: unknown) => {
      filters.set(column, value);
      return builder;
    });
    builder.order = vi.fn(chain);
    builder.insert = vi.fn((payload: Record<string, unknown>) => {
      insertPayload = payload;
      inserts.push(payload);
      return builder;
    });
    builder.single = vi.fn(async () => result());
    builder.maybeSingle = vi.fn(async () => result());
    builder.then = (resolve: (value: unknown) => unknown) => resolve(result());
    return builder;
  }

  return { client: { from }, inserts };
}

function duplicate() {
  return POST(new Request('http://localhost'), {
    params: Promise.resolve({ id: original.id }),
  });
}

describe('POST /api/automations/[id]/duplicate tenancy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not let a former author access an old-tenant automation', async () => {
    const admin = makeAdmin();
    supabaseAdmin.mockReturnValue(admin.client);
    requireOperationalAccess.mockResolvedValue({
      accountId: 'acct-new',
      userId: 'former-user',
      role: 'owner',
    });

    const response = await duplicate();

    expect(response.status).toBe(404);
    expect(admin.inserts).toHaveLength(0);
  });

  it('lets an authorized current-tenant agent create the copy', async () => {
    const admin = makeAdmin();
    supabaseAdmin.mockReturnValue(admin.client);
    requireOperationalAccess.mockResolvedValue({
      accountId: 'acct-old',
      userId: 'agent-2',
      role: 'agent',
    });

    const response = await duplicate();

    expect(response.status).toBe(201);
    expect(admin.inserts).toEqual([
      expect.objectContaining({
        account_id: 'acct-old',
        user_id: 'agent-2',
        name: 'Renewals (Copy)',
      }),
    ]);
  });
});
