'use client';

import { useEffect, useState } from 'react';
import { Download, MessageCircle } from 'lucide-react';
import { toast } from 'sonner';

import { GatedButton } from '@/components/ui/gated-button';
import { useAuth } from '@/hooks/use-auth';
import {
  canDownloadInvoiceDocuments,
  canShareInvoiceDocuments,
} from '@/lib/auth/roles';
import { getErrorMessage } from '@/lib/errors';
import {
  invoiceDocumentActionPresentation,
  type InvoiceDocumentStatus,
} from '@/lib/finance/invoice-detail-presentation';
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

  useEffect(() => {
    if (!accountId || invoice.lifecycle === 'upcoming') return;
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
  }, [accountId, invoice.id, invoice.lifecycle]);

  const presentation = invoiceDocumentActionPresentation({
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
        <GatedButton
          type="button"
          variant="outline"
          canAct={canDownload}
          gateReason="download invoice documents"
          disabled={!presentation.download.enabled}
          title={presentation.download.reason ?? undefined}
          loading={downloading}
          onClick={downloadInvoice}
        >
          <Download /> Download invoice
        </GatedButton>
      ) : null}
      {presentation.share.show ? (
        <GatedButton
          type="button"
          variant="outline"
          canAct={canShare}
          gateReason="share invoice documents"
          disabled={!presentation.share.enabled}
          title={presentation.share.reason ?? undefined}
          loading={sharing}
          onClick={shareInvoice}
        >
          <MessageCircle /> Send on WhatsApp
        </GatedButton>
      ) : null}
    </>
  );
}
