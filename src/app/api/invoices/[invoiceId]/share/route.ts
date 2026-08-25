import { NextResponse } from 'next/server';

import {
  ForbiddenError,
  requireOperationalAccess,
  toErrorResponse,
} from '@/lib/auth/account';
import { canShareInvoiceDocuments } from '@/lib/auth/roles';
import {
  ensureInvoiceDocument,
  InvoiceDocumentConflictError,
} from '@/lib/finance/invoice-document-service';
import { assertInvoiceDocumentPayload } from '@/lib/finance/invoice-documents';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { buildFormatters } from '@/lib/locale/format';
import { resolveAccountLocale } from '@/lib/locale/config';
import { resolveContactConversation } from '@/lib/whatsapp/resolve-contact-conversation';
import {
  sendMessageToConversation,
  SendMessageError,
} from '@/lib/whatsapp/send-message';
import { evaluateTemplateReadiness } from '@/lib/whatsapp/template-readiness';
import { invoiceDocumentTemplateParams } from '@/lib/whatsapp/template-send-presentation';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BUCKET = 'invoice-documents';
const SIGNED_URL_SECONDS = 300;
const MISSING_PHONE = 'Add a phone number before sending on WhatsApp.';
const MISSING_CONNECTION = 'Connect WhatsApp in Settings before sending.';
const MISSING_TEMPLATE =
  'Approve and sync gym_invoice_document in en_US before sending.';

function notFound() {
  return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
}

function conflict(message: string) {
  return NextResponse.json({ error: message }, { status: 409 });
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ invoiceId: string }> }
) {
  try {
    const { invoiceId: requestedInvoiceId } = await params;
    if (!UUID_PATTERN.test(requestedInvoiceId)) return notFound();
    const invoiceId = requestedInvoiceId.toLowerCase();

    const ctx = await requireOperationalAccess();
    if (!canShareInvoiceDocuments(ctx.role)) {
      throw new ForbiddenError(
        'Invoice document sharing is not available for your role'
      );
    }

    // This caller-RLS lookup is deliberately first. Nothing below may claim a
    // document lease or touch private Storage until the selected account has
    // resolved the invoice without revealing a cross-tenant distinction.
    const { data: invoice, error: invoiceError } = await ctx.supabase
      .from('invoice_balances')
      .select('id, contact_id, state, requires_refund_review')
      .eq('id', invoiceId)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (invoiceError) {
      throw new Error(`Could not resolve invoice: ${invoiceError.message}`);
    }
    if (!invoice) return notFound();

    // Readiness order is recovery order: staff should fix the first returned
    // setup issue before the route advances to document preparation.
    const contactId = invoice.contact_id as string | null;
    const { data: contact, error: contactError } = contactId
      ? await ctx.supabase
          .from('contacts')
          .select('id, phone')
          .eq('id', contactId)
          .eq('account_id', ctx.accountId)
          .maybeSingle()
      : { data: null, error: null };
    if (contactError) {
      throw new Error(
        `Could not resolve invoice contact: ${contactError.message}`
      );
    }
    if (!contactId || !contact?.phone) return conflict(MISSING_PHONE);

    const { data: connection, error: connectionError } = await ctx.supabase
      .from('whatsapp_config')
      .select('id, status')
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (connectionError) {
      throw new Error(
        `Could not resolve WhatsApp connection: ${connectionError.message}`
      );
    }
    if (!connection || connection.status !== 'connected') {
      return conflict(MISSING_CONNECTION);
    }

    const { data: template, error: templateError } = await ctx.supabase
      .from('message_templates')
      .select('*')
      .eq('account_id', ctx.accountId)
      .eq('name', 'gym_invoice_document')
      .eq('language', 'en_US')
      .maybeSingle();
    if (templateError) {
      throw new Error(
        `Could not resolve invoice template: ${templateError.message}`
      );
    }
    const templateReadiness = evaluateTemplateReadiness(
      template ? [template] : [],
      'invoice_document',
      'en_US'
    );
    if (!templateReadiness.ready) return conflict(MISSING_TEMPLATE);

    // A ready artifact remains downloadable for audit, but current lifecycle
    // state still controls whether staff may initiate a customer send.
    if (invoice.state === 'void') {
      return conflict('Voided invoices cannot generate documents');
    }
    if (invoice.requires_refund_review) {
      return conflict(
        'Resolve the invoice refund review before generating a document'
      );
    }

    const { data: accountLocale, error: accountError } = await ctx.supabase
      .from('accounts')
      .select(
        'country_code, locale, default_currency, timezone, date_order, time_format, week_start, phone_country_code, measurement_system'
      )
      .eq('id', ctx.accountId)
      .maybeSingle();
    if (accountError || !accountLocale) {
      throw new Error(
        `Could not resolve invoice locale: ${accountError?.message ?? 'account not found'}`
      );
    }

    const document = await ensureInvoiceDocument({
      accountId: ctx.accountId,
      invoiceId,
      userId: ctx.userId,
    });

    // The database-authored payload is the immutable presentation authority.
    // Reading it through caller RLS prevents a live balance, edited contact,
    // or later profile value from drifting away from the generated PDF.
    const { data: documentRow, error: documentError } = await ctx.supabase
      .from('invoice_documents')
      .select('payload_snapshot')
      .eq('account_id', ctx.accountId)
      .eq('invoice_id', invoiceId)
      .eq('status', 'ready')
      .maybeSingle();
    if (documentError || !documentRow) {
      throw new Error(
        `Could not resolve ready invoice document: ${documentError?.message ?? 'document not found'}`
      );
    }
    assertInvoiceDocumentPayload(documentRow.payload_snapshot);

    const { data: signed, error: signError } = await supabaseAdmin()
      .storage.from(BUCKET)
      .createSignedUrl(document.storagePath, SIGNED_URL_SECONDS);
    if (signError || !signed?.signedUrl) {
      throw new Error(
        `Could not sign invoice document: ${signError?.message ?? 'signed URL missing'}`
      );
    }

    const conversationId = await resolveContactConversation(
      ctx.supabase,
      ctx.accountId,
      ctx.userId,
      contactId
    );
    const templateMessageParams = invoiceDocumentTemplateParams(
      documentRow.payload_snapshot,
      signed.signedUrl,
      buildFormatters(resolveAccountLocale(accountLocale))
    );
    const result = await sendMessageToConversation(
      ctx.supabase,
      ctx.accountId,
      {
        conversationId,
        messageType: 'template',
        templateName: 'gym_invoice_document',
        templateLanguage: 'en_US',
        templateMessageParams,
        persistedMediaUrl: `/api/invoices/${invoiceId}/document`,
      }
    );

    return NextResponse.json({
      success: true,
      message_id: result.messageId,
      whatsapp_message_id: result.whatsappMessageId,
    });
  } catch (error) {
    if (error instanceof InvoiceDocumentConflictError) {
      return conflict(error.message);
    }
    if (error instanceof SendMessageError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status }
      );
    }
    return toErrorResponse(error);
  }
}
