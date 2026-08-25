import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { InvoiceDocumentPayloadV1 } from './invoice-documents';
import { buildInvoicePdfRenderModel, renderInvoicePdf } from './invoice-pdf';

const tempRoot = join(process.cwd(), 'tmp', 'pdfs');
let fixtureDirectory = '';

beforeAll(() => {
  mkdirSync(tempRoot, { recursive: true });
  fixtureDirectory = mkdtempSync(join(tempRoot, 'invoice-pdf-test-'));
});

afterAll(() => {
  rmSync(fixtureDirectory, { recursive: true, force: true });
});

function longPayload(): InvoiceDocumentPayloadV1 {
  const lines = Array.from({ length: 70 }, (_, index) => ({
    description:
      `Strength and mobility programme ${index + 1}: ` +
      'a deliberately long immutable service description that must wrap cleanly without clipping or crossing the amount columns.',
    period: `2026-08-${String((index % 28) + 1).padStart(2, '0')} to 2026-09-${String(
      (index % 28) + 1
    ).padStart(2, '0')}`,
    quantity: 1,
    unit_amount_minor: 12_345,
    amount_minor: 12_345,
  }));

  return {
    format_version: 1,
    invoice_number: 'INV-000042',
    issued_at: '2026-08-24',
    currency: 'INR',
    seller: {
      business_name: 'शक्ति फिटनेस',
      legal_name: 'Shakti Fitness Private Limited',
      branch_name: 'Koregaon Park',
      phone: '+91 20 5555 0101',
      email: 'hello@example.com',
      address: {
        line1: '12 Fitness Road',
        line2: 'Near a deliberately long landmark that wraps naturally',
        city: 'Pune',
        state: 'Maharashtra',
        postal_code: '411001',
        country: 'India',
      },
    },
    customer: {
      customer_name: 'अनन्या देशमुख',
      member_number: '1042',
      phone: '+91 98765 43210',
      email: 'ananya@example.com',
      address: {
        line1: '88 Member Avenue',
        line2: null,
        city: 'Pune',
        state: 'Maharashtra',
        postal_code: '411001',
        country: 'India',
      },
    },
    lines,
    subtotal_minor: lines.length * 12_345,
    adjustments_minor: -1_150,
    total_minor: lines.length * 12_345 - 1_150,
  };
}

describe('renderInvoicePdf', () => {
  it('renders a Unicode, multipage, charge-only A4 invoice', async () => {
    const buffer = await renderInvoicePdf(longPayload());
    const model = buildInvoicePdfRenderModel(longPayload());
    const pdfPath = join(fixtureDirectory, 'invoice-INV-000042-long.pdf');
    writeFileSync(pdfPath, buffer);
    if (process.env.INVOICE_PDF_VISUAL_PATH) {
      mkdirSync(dirname(process.env.INVOICE_PDF_VISUAL_PATH), {
        recursive: true,
      });
      writeFileSync(process.env.INVOICE_PDF_VISUAL_PATH, buffer);
    }

    expect(buffer.subarray(0, 4).toString('ascii')).toBe('%PDF');
    expect(buffer.byteLength).toBeGreaterThan(1024);

    const metadata = execFileSync('pdfinfo', [pdfPath], {
      encoding: 'utf8',
    });
    const text = JSON.stringify(model);
    const pageCount = Number(metadata.match(/^Pages:\s+(\d+)$/m)?.[1]);

    expect(metadata).toContain('Title:           Invoice INV-000042');
    expect(metadata).toContain('Page size:       595.28 x 841.89 pts (A4)');
    expect(pageCount).toBeGreaterThan(2);
    expect(text).toContain('Invoice');
    expect(text).toContain('INV-000042');
    expect(text).toContain('Invoice total');
    expect(text).toContain('Non-tax invoice');
    expect(text).toContain('शक्ति फिटनेस');
    expect(text).toContain('अनन्या देशमुख');
    expect(model.pageNumber(1, pageCount)).toBe(`Page 1 of ${pageCount}`);
    expect(model.pageNumber(pageCount, pageCount)).toBe(
      `Page ${pageCount} of ${pageCount}`
    );

    const exactFooter =
      'Non-tax invoice - GST and tax calculations are not included.';
    const chargeClaimsOnly = text.replaceAll(exactFooter, '');
    for (const forbidden of [
      /GST/i,
      /Amount due/i,
      /\bPaid\b/i,
      /\bBalance\b/i,
      /\bReceipt\b/i,
    ]) {
      expect(chargeClaimsOnly).not.toMatch(forbidden);
    }
  }, 30_000);
});
