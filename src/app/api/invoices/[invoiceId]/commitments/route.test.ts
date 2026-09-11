import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  rpc: vi.fn(),
  role: 'agent' as 'agent' | 'admin',
  userId: 'author-1',
}));

vi.mock('@/lib/auth/account', () => ({
  requireRole: mocks.requireRole,
  toErrorResponse: (error: unknown) => new Response(JSON.stringify({ error: String(error) }), { status: 500 }),
}));
vi.mock('@/lib/auth/csrf', () => ({ requireSameOriginRequest: vi.fn() }));

function builder(table: string) {
  const result = table === 'invoices' ? { id: 'invoice-1' } : { id: 'commitment-1', created_by: 'author-1', invoice_id: 'invoice-1' };
  const chain = {
    select: vi.fn(() => chain), eq: vi.fn(() => chain), order: vi.fn(() => chain),
    maybeSingle: vi.fn(async () => ({ data: result, error: null })),
  };
  return chain;
}

function request(method: 'PATCH' | 'DELETE', body: Record<string, unknown>) {
  return new Request('https://desk.example/api/invoices/invoice-1/commitments', {
    method,
    headers: { 'content-type': 'application/json', origin: 'https://desk.example', 'sec-fetch-site': 'same-origin' },
    body: JSON.stringify(body),
  });
}

import { DELETE, PATCH } from './route';

describe('invoice collection commitment route authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.role = 'agent'; mocks.userId = 'author-1';
    mocks.rpc.mockResolvedValue({ data: { id: 'commitment-1' }, error: null });
    mocks.requireRole.mockImplementation(async () => ({
      role: mocks.role, userId: mocks.userId,
      supabase: { from: (table: string) => builder(table), rpc: mocks.rpc },
    }));
  });

  it('lets only the author resolve an open commitment through the audited RPC', async () => {
    const response = await PATCH(request('PATCH', { id: 'commitment-1', revision: 2, action: 'resolve' }), { params: Promise.resolve({ invoiceId: 'invoice-1' }) });
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith('resolve_invoice_collection_commitment', { p_id: 'commitment-1', p_expected_revision: 2 });
  });

  it('lets an admin cancel another author’s commitment but rejects a different agent', async () => {
    mocks.userId = 'other-agent';
    const denied = await DELETE(request('DELETE', { id: 'commitment-1', revision: 2 }), { params: Promise.resolve({ invoiceId: 'invoice-1' }) });
    expect(denied.status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();

    mocks.role = 'admin';
    const allowed = await DELETE(request('DELETE', { id: 'commitment-1', revision: 2 }), { params: Promise.resolve({ invoiceId: 'invoice-1' }) });
    expect(allowed.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith('cancel_invoice_collection_commitment', { p_id: 'commitment-1', p_expected_revision: 2 });
  });
});
