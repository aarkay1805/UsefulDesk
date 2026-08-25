import { beforeEach, describe, expect, it, vi } from 'vitest';

const { ensureInvoiceDocument, getCurrentAccount } = vi.hoisted(() => ({
  ensureInvoiceDocument: vi.fn(),
  getCurrentAccount: vi.fn(),
}));

vi.mock('@/lib/auth/account', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/account')>();
  return { ...actual, getCurrentAccount };
});
vi.mock('@/lib/finance/invoice-document-service', async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import('@/lib/finance/invoice-document-service')
    >();
  return { ...actual, ensureInvoiceDocument };
});

import { InvoiceDocumentConflictError } from '@/lib/finance/invoice-document-service';
import { GET, runtime } from './route';

const accountId = '11111111-1111-4111-8111-111111111111';
const invoiceId = '22222222-2222-4222-8222-222222222222';
const userId = '33333333-3333-4333-8333-333333333333';
const bytes = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 1, 2, 3]);

function makeInvoiceQuery(invoice: unknown = { id: invoiceId }) {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    maybeSingle: vi.fn(async () => ({ data: invoice, error: null })),
  };
  return query;
}

function request() {
  return new Request(`https://desk.example/api/invoices/${invoiceId}/document`);
}

function context(id = invoiceId) {
  return { params: Promise.resolve({ invoiceId: id }) };
}

describe('GET /api/invoices/[invoiceId]/document', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const query = makeInvoiceQuery();
    getCurrentAccount.mockResolvedValue({
      accountId,
      userId,
      role: 'viewer',
      supabase: { from: vi.fn(() => query) },
    });
    ensureInvoiceDocument.mockResolvedValue({
      documentId: '44444444-4444-4444-8444-444444444444',
      invoiceId,
      invoiceNumber: 'INV-000042',
      storagePath: `account-${accountId}/${invoiceId}/invoice-INV-000042.pdf`,
      sha256: 'a'.repeat(64),
      byteCount: bytes.byteLength,
      bytes,
    });
  });

  it('runs on Node.js and streams a private PDF attachment with the human invoice number', async () => {
    const response = await GET(request(), context());

    expect(runtime).toBe('nodejs');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/pdf');
    expect(response.headers.get('content-disposition')).toContain(
      'invoice-INV-000042.pdf'
    );
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([
      ...bytes,
    ]);
    expect(ensureInvoiceDocument).toHaveBeenCalledWith({
      accountId,
      invoiceId,
      userId,
    });
  });

  it('returns the same generic 404 for malformed, missing, and cross-account invoice identifiers before service-role work', async () => {
    const malformed = await GET(request(), context('not-a-uuid'));
    expect(malformed.status).toBe(404);
    expect(await malformed.json()).toEqual({ error: 'Invoice not found' });
    expect(getCurrentAccount).not.toHaveBeenCalled();
    expect(ensureInvoiceDocument).not.toHaveBeenCalled();

    const query = makeInvoiceQuery(null);
    getCurrentAccount.mockResolvedValue({
      accountId,
      userId,
      role: 'viewer',
      supabase: { from: vi.fn(() => query) },
    });
    const missing = await GET(request(), context());
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: 'Invoice not found' });
    expect(query.eq).toHaveBeenNthCalledWith(1, 'id', invoiceId);
    expect(query.eq).toHaveBeenNthCalledWith(2, 'account_id', accountId);
    expect(ensureInvoiceDocument).not.toHaveBeenCalled();
  });

  it('returns 403 when the named download capability is absent', async () => {
    getCurrentAccount.mockResolvedValue({
      accountId,
      userId,
      role: 'unknown-role',
      supabase: { from: vi.fn() },
    });

    const response = await GET(request(), context());

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: 'Invoice document download is not available for your role',
    });
    expect(ensureInvoiceDocument).not.toHaveBeenCalled();
  });

  it.each([
    'Invoice document generation is already in progress. Please retry shortly.',
    'Finish Invoice details in Settings -> Payments first.',
    'Resolve the invoice refund review before generating a document',
    'Voided invoices cannot generate documents',
  ])('returns an actionable same-tenant 409 conflict: %s', async (message) => {
    ensureInvoiceDocument.mockRejectedValue(
      new InvoiceDocumentConflictError(message)
    );

    const response = await GET(request(), context());

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: message });
  });
});
