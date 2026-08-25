// @vitest-environment jsdom

import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TEMPLATE_CONTRACTS } from '@/lib/whatsapp/template-contracts';
import type { InvoicePartySnapshot } from '@/types';

const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
const navigation = vi.hoisted(() => ({ pathname: '/invoices', push: vi.fn() }));
let accountRole: 'owner' | 'admin' | 'agent' | 'viewer' = 'agent';
let documentStatus: 'generating' | 'ready' | 'failed' | null = null;
let whatsappConnected = true;
let templateReady = true;
let queriedTables: string[] = [];
let deferReadiness = false;
let readinessResolvers: Array<() => void> = [];

vi.mock('sonner', () => ({ toast }));
vi.mock('next/navigation', () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({ push: navigation.push }),
}));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ accountId: 'account-id', accountRole }),
}));
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: (table: string) => {
      queriedTables.push(table);
      const builder = {
        select: () => builder,
        eq: () => builder,
        maybeSingle: () => {
          let result;
          if (table === 'invoice_documents') {
            result = {
              data: documentStatus ? { status: documentStatus } : null,
              error: null,
            };
          } else if (table === 'whatsapp_config') {
            result = {
              data: whatsappConnected ? { status: 'connected' } : null,
              error: null,
            };
          } else if (table === 'message_templates') {
            result = {
              data: templateReady
                ? {
                    ...TEMPLATE_CONTRACTS.invoice_document.payload,
                    status: 'APPROVED',
                    parameter_format: 'POSITIONAL',
                  }
                : null,
              error: null,
            };
          } else {
            throw new Error(`Unexpected table: ${table}`);
          }
          if (!deferReadiness) return Promise.resolve(result);
          return new Promise((resolve) => {
            readinessResolvers.push(() => resolve(result));
          });
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
  return new Response('%PDF-test', {
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

async function settleReadiness() {
  await waitFor(() => expect(readinessResolvers).toHaveLength(3));
  const resolvers = readinessResolvers.splice(0);
  await act(async () => {
    resolvers.forEach((resolve) => resolve());
  });
}

beforeEach(() => {
  accountRole = 'agent';
  documentStatus = null;
  whatsappConnected = true;
  templateReady = true;
  queriedTables = [];
  deferReadiness = false;
  readinessResolvers = [];
  toast.error.mockReset();
  toast.success.mockReset();
  navigation.push.mockReset();
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
    expect(share.getAttribute('aria-disabled')).toBe('true');

    await userEvent.click(share);
    const blocker = screen.getByRole('dialog', {
      name: 'Admin access required',
    });
    expect(within(blocker).queryByRole('button')).toBeNull();
    expect(within(blocker).queryByRole('link')).toBeNull();

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

  it('loads and shows actions for a persisted numbered future invoice', async () => {
    render(
      <InvoiceDocumentActions
        invoice={invoice({ lifecycle: 'upcoming' })}
        customerPhone="+919999999999"
      />
    );

    const download = screen.getByRole('button', { name: 'Download invoice' });
    const share = screen.getByRole('button', { name: 'Send on WhatsApp' });
    await waitFor(() => expect(share.hasAttribute('disabled')).toBe(false));
    expect(download.hasAttribute('disabled')).toBe(false);
    expect(queriedTables).toEqual([
      'invoice_documents',
      'whatsapp_config',
      'message_templates',
    ]);
  });

  it('keeps a synthetic upcoming projection numberless and actionless', async () => {
    render(
      <InvoiceDocumentActions
        invoice={invoice({
          id: 'upcoming:membership-1',
          reference: 'Upcoming renewal',
          invoice_number: null,
          lifecycle: 'upcoming',
        })}
        customerPhone="+919999999999"
      />
    );

    await act(async () => undefined);

    expect(
      screen.queryByRole('button', { name: 'Download invoice' })
    ).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Send on WhatsApp' })
    ).toBeNull();
    expect(queriedTables).toEqual([]);
  });

  it('does not promise invoice-profile setup to a viewer', async () => {
    accountRole = 'viewer';
    render(
      <InvoiceDocumentActions
        invoice={invoice({ seller_snapshot: null })}
        customerPhone="+919999999999"
      />
    );

    await waitFor(() =>
      expect(
        screen
          .getByRole('button', { name: 'Download invoice' })
          .getAttribute('aria-disabled')
      ).toBe('true')
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'Download invoice' })
    );

    const blocker = screen.getByRole('dialog', {
      name: 'Invoice setup required',
    });
    expect(within(blocker).queryByRole('button')).toBeNull();
    expect(within(blocker).queryByRole('link')).toBeNull();
  });

  it('links an incomplete invoice profile to payment settings for an admin', async () => {
    accountRole = 'admin';
    render(
      <InvoiceDocumentActions
        invoice={invoice({ seller_snapshot: null })}
        customerPhone="+919999999999"
      />
    );

    await waitFor(() =>
      expect(
        screen
          .getByRole('button', { name: 'Download invoice' })
          .getAttribute('aria-disabled')
      ).toBe('true')
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'Download invoice' })
    );

    const resolution = screen.getByRole('button', {
      name: 'Finish invoice setup',
    });
    expect(resolution.tagName).toBe('A');
    expect(resolution.getAttribute('href')).toBe('/settings?tab=payments');
  });

  it('explains a missing phone without offering a settings CTA', async () => {
    render(<InvoiceDocumentActions invoice={invoice()} customerPhone={null} />);

    await waitFor(() =>
      expect(
        screen
          .getByRole('button', { name: 'Send on WhatsApp' })
          .getAttribute('aria-disabled')
      ).toBe('true')
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'Send on WhatsApp' })
    );

    const blocker = screen.getByRole('dialog', {
      name: 'Phone number required',
    });
    expect(within(blocker).queryByRole('button')).toBeNull();
    expect(within(blocker).queryByRole('link')).toBeNull();
  });

  it.each([
    [
      'disconnected WhatsApp',
      false,
      true,
      'Connect WhatsApp',
      '/settings?tab=whatsapp',
    ],
    [
      'unavailable template',
      true,
      false,
      'Open template setup',
      '/settings?tab=templates',
    ],
  ])(
    'links %s to its existing settings tab',
    async (_name, connected, approved, label, href) => {
      accountRole = 'admin';
      whatsappConnected = connected;
      templateReady = approved;
      await renderReady();

      const share = screen.getByRole('button', { name: 'Send on WhatsApp' });
      expect(share.getAttribute('aria-disabled')).toBe('true');
      await userEvent.click(share);
      const resolution = screen.getByRole('button', { name: label });
      expect(resolution.tagName).toBe('A');
      expect(resolution.getAttribute('href')).toBe(href);
    }
  );

  it('keeps unresolved readiness inert, then enables ready actions', async () => {
    deferReadiness = true;
    const fetchMock = vi
      .mocked(fetch)
      .mockResolvedValue(pdfResponse('invoice-INV-000042.pdf'));
    render(
      <InvoiceDocumentActions
        invoice={invoice()}
        customerPhone="+919999999999"
      />
    );

    const download = screen.getByRole('button', { name: 'Download invoice' });
    const share = screen.getByRole('button', { name: 'Send on WhatsApp' });
    expect(download.hasAttribute('disabled')).toBe(true);
    expect(download.getAttribute('aria-busy')).toBe('true');
    expect(share.hasAttribute('disabled')).toBe(true);
    expect(share.getAttribute('aria-busy')).toBe('true');

    await userEvent.click(download);
    await userEvent.click(share);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();

    await settleReadiness();
    await waitFor(() => expect(download.hasAttribute('disabled')).toBe(false));
    expect(share.hasAttribute('disabled')).toBe(false);
    expect(download.getAttribute('aria-busy')).toBeNull();

    await userEvent.click(download);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/invoices/12345678-1234-4234-9234-123456789abc/document',
      { cache: 'no-store' }
    );
  });

  it.each([
    [false, true, "WhatsApp isn't connected"],
    [true, false, "Invoice template isn't ready"],
  ])(
    'keeps unresolved readiness inert, then exposes the settled blocker without an agent CTA',
    async (connected, approved, title) => {
      deferReadiness = true;
      whatsappConnected = connected;
      templateReady = approved;
      render(
        <InvoiceDocumentActions
          invoice={invoice()}
          customerPhone="+919999999999"
        />
      );

      const share = screen.getByRole('button', { name: 'Send on WhatsApp' });
      expect(share.hasAttribute('disabled')).toBe(true);
      await userEvent.click(share);
      expect(screen.queryByRole('dialog')).toBeNull();

      await settleReadiness();
      await waitFor(() =>
        expect(
          screen
            .getByRole('button', { name: 'Send on WhatsApp' })
            .getAttribute('aria-disabled')
        ).toBe('true')
      );
      await userEvent.click(
        screen.getByRole('button', { name: 'Send on WhatsApp' })
      );

      const blocker = screen.getByRole('dialog', { name: title });
      expect(within(blocker).queryByRole('button')).toBeNull();
      expect(within(blocker).queryByRole('link')).toBeNull();
    }
  );

  it('does not reuse settled readiness after the invoice identity changes', async () => {
    const fetchMock = vi
      .mocked(fetch)
      .mockResolvedValue(pdfResponse('invoice.pdf'));
    const view = render(
      <InvoiceDocumentActions
        invoice={invoice()}
        customerPhone="+919999999999"
      />
    );
    await waitFor(() =>
      expect(
        screen
          .getByRole('button', { name: 'Download invoice' })
          .hasAttribute('disabled')
      ).toBe(false)
    );

    deferReadiness = true;
    whatsappConnected = false;
    view.rerender(
      <InvoiceDocumentActions
        invoice={invoice({ id: '87654321-4321-4321-8321-cba987654321' })}
        customerPhone="+919999999999"
      />
    );

    const download = screen.getByRole('button', { name: 'Download invoice' });
    const share = screen.getByRole('button', { name: 'Send on WhatsApp' });
    expect(download.hasAttribute('disabled')).toBe(true);
    expect(download.getAttribute('aria-busy')).toBe('true');
    expect(share.hasAttribute('disabled')).toBe(true);
    await userEvent.click(download);
    expect(fetchMock).not.toHaveBeenCalled();

    await settleReadiness();
    await waitFor(() =>
      expect(
        screen
          .getByRole('button', { name: 'Send on WhatsApp' })
          .getAttribute('aria-disabled')
      ).toBe('true')
    );
    expect(
      screen
        .getByRole('button', { name: 'Download invoice' })
        .hasAttribute('disabled')
    ).toBe(false);
  });

  it('keeps document generation natively disabled without a blocker popover', async () => {
    deferReadiness = true;
    documentStatus = 'generating';
    render(
      <InvoiceDocumentActions
        invoice={invoice()}
        customerPhone="+919999999999"
      />
    );

    const download = screen.getByRole('button', { name: 'Download invoice' });
    expect(download.getAttribute('aria-busy')).toBe('true');
    await settleReadiness();
    await waitFor(() => {
      expect(
        screen
          .getByRole('button', { name: 'Download invoice' })
          .hasAttribute('disabled')
      ).toBe(true);
      expect(
        screen
          .getByRole('button', { name: 'Send on WhatsApp' })
          .hasAttribute('disabled')
      ).toBe(true);
    });
    const share = screen.getByRole('button', { name: 'Send on WhatsApp' });
    expect(download.getAttribute('aria-busy')).toBeNull();
    expect(share.getAttribute('aria-busy')).toBeNull();
    expect(download.getAttribute('aria-disabled')).toBeNull();
    expect(share.getAttribute('aria-disabled')).toBeNull();

    await userEvent.click(download);
    await userEvent.click(share);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps permission higher priority than document generation', async () => {
    accountRole = 'viewer';
    documentStatus = 'generating';
    render(
      <InvoiceDocumentActions
        invoice={invoice()}
        customerPhone="+919999999999"
      />
    );

    await waitFor(() => {
      expect(
        screen
          .getByRole('button', { name: 'Download invoice' })
          .hasAttribute('disabled')
      ).toBe(true);
      expect(
        screen
          .getByRole('button', { name: 'Send on WhatsApp' })
          .getAttribute('aria-disabled')
      ).toBe('true');
      expect(
        screen
          .getByRole('button', { name: 'Send on WhatsApp' })
          .hasAttribute('disabled')
      ).toBe(false);
    });
    const share = screen.getByRole('button', { name: 'Send on WhatsApp' });
    expect(share.hasAttribute('disabled')).toBe(false);
    await userEvent.click(share);
    expect(
      screen.getByRole('dialog', { name: 'Admin access required' })
    ).toBeTruthy();
  });

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
    await screen.findByRole('button', {
      name: 'Download invoice',
    });
    await waitFor(() =>
      expect(
        screen
          .getByRole('button', { name: 'Download invoice' })
          .getAttribute('aria-disabled')
      ).toBe('true')
    );
    expect(
      screen
        .getByRole('button', { name: 'Send on WhatsApp' })
        .getAttribute('aria-disabled')
    ).toBe('true');
    await userEvent.click(
      screen.getByRole('button', { name: 'Download invoice' })
    );
    expect(screen.getByText(reason)).toBeTruthy();
  });

  it('offers the parent refund-review resolution to an authorized admin', async () => {
    accountRole = 'admin';
    const onResolveRefundReview = vi.fn();
    render(
      <InvoiceDocumentActions
        invoice={invoice({ requires_refund_review: true })}
        customerPhone="+919999999999"
        onResolveRefundReview={onResolveRefundReview}
      />
    );
    await screen.findByRole('button', {
      name: 'Download invoice',
    });
    await waitFor(() =>
      expect(
        screen
          .getByRole('button', { name: 'Download invoice' })
          .getAttribute('aria-disabled')
      ).toBe('true')
    );

    await userEvent.click(
      screen.getByRole('button', { name: 'Download invoice' })
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'Resolve refund review' })
    );

    expect(onResolveRefundReview).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps refund-review explanation-only for a lower operational role', async () => {
    accountRole = 'agent';
    const onResolveRefundReview = vi.fn();
    render(
      <InvoiceDocumentActions
        invoice={invoice({ requires_refund_review: true })}
        customerPhone="+919999999999"
        onResolveRefundReview={onResolveRefundReview}
      />
    );
    await screen.findByRole('button', {
      name: 'Download invoice',
    });
    await waitFor(() =>
      expect(
        screen
          .getByRole('button', { name: 'Download invoice' })
          .getAttribute('aria-disabled')
      ).toBe('true')
    );

    await userEvent.click(
      screen.getByRole('button', { name: 'Download invoice' })
    );

    expect(screen.getByText('Refund review required')).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: 'Resolve refund review' })
    ).toBeNull();
    expect(onResolveRefundReview).not.toHaveBeenCalled();
  });

  it('allows audit download of an already-ready void document', async () => {
    documentStatus = 'ready';
    const fetchMock = vi
      .mocked(fetch)
      .mockResolvedValue(pdfResponse('invoice-INV-000042.pdf'));
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
        .getAttribute('aria-disabled')
    ).toBe('true');
    await userEvent.click(
      screen.getByRole('button', { name: 'Download invoice' })
    );
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/invoices/12345678-1234-4234-9234-123456789abc/document',
      { cache: 'no-store' }
    );
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
