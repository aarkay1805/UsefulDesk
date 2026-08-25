// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TEMPLATE_CONTRACTS } from '@/lib/whatsapp/template-contracts';
import type { InvoicePartySnapshot } from '@/types';

const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
let accountRole: 'owner' | 'admin' | 'agent' | 'viewer' = 'agent';
let documentStatus: 'generating' | 'ready' | 'failed' | null = null;
let whatsappConnected = true;
let templateReady = true;

vi.mock('sonner', () => ({ toast }));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ accountId: 'account-id', accountRole }),
}));
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: (table: string) => {
      const builder = {
        select: () => builder,
        eq: () => builder,
        maybeSingle: () => {
          if (table === 'invoice_documents') {
            return Promise.resolve({
              data: documentStatus ? { status: documentStatus } : null,
              error: null,
            });
          }
          if (table === 'whatsapp_config') {
            return Promise.resolve({
              data: whatsappConnected ? { status: 'connected' } : null,
              error: null,
            });
          }
          if (table === 'message_templates') {
            return Promise.resolve({
              data: templateReady
                ? {
                    ...TEMPLATE_CONTRACTS.invoice_document.payload,
                    status: 'APPROVED',
                    parameter_format: 'POSITIONAL',
                  }
                : null,
              error: null,
            });
          }
          throw new Error(`Unexpected table: ${table}`);
        },
      };
      return builder;
    },
  }),
}));

const { InvoiceDocumentActions } = await import('./invoice-document-actions');

const party: InvoicePartySnapshot = {
  business_name: 'FitZone Gym',
  legal_name: null,
  branch_name: 'Pune',
  address: {
    line1: '1 Gym Road',
    line2: null,
    city: 'Pune',
    state: 'Maharashtra',
    postal_code: '411001',
    country: 'India',
  },
};

function invoice(
  patch: Partial<Parameters<typeof InvoiceDocumentActions>[0]['invoice']> = {}
) {
  return {
    id: '12345678-1234-4234-9234-123456789abc',
    reference: 'INV-000042',
    invoice_number: 'INV-000042',
    state: 'open' as const,
    lifecycle: 'current' as const,
    requires_refund_review: false,
    seller_snapshot: party,
    customer_snapshot: {
      ...party,
      customer_name: 'Asha Rao',
      member_number: '1001',
    },
    ...patch,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function pdfResponse(filename: string): Response {
  return new Response(new Blob(['%PDF-test'], { type: 'application/pdf' }), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}

async function renderReady(
  patch: Partial<Parameters<typeof InvoiceDocumentActions>[0]> = {}
) {
  render(
    <InvoiceDocumentActions
      invoice={invoice()}
      customerPhone="+919999999999"
      {...patch}
    />
  );
  await waitFor(() =>
    expect(
      screen
        .getByRole('button', { name: 'Download invoice' })
        .hasAttribute('disabled')
    ).toBe(false)
  );
}

beforeEach(() => {
  accountRole = 'agent';
  documentStatus = null;
  whatsappConnected = true;
  templateReady = true;
  toast.error.mockReset();
  toast.success.mockReset();
  vi.stubGlobal('fetch', vi.fn());
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: vi.fn(() => 'blob:invoice'),
    revokeObjectURL: vi.fn(),
  });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('InvoiceDocumentActions', () => {
  it('lets a viewer download while role-gating WhatsApp sharing', async () => {
    accountRole = 'viewer';
    const fetchMock = vi
      .mocked(fetch)
      .mockResolvedValue(pdfResponse('invoice-INV-000042.pdf'));
    await renderReady();

    const download = screen.getByRole('button', { name: 'Download invoice' });
    const share = screen.getByRole('button', { name: 'Send on WhatsApp' });
    expect(download.hasAttribute('disabled')).toBe(false);
    expect(share.hasAttribute('disabled')).toBe(true);
    expect(share.closest('span')?.getAttribute('title')).toBe(
      "Read-only — your role can't share invoice documents"
    );

    await userEvent.click(download);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/invoices/12345678-1234-4234-9234-123456789abc/document',
      { cache: 'no-store' }
    );
  });

  it('keeps download and share pending states independent', async () => {
    let resolveDownload!: (response: Response) => void;
    const fetchMock = vi.mocked(fetch).mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveDownload = resolve;
        })
    );
    await renderReady();

    const download = screen.getByRole('button', { name: 'Download invoice' });
    const share = screen.getByRole('button', { name: 'Send on WhatsApp' });
    await userEvent.click(download);

    expect(download.getAttribute('aria-busy')).toBe('true');
    expect(download.hasAttribute('disabled')).toBe(true);
    expect(share.hasAttribute('aria-busy')).toBe(false);
    expect(share.hasAttribute('disabled')).toBe(false);

    await act(async () => resolveDownload(pdfResponse('invoice.pdf')));
    await waitFor(() => expect(download.hasAttribute('disabled')).toBe(false));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('preserves the server attachment filename when downloading', async () => {
    vi.mocked(fetch).mockResolvedValue(
      pdfResponse('branch invoice INV-000042.pdf')
    );
    await renderReady();

    await userEvent.click(
      screen.getByRole('button', { name: 'Download invoice' })
    );

    await waitFor(() =>
      expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled()
    );
    const anchor = Array.from(document.querySelectorAll('a')).at(-1);
    expect(anchor).toBeUndefined();
    const clickTarget = vi.mocked(HTMLAnchorElement.prototype.click).mock
      .contexts[0] as HTMLAnchorElement;
    expect(clickTarget.download).toBe('branch invoice INV-000042.pdf');
    expect(clickTarget.href).toBe('blob:invoice');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:invoice');
  });

  it('hides document actions for upcoming projections', () => {
    render(
      <InvoiceDocumentActions
        invoice={invoice({ lifecycle: 'upcoming' })}
        customerPhone="+919999999999"
      />
    );

    expect(
      screen.queryByRole('button', { name: 'Download invoice' })
    ).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Send on WhatsApp' })
    ).toBeNull();
  });

  it.each([
    [
      'incomplete invoice profile',
      { invoice: invoice({ seller_snapshot: null }) },
      'Finish Invoice details in Settings -> Payments first.',
    ],
    [
      'missing customer phone',
      { customerPhone: null },
      'Add a phone number before sending on WhatsApp.',
    ],
  ])('shows the exact recovery for %s', async (_name, patch, reason) => {
    const props = patch as Partial<
      Parameters<typeof InvoiceDocumentActions>[0]
    >;
    render(
      <InvoiceDocumentActions
        invoice={props.invoice ?? invoice()}
        customerPhone={
          'customerPhone' in props ? props.customerPhone : '+919999999999'
        }
      />
    );

    const share = screen.getByRole('button', { name: 'Send on WhatsApp' });
    await waitFor(() =>
      expect(share.closest('span')?.getAttribute('title')).toBe(reason)
    );
    expect(share.hasAttribute('disabled')).toBe(true);
  });

  it.each([
    [
      'disconnected WhatsApp',
      false,
      true,
      'Connect WhatsApp in Settings before sending.',
    ],
    [
      'unavailable template',
      true,
      false,
      'Approve and sync gym_invoice_document in en_US before sending.',
    ],
  ])(
    'shows the exact recovery for %s',
    async (_name, connected, approved, reason) => {
      whatsappConnected = connected;
      templateReady = approved;
      await renderReady();

      const share = screen.getByRole('button', { name: 'Send on WhatsApp' });
      expect(share.hasAttribute('disabled')).toBe(true);
      expect(share.closest('span')?.getAttribute('title')).toBe(reason);
    }
  );

  it.each([
    [
      'void invoice',
      { state: 'void' as const },
      'Voided invoices cannot generate documents',
    ],
    [
      'refund-review invoice',
      { requires_refund_review: true },
      'Resolve the invoice refund review before generating a document',
    ],
  ])('blocks generation and sharing for a %s', async (_name, patch, reason) => {
    render(
      <InvoiceDocumentActions
        invoice={invoice(patch)}
        customerPhone="+919999999999"
      />
    );
    const download = await screen.findByRole('button', {
      name: 'Download invoice',
    });
    const share = screen.getByRole('button', { name: 'Send on WhatsApp' });
    await waitFor(() => expect(download.hasAttribute('disabled')).toBe(true));
    expect(download.closest('span')?.getAttribute('title')).toBe(reason);
    expect(share.hasAttribute('disabled')).toBe(true);
    expect(share.closest('span')?.getAttribute('title')).toBe(reason);
  });

  it('allows audit download of an already-ready void document', async () => {
    documentStatus = 'ready';
    render(
      <InvoiceDocumentActions
        invoice={invoice({ state: 'void' })}
        customerPhone="+919999999999"
      />
    );

    const download = await screen.findByRole('button', {
      name: 'Download invoice',
    });
    await waitFor(() => expect(download.hasAttribute('disabled')).toBe(false));
    expect(
      screen
        .getByRole('button', { name: 'Send on WhatsApp' })
        .hasAttribute('disabled')
    ).toBe(true);
  });

  it('surfaces API errors through the standard toast path', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ error: 'Invoice document storage is unavailable' }, 503)
    );
    await renderReady();

    await userEvent.click(
      screen.getByRole('button', { name: 'Download invoice' })
    );

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'Invoice document storage is unavailable'
      )
    );
  });

  it('confirms a successful explicit WhatsApp share', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ success: true }));
    await renderReady();

    await userEvent.click(
      screen.getByRole('button', { name: 'Send on WhatsApp' })
    );

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith('Invoice sent on WhatsApp')
    );
    expect(fetch).toHaveBeenCalledWith(
      '/api/invoices/12345678-1234-4234-9234-123456789abc/share',
      { method: 'POST' }
    );
  });
});
