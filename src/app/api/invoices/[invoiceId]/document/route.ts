import { NextResponse } from 'next/server';

import {
  ForbiddenError,
  getCurrentAccount,
  toErrorResponse,
} from '@/lib/auth/account';
import { canDownloadInvoiceDocuments } from '@/lib/auth/roles';
import {
  ensureInvoiceDocument,
  InvoiceDocumentConflictError,
} from '@/lib/finance/invoice-document-service';
import { invoiceDocumentFilename } from '@/lib/finance/invoice-documents';

export const runtime = 'nodejs';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function notFound() {
  return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ invoiceId: string }> }
) {
  try {
    const { invoiceId: requestedInvoiceId } = await params;
    if (!UUID_PATTERN.test(requestedInvoiceId)) return notFound();
    const invoiceId = requestedInvoiceId.toLowerCase();

    const ctx = await getCurrentAccount();
    if (!canDownloadInvoiceDocuments(ctx.role)) {
      throw new ForbiddenError(
        'Invoice document download is not available for your role'
      );
    }

    // This authenticated, RLS-protected account lookup must precede the
    // service-role client used for document reservation and private Storage.
    const { data: invoice, error } = await ctx.supabase
      .from('invoices')
      .select('id')
      .eq('id', invoiceId)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (error) throw new Error(`Could not resolve invoice: ${error.message}`);
    if (!invoice) return notFound();

    const document = await ensureInvoiceDocument({
      accountId: ctx.accountId,
      invoiceId,
      userId: ctx.userId,
    });
    const filename = invoiceDocumentFilename(document.invoiceNumber);

    return new Response(Uint8Array.from(document.bytes).buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': String(document.byteCount),
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    if (error instanceof InvoiceDocumentConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    return toErrorResponse(error);
  }
}
