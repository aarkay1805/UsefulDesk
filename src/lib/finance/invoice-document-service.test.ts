import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createInvoiceDocumentService,
  InvoiceDocumentIntegrityError,
  InvoiceDocumentPreparingError,
  type InvoiceDocumentServiceDependencies,
} from './invoice-document-service';

const accountId = '11111111-1111-4111-8111-111111111111';
const invoiceId = '22222222-2222-4222-8222-222222222222';
const userId = '33333333-3333-4333-8333-333333333333';
const documentId = '44444444-4444-4444-8444-444444444444';
const generationToken = '55555555-5555-4555-8555-555555555555';
const storagePath = `account-${accountId}/${invoiceId}/invoice-INV-000042.pdf`;

const payload = {
  format_version: 1,
  invoice_number: 'INV-000042',
  issued_at: '2026-08-24',
  currency: 'INR',
  seller: {
    business_name: 'Useful Fitness',
    legal_name: null,
    branch_name: 'Indiranagar',
    phone: null,
    email: null,
    address: {
      line1: '12 Main Road',
      line2: null,
      city: 'Bengaluru',
      state: 'Karnataka',
      postal_code: '560038',
      country: 'India',
    },
  },
  customer: {
    customer_name: 'Ananya Deshmukh',
    member_number: 'MEM-42',
    phone: null,
    email: null,
    address: {
      line1: null,
      line2: null,
      city: null,
      state: null,
      postal_code: null,
      country: null,
    },
  },
  lines: [
    {
      description: 'Annual membership',
      period: '2026-08-24 to 2027-08-23',
      quantity: 1,
      unit_amount_minor: 120000,
      amount_minor: 120000,
    },
  ],
  subtotal_minor: 120000,
  adjustments_minor: -1000,
  total_minor: 119000,
} as const;

const bytes = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, 1, 2, 3]);
const checksum = createHash('sha256').update(bytes).digest('hex');

function reservation(
  outcome: 'ready' | 'generating' | 'claimed',
  overrides: Record<string, unknown> = {}
) {
  return {
    outcome,
    document_id: documentId,
    document_status: outcome === 'ready' ? 'ready' : 'generating',
    generation_token: generationToken,
    payload_snapshot: payload,
    storage_path: storagePath,
    sha256: outcome === 'ready' ? checksum : null,
    byte_count: outcome === 'ready' ? bytes.byteLength : null,
    last_error: null,
    ...overrides,
  };
}

function readyDocumentRow() {
  return {
    id: documentId,
    account_id: accountId,
    invoice_id: invoiceId,
    status: 'ready',
    payload_snapshot: payload,
    storage_path: storagePath,
    sha256: checksum,
    byte_count: bytes.byteLength,
    format_version: 1,
    generation_token: generationToken,
    generation_expires_at: '2026-08-24T12:05:00.000Z',
    generated_at: '2026-08-24T12:00:00.000Z',
    generated_by: userId,
    last_error: null,
    created_at: '2026-08-24T12:00:00.000Z',
    updated_at: '2026-08-24T12:00:00.000Z',
  };
}

function failedDocumentRow(error = 'render failed') {
  return {
    ...readyDocumentRow(),
    status: 'failed',
    sha256: null,
    byte_count: null,
    generated_at: null,
    last_error: error,
  };
}

function makeDependencies(): InvoiceDocumentServiceDependencies {
  return {
    reserve: vi.fn(async () => ({
      data: [reservation('claimed')],
      error: null,
    })),
    finalize: vi.fn(async () => ({ data: [readyDocumentRow()], error: null })),
    fail: vi.fn(async ({ error }) => ({
      data: [failedDocumentRow(error)],
      error: null,
    })),
    download: vi.fn(async () => ({ data: bytes, error: null })),
    upload: vi.fn(async () => ({ data: { path: storagePath }, error: null })),
    remove: vi.fn(async () => ({ data: [], error: null })),
    render: vi.fn(async () => Buffer.from(bytes)),
    hash: vi.fn(async (value) =>
      createHash('sha256').update(value).digest('hex')
    ),
  };
}

describe('invoice document service', () => {
  let dependencies: InvoiceDocumentServiceDependencies;

  beforeEach(() => {
    dependencies = makeDependencies();
  });

  it('downloads and integrity-checks an existing ready artifact without rendering or uploading', async () => {
    vi.mocked(dependencies.reserve).mockResolvedValue({
      data: [reservation('ready')],
      error: null,
    });

    const result = await createInvoiceDocumentService(dependencies).ensure({
      accountId,
      invoiceId,
      userId,
    });

    expect([...result.bytes]).toEqual([...bytes]);
    expect(result).toMatchObject({
      documentId,
      invoiceId,
      invoiceNumber: 'INV-000042',
      storagePath,
      sha256: checksum,
      byteCount: bytes.byteLength,
    });
    expect(dependencies.render).not.toHaveBeenCalled();
    expect(dependencies.upload).not.toHaveBeenCalled();
    expect(dependencies.finalize).not.toHaveBeenCalled();
  });

  it('validates, renders, hashes, uploads once, and finalizes a claimed lease with the same token', async () => {
    const result = await createInvoiceDocumentService(dependencies).ensure({
      accountId,
      invoiceId,
      userId,
    });

    expect(result.sha256).toBe(checksum);
    expect(result.byteCount).toBe(bytes.byteLength);
    expect(dependencies.render).toHaveBeenCalledOnce();
    expect(dependencies.upload).toHaveBeenCalledWith(storagePath, bytes, {
      contentType: 'application/pdf',
      upsert: false,
    });
    expect(dependencies.finalize).toHaveBeenCalledWith({
      invoiceId,
      generationToken,
      sha256: checksum,
      byteCount: bytes.byteLength,
    });
    expect(dependencies.remove).not.toHaveBeenCalled();
    expect(dependencies.fail).not.toHaveBeenCalled();
  });

  it('returns a retryable preparation error for a live generating lease', async () => {
    vi.mocked(dependencies.reserve).mockResolvedValue({
      data: [reservation('generating')],
      error: null,
    });

    const error = await createInvoiceDocumentService(dependencies)
      .ensure({ accountId, invoiceId, userId })
      .catch((caught) => caught);

    expect(error).toBeInstanceOf(InvoiceDocumentPreparingError);
    expect(error).toMatchObject({ retryable: true });
    expect(dependencies.download).not.toHaveBeenCalled();
    expect(dependencies.render).not.toHaveBeenCalled();
  });

  it('fails loudly without regeneration when ready metadata points to a missing object', async () => {
    vi.mocked(dependencies.reserve).mockResolvedValue({
      data: [reservation('ready')],
      error: null,
    });
    vi.mocked(dependencies.download).mockResolvedValue({
      data: null,
      error: { message: 'Object not found' },
    });

    await expect(
      createInvoiceDocumentService(dependencies).ensure({
        accountId,
        invoiceId,
        userId,
      })
    ).rejects.toBeInstanceOf(InvoiceDocumentIntegrityError);
    expect(dependencies.render).not.toHaveBeenCalled();
    expect(dependencies.upload).not.toHaveBeenCalled();
    expect(dependencies.fail).not.toHaveBeenCalled();
  });

  it('removes only its successfully uploaded path and records a bounded token-bound failure when finalize fails', async () => {
    const longMessage = `finalize rejected ${'x'.repeat(900)}`;
    vi.mocked(dependencies.finalize).mockRejectedValue(new Error(longMessage));

    await expect(
      createInvoiceDocumentService(dependencies).ensure({
        accountId,
        invoiceId,
        userId,
      })
    ).rejects.toThrow(longMessage);

    expect(dependencies.remove).toHaveBeenCalledWith([storagePath]);
    expect(dependencies.fail).toHaveBeenCalledOnce();
    const failure = vi.mocked(dependencies.fail).mock.calls[0]?.[0];
    expect(failure).toMatchObject({ invoiceId, generationToken });
    expect(Array.from(failure?.error ?? '')).toHaveLength(500);
    expect(failure?.error).toContain('finalize rejected');
  });

  it('rejects a zero-row finalize result, token-fails the lease, and cleans its confirmed upload', async () => {
    vi.mocked(dependencies.finalize).mockResolvedValue({
      data: [],
      error: null,
    });

    await expect(
      createInvoiceDocumentService(dependencies).ensure({
        accountId,
        invoiceId,
        userId,
      })
    ).rejects.toThrow(/finalization.*zero-or-multiple-row/i);

    expect(dependencies.fail).toHaveBeenCalledWith(
      expect.objectContaining({ invoiceId, generationToken })
    );
    expect(dependencies.remove).toHaveBeenCalledWith([storagePath]);
  });

  it('does not remove an uncertain object after upload itself reports failure', async () => {
    vi.mocked(dependencies.upload).mockResolvedValue({
      data: null,
      error: { message: 'The resource already exists' },
    });

    await expect(
      createInvoiceDocumentService(dependencies).ensure({
        accountId,
        invoiceId,
        userId,
      })
    ).rejects.toThrow('The resource already exists');

    expect(dependencies.remove).not.toHaveBeenCalled();
    expect(dependencies.fail).toHaveBeenCalledWith(
      expect.objectContaining({ invoiceId, generationToken })
    );
  });

  it('token-fails a claimed lease whose database-authored payload is malformed', async () => {
    vi.mocked(dependencies.reserve).mockResolvedValue({
      data: [
        reservation('claimed', {
          payload_snapshot: { ...payload, lines: [] },
        }),
      ],
      error: null,
    });

    await expect(
      createInvoiceDocumentService(dependencies).ensure({
        accountId,
        invoiceId,
        userId,
      })
    ).rejects.toThrow(/lines must be a non-empty array/i);

    expect(dependencies.fail).toHaveBeenCalledWith(
      expect.objectContaining({ invoiceId, generationToken })
    );
    expect(dependencies.render).not.toHaveBeenCalled();
    expect(dependencies.upload).not.toHaveBeenCalled();
  });

  it.each([
    { data: null, error: null },
    { data: [], error: null },
    { data: [{ outcome: 'ready' }], error: null },
  ])('rejects malformed or zero-row reservation result %#', async (result) => {
    vi.mocked(dependencies.reserve).mockResolvedValue(result);

    await expect(
      createInvoiceDocumentService(dependencies).ensure({
        accountId,
        invoiceId,
        userId,
      })
    ).rejects.toThrow(/reservation.*result/i);
    expect(dependencies.render).not.toHaveBeenCalled();
  });

  it('treats a zero-row token-bound fail result as an orchestration error', async () => {
    vi.mocked(dependencies.render).mockRejectedValue(
      new Error('render failed')
    );
    vi.mocked(dependencies.fail).mockResolvedValue({ data: [], error: null });

    await expect(
      createInvoiceDocumentService(dependencies).ensure({
        accountId,
        invoiceId,
        userId,
      })
    ).rejects.toThrow(/record document generation failure/i);
    expect(dependencies.remove).not.toHaveBeenCalled();
  });
});
