'use client';

import { useEffect, useState } from 'react';
import { Download, MessageCircle } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  ResolvableAction,
  type ActionBlocker,
} from '@/components/ui/resolvable-action';
import { useAuth } from '@/hooks/use-auth';
import {
  canDownloadInvoiceDocuments,
  canShareInvoiceDocuments,
} from '@/lib/auth/roles';
import { getErrorMessage } from '@/lib/errors';
import {
  invoiceDocumentActionPresentation,
  type InvoiceDocumentBlockerCode,
  type InvoiceDocumentStatus,
} from '@/lib/finance/invoice-detail-presentation';
import { isProjectedInvoice } from '@/lib/memberships/periods';
import { createClient } from '@/lib/supabase/client';
import { evaluateTemplateReadiness } from '@/lib/whatsapp/template-readiness';
import type { InvoicePartySnapshot } from '@/types';

export interface InvoiceDocumentActionsInvoice {
  id: string;
  reference: string;
  invoice_number: string | null;
  state: 'open' | 'void';
  lifecycle?: 'current' | 'past' | 'upcoming' | 'void' | null;
  requires_refund_review?: boolean | null;
  seller_snapshot: InvoicePartySnapshot | null;
  customer_snapshot: InvoicePartySnapshot | null;
}

function responseErrorMessage(body: unknown, fallback: string): string {
  if (
    body !== null &&
    typeof body === 'object' &&
    'error' in body &&
    typeof body.error === 'string' &&
    body.error.trim()
  ) {
    return body.error;
  }
  return fallback;
}

function decodeFilename(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function attachmentFilename(
  disposition: string | null,
  fallback: string
): string {
  if (!disposition) return fallback;
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded) return decodeFilename(encoded.trim());
  const quoted = disposition.match(/filename="((?:\\.|[^"])*)"/i)?.[1];
  if (quoted) return quoted.replace(/\\(["\\])/g, '$1');
  const unquoted = disposition.match(/filename=([^;]+)/i)?.[1]?.trim();
  return unquoted || fallback;
}

const PERMISSION_BLOCKER: ActionBlocker = {
  title: 'Admin access required',
  description:
    'Only an agent, admin, or owner can send invoice documents from this account.',
};

function documentBlocker(
  code: InvoiceDocumentBlockerCode | null,
  description: string | null
): ActionBlocker | null {
  if (!code || code === 'document_preparing') return null;

  switch (code) {
    case 'void':
      return {
        title: 'Invoice document unavailable',
        description: description ?? 'Voided invoices cannot be shared.',
      };
    case 'refund_review':
      return {
        title: 'Refund review required',
        description:
          description ??
          'Resolve the invoice refund review before creating a document.',
      };
    case 'invoice_profile':
      return {
        title: 'Invoice setup required',
        description:
          description ?? 'Finish invoice setup before creating a document.',
        resolution: {
          label: 'Finish invoice setup',
          href: '/settings?tab=payments',
        },
      };
    case 'missing_phone':
      return {
        title: 'Phone number required',
        description:
          description ?? 'Add a phone number before sending on WhatsApp.',
      };
    case 'whatsapp_disconnected':
      return {
        title: "WhatsApp isn't connected",
        description:
          description ?? 'Connect WhatsApp before sending this invoice.',
        resolution: {
          label: 'Connect WhatsApp',
          href: '/settings?tab=whatsapp',
        },
      };
    case 'template_unavailable':
      return {
        title: "Invoice template isn't ready",
        description:
          description ?? 'Approve the invoice template before sending.',
        resolution: {
          label: 'Open template setup',
          href: '/settings?tab=templates',
        },
      };
  }
}

export function InvoiceDocumentActions({
  invoice,
  customerPhone,
}: {
  invoice: InvoiceDocumentActionsInvoice;
  customerPhone: string | null | undefined;
}) {
  const { accountId, accountRole } = useAuth();
  const [documentStatus, setDocumentStatus] =
    useState<InvoiceDocumentStatus>(null);
  const [whatsappConnected, setWhatsappConnected] = useState(false);
  const [templateReady, setTemplateReady] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [sharing, setSharing] = useState(false);
  const projected = isProjectedInvoice(invoice.id);

  useEffect(() => {
    if (!accountId || projected) return;
    let cancelled = false;
    void (async () => {
      const supabase = createClient();
      const [documentResult, connectionResult, templateResult] =
        await Promise.all([
          supabase
            .from('invoice_documents')
            .select('status')
            .eq('account_id', accountId)
            .eq('invoice_id', invoice.id)
            .maybeSingle(),
          supabase
            .from('whatsapp_config')
            .select('status')
            .eq('account_id', accountId)
            .maybeSingle(),
          supabase
            .from('message_templates')
            .select('*')
            .eq('account_id', accountId)
            .eq('name', 'gym_invoice_document')
            .eq('language', 'en_US')
            .maybeSingle(),
        ]);
      if (cancelled) return;

      setDocumentStatus(
        documentResult.error
          ? null
          : ((documentResult.data?.status as InvoiceDocumentStatus) ?? null)
      );
      setWhatsappConnected(
        !connectionResult.error && connectionResult.data?.status === 'connected'
      );
      const readiness = evaluateTemplateReadiness(
        templateResult.error || !templateResult.data
          ? []
          : [templateResult.data],
        'invoice_document',
        'en_US'
      );
      setTemplateReady(readiness.ready);
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId, invoice.id, projected]);

  const presentation = invoiceDocumentActionPresentation({
    is_projected: projected,
    lifecycle: invoice.lifecycle,
    state: invoice.state,
    requires_refund_review: invoice.requires_refund_review,
    seller_snapshot: invoice.seller_snapshot,
    customer_snapshot: invoice.customer_snapshot,
    document_status: documentStatus,
    has_customer_phone: Boolean(customerPhone?.trim()),
    whatsapp_connected: whatsappConnected,
    template_ready: templateReady,
  });
  const canDownload = accountRole
    ? canDownloadInvoiceDocuments(accountRole)
    : false;
  const canShare = accountRole ? canShareInvoiceDocuments(accountRole) : false;
  const downloadBlocker = !canDownload
    ? PERMISSION_BLOCKER
    : documentBlocker(
        presentation.download.blocker,
        presentation.download.reason
      );
  const shareBlocker = !canShare
    ? PERMISSION_BLOCKER
    : documentBlocker(presentation.share.blocker, presentation.share.reason);
  const documentPreparing = documentStatus === 'generating';

  if (!presentation.download.show && !presentation.share.show) return null;

  async function downloadInvoice() {
    setDownloading(true);
    try {
      const response = await fetch(`/api/invoices/${invoice.id}/document`, {
        cache: 'no-store',
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(
          responseErrorMessage(body, 'Invoice could not be downloaded')
        );
      }
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = attachmentFilename(
        response.headers.get('Content-Disposition'),
        `invoice-${invoice.reference}.pdf`
      );
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
      setDocumentStatus('ready');
    } catch (error) {
      toast.error(getErrorMessage(error, 'Invoice could not be downloaded'));
    } finally {
      setDownloading(false);
    }
  }

  async function shareInvoice() {
    setSharing(true);
    try {
      const response = await fetch(`/api/invoices/${invoice.id}/share`, {
        method: 'POST',
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          responseErrorMessage(body, 'Invoice could not be sent on WhatsApp')
        );
      }
      setDocumentStatus('ready');
      toast.success('Invoice sent on WhatsApp');
    } catch (error) {
      toast.error(
        getErrorMessage(error, 'Invoice could not be sent on WhatsApp')
      );
    } finally {
      setSharing(false);
    }
  }

  return (
    <>
      {presentation.download.show ? (
        <ResolvableAction
          trigger={
            <Button
              type="button"
              variant="outline"
              disabled={canDownload && documentPreparing}
              loading={downloading}
            >
              <Download /> Download invoice
            </Button>
          }
          onAction={() => void downloadInvoice()}
          blocker={downloadBlocker}
        />
      ) : null}
      {presentation.share.show ? (
        <ResolvableAction
          trigger={
            <Button
              type="button"
              variant="outline"
              disabled={canShare && documentPreparing}
              loading={sharing}
            >
              <MessageCircle /> Send on WhatsApp
            </Button>
          }
          onAction={() => void shareInvoice()}
          blocker={shareBlocker}
        />
      ) : null}
    </>
  );
}
