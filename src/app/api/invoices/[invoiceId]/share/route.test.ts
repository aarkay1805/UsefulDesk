import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  requireOperationalAccess: vi.fn(),
  ensureInvoiceDocument: vi.fn(),
  resolveContactConversation: vi.fn(),
  sendMessageToConversation: vi.fn(),
  createSignedUrl: vi.fn(),
}));

vi.mock('@/lib/auth/account', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/account')>();
  return { ...actual, requireOperationalAccess: h.requireOperationalAccess };
});
vi.mock('@/lib/finance/invoice-document-service', async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import('@/lib/finance/invoice-document-service')
    >();
  return { ...actual, ensureInvoiceDocument: h.ensureInvoiceDocument };
});
vi.mock('@/lib/whatsapp/resolve-contact-conversation', () => ({
  resolveContactConversation: h.resolveContactConversation,
}));
vi.mock('@/lib/whatsapp/send-message', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/whatsapp/send-message')>();
  return { ...actual, sendMessageToConversation: h.sendMessageToConversation };
});
vi.mock('@/lib/flows/admin-client', () => ({
  supabaseAdmin: () => ({
    storage: {
      from: (bucket: string) => {
        if (bucket !== 'invoice-documents') {
          throw new Error(`Unexpected bucket ${bucket}`);
        }
        return { createSignedUrl: h.createSignedUrl };
      },
    },
  }),
}));

import {
  InvoiceDocumentConflictError,
  InvoiceDocumentPreparingError,
} from '@/lib/finance/invoice-document-service';
import { UnauthorizedError } from '@/lib/auth/account';
import { SendMessageError } from '@/lib/whatsapp/send-message';
import { POST } from './route';

const accountId = '11111111-1111-4111-8111-111111111111';
const invoiceId = '2a222222-2b22-4c22-8d22-222222222222';
const contactId = '33333333-3333-4333-8333-333333333333';
const userId = '44444444-4444-4444-8444-444444444444';
const storagePath = `account-${accountId}/${invoiceId}/invoice-INV-000042.pdf`;
const signedUrl = 'https://storage.example/invoice.pdf?token=short-lived';

const exactTemplate = {
  id: '55555555-5555-4555-8555-555555555555',
  account_id: accountId,
  user_id: userId,
  name: 'gym_invoice_document',
  language: 'en_US',
  status: 'APPROVED',
  category: 'Utility',
  parameter_format: 'POSITIONAL',
  header_type: 'document',
  header_content: null,
  body_text:
    'Hi {{1}}, here is invoice {{2}} for {{3}} from {{4}}. Please keep this document for your records and reply if any invoice detail looks incorrect.',
  footer_text: null,
  buttons: [],
  provider_components_sync_required_at: null,
  created_at: '2026-08-24T00:00:00.000Z',
};

const payload = {
  format_version: 1 as const,
  invoice_number: 'INV-000042',
  issued_at: '2026-08-24',
  currency: 'INR',
  seller: {
    business_name: 'FitZone Gym',
    legal_name: null,
    branch_name: null,
    phone: null,
    email: null,
    address: {
      line1: '1 Fitness Road',
      line2: null,
      city: 'Mumbai',
      state: null,
      postal_code: null,
      country: 'India',
    },
  },
  customer: {
    customer_name: 'Asha',
    member_number: null,
    phone: '+919999999999',
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
      period: null,
      quantity: 1,
      unit_amount_minor: 250000,
      amount_minor: 250000,
    },
  ],
  subtotal_minor: 250000,
  adjustments_minor: 0,
  total_minor: 250000,
};

interface Rows {
  invoice_balances: unknown;
  contacts: unknown;
  whatsapp_config: unknown;
  message_templates: unknown;
  accounts: unknown;
  invoice_documents: unknown;
}

function makeDb(overrides: Partial<Rows> = {}) {
  const rows: Rows = {
    invoice_balances: {
      id: invoiceId,
      contact_id: contactId,
      state: 'open',
      requires_refund_review: false,
    },
    contacts: { id: contactId, phone: '+919999999999' },
    whatsapp_config: { id: 'config-1', status: 'connected' },
    message_templates: exactTemplate,
    accounts: {
      id: accountId,
      country_code: 'IN',
      locale: 'en-IN',
      default_currency: 'INR',
      timezone: 'Asia/Kolkata',
      date_order: 'DMY',
      time_format: '12h',
      week_start: 1,
      phone_country_code: '+91',
      measurement_system: 'metric',
    },
    invoice_documents: { payload_snapshot: payload },
    ...overrides,
  };
  const eqCalls: Array<{ table: string; column: string; value: unknown }> = [];
  const from = vi.fn((table: keyof Rows) => {
    const builder = {
      select: vi.fn(() => builder),
      eq: vi.fn((column: string, value: unknown) => {
        eqCalls.push({ table, column, value });
        return builder;
      }),
      maybeSingle: vi.fn(async () => ({ data: rows[table], error: null })),
    };
    return builder;
  });
  return { db: { from }, from, eqCalls };
}

function context(id = invoiceId) {
  return { params: Promise.resolve({ invoiceId: id }) };
}

function request() {
  return new Request(`https://desk.example/api/invoices/${invoiceId}/share`, {
    method: 'POST',
  });
}

function setContext(role: 'viewer' | 'agent' | 'admin' | 'owner' = 'agent') {
  const { db, from, eqCalls } = makeDb();
  h.requireOperationalAccess.mockResolvedValue({
    accountId,
    userId,
    role,
    supabase: db,
  });
  return { db, from, eqCalls };
}

describe('POST /api/invoices/[invoiceId]/share', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setContext();
    h.ensureInvoiceDocument.mockResolvedValue({
      documentId: '66666666-6666-4666-8666-666666666666',
      invoiceId,
      invoiceNumber: 'INV-000042',
      storagePath,
      sha256: 'a'.repeat(64),
      byteCount: 42,
      bytes: Uint8Array.from([1]),
    });
    h.createSignedUrl.mockResolvedValue({
      data: { signedUrl },
      error: null,
    });
    h.resolveContactConversation.mockResolvedValue('conversation-1');
    h.sendMessageToConversation.mockResolvedValue({
      messageId: 'message-1',
      whatsappMessageId: 'wamid.1',
    });
  });

  it('returns 401 before any invoice or service-role work when unauthenticated', async () => {
    h.requireOperationalAccess.mockRejectedValue(new UnauthorizedError());

    const response = await POST(request(), context());

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Unauthorized' });
    expect(h.ensureInvoiceDocument).not.toHaveBeenCalled();
    expect(h.createSignedUrl).not.toHaveBeenCalled();
  });

  it('requires the named share capability even when account context resolves', async () => {
    setContext('viewer');

    const response = await POST(request(), context());

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: 'Invoice document sharing is not available for your role',
    });
    expect(h.ensureInvoiceDocument).not.toHaveBeenCalled();
    expect(h.createSignedUrl).not.toHaveBeenCalled();
  });

  it('collapses malformed, missing, and cross-tenant invoices to one generic 404 before service work', async () => {
    const malformed = await POST(request(), context('not-an-invoice-id'));
    expect(malformed.status).toBe(404);
    expect(await malformed.json()).toEqual({ error: 'Invoice not found' });
    expect(h.ensureInvoiceDocument).not.toHaveBeenCalled();

    const { db, eqCalls } = makeDb({ invoice_balances: null });
    h.requireOperationalAccess.mockResolvedValue({
      accountId,
      userId,
      role: 'agent',
      supabase: db,
    });
    const missing = await POST(request(), context());
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: 'Invoice not found' });
    expect(eqCalls.slice(0, 2)).toEqual([
      { table: 'invoice_balances', column: 'id', value: invoiceId },
      { table: 'invoice_balances', column: 'account_id', value: accountId },
    ]);
    expect(h.ensureInvoiceDocument).not.toHaveBeenCalled();
    expect(h.createSignedUrl).not.toHaveBeenCalled();
  });

  it('enforces phone, connection, and exact template readiness in that order', async () => {
    const missingPhone = makeDb({
      contacts: { id: contactId, phone: null },
      whatsapp_config: null,
      message_templates: null,
    });
    h.requireOperationalAccess.mockResolvedValue({
      accountId,
      userId,
      role: 'agent',
      supabase: missingPhone.db,
    });
    let response = await POST(request(), context());
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: 'Add a phone number before sending on WhatsApp.',
    });
    expect(missingPhone.from).not.toHaveBeenCalledWith('whatsapp_config');

    const disconnected = makeDb({
      whatsapp_config: { id: 'config-1', status: 'disconnected' },
      message_templates: null,
    });
    h.requireOperationalAccess.mockResolvedValue({
      accountId,
      userId,
      role: 'agent',
      supabase: disconnected.db,
    });
    response = await POST(request(), context());
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: 'Connect WhatsApp in Settings before sending.',
    });
    expect(disconnected.from).not.toHaveBeenCalledWith('message_templates');

    for (const template of [
      null,
      { ...exactTemplate, status: 'PENDING' },
      { ...exactTemplate, body_text: 'Hi {{1}}, drifted.' },
    ]) {
      const unavailable = makeDb({ message_templates: template });
      h.requireOperationalAccess.mockResolvedValue({
        accountId,
        userId,
        role: 'agent',
        supabase: unavailable.db,
      });
      response = await POST(request(), context());
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({
        error: 'Approve and sync gym_invoice_document in en_US before sending.',
      });
      expect(h.ensureInvoiceDocument).not.toHaveBeenCalled();
    }
  });

  it.each([
    'Finish Invoice details in Settings -> Payments first.',
    'Voided invoices cannot generate documents',
    'Resolve the invoice refund review before generating a document',
  ])(
    'maps an ineligible invoice conflict without signing or sending: %s',
    async (message) => {
      h.ensureInvoiceDocument.mockRejectedValue(
        new InvoiceDocumentConflictError(message)
      );

      const response = await POST(request(), context());

      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ error: message });
      expect(h.createSignedUrl).not.toHaveBeenCalled();
      expect(h.sendMessageToConversation).not.toHaveBeenCalled();
    }
  );

  it.each([
    [
      { state: 'void', requires_refund_review: false },
      'Voided invoices cannot generate documents',
    ],
    [
      { state: 'open', requires_refund_review: true },
      'Resolve the invoice refund review before generating a document',
    ],
  ] as const)(
    'blocks an existing ready artifact when the current invoice state is ineligible',
    async (invoiceState, message) => {
      const { db } = makeDb({
        invoice_balances: {
          id: invoiceId,
          contact_id: contactId,
          ...invoiceState,
        },
      });
      h.requireOperationalAccess.mockResolvedValue({
        accountId,
        userId,
        role: 'agent',
        supabase: db,
      });

      const response = await POST(request(), context());

      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ error: message });
      expect(h.ensureInvoiceDocument).not.toHaveBeenCalled();
      expect(h.createSignedUrl).not.toHaveBeenCalled();
      expect(h.sendMessageToConversation).not.toHaveBeenCalled();
    }
  );

  it('returns a retryable 409 for a live generation lease', async () => {
    h.ensureInvoiceDocument.mockRejectedValue(
      new InvoiceDocumentPreparingError()
    );

    const response = await POST(request(), context());

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error:
        'Invoice document generation is already in progress. Please retry shortly.',
    });
    expect(h.createSignedUrl).not.toHaveBeenCalled();
  });

  it('fails closed when Storage cannot create the short-lived provider URL', async () => {
    h.createSignedUrl.mockResolvedValue({
      data: null,
      error: { message: 'Storage unavailable' },
    });

    const response = await POST(request(), context());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Internal server error' });
    expect(h.resolveContactConversation).not.toHaveBeenCalled();
    expect(h.sendMessageToConversation).not.toHaveBeenCalled();
  });

  it('preserves the existing send-core error response and performs no direct provider call', async () => {
    h.sendMessageToConversation.mockRejectedValue(
      new SendMessageError('provider_error', 'Meta rejected the send', 502)
    );

    const response = await POST(request(), context());

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: 'Meta rejected the send' });
    expect(h.sendMessageToConversation).toHaveBeenCalledTimes(1);
  });

  it.each(['agent', 'admin', 'owner'] as const)(
    'shares the immutable document for an authorized %s',
    async (role) => {
      const { db } = setContext(role);

      const response = await POST(request(), context());

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        success: true,
        message_id: 'message-1',
        whatsapp_message_id: 'wamid.1',
      });
      expect(h.ensureInvoiceDocument).toHaveBeenCalledWith({
        accountId,
        invoiceId,
        userId,
      });
      expect(h.createSignedUrl).toHaveBeenCalledWith(storagePath, 300);
      expect(h.resolveContactConversation).toHaveBeenCalledWith(
        db,
        accountId,
        userId,
        contactId
      );
      expect(h.sendMessageToConversation).toHaveBeenCalledWith(db, accountId, {
        conversationId: 'conversation-1',
        messageType: 'template',
        templateName: 'gym_invoice_document',
        templateLanguage: 'en_US',
        templateMessageParams: {
          headerMediaUrl: signedUrl,
          body: ['Asha', 'INV-000042', '₹2,500.00', 'FitZone Gym'],
        },
        persistedMediaUrl: `/api/invoices/${invoiceId}/document`,
      });
    }
  );
});
