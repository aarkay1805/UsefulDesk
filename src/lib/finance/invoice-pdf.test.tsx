import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { InvoiceDocumentPayloadV1 } from './invoice-documents';
import {
  buildInvoicePdfPages,
  buildInvoicePdfRenderModel,
  buildInvoicePdfTextRuns,
  renderInvoicePdf,
} from './invoice-pdf';

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

function adversarialUnicodePayload(): InvoiceDocumentPayloadV1 {
  const repeat = (value: string, count: number) => value.repeat(count);
  const scripts = ['A', 'क', 'ক', 'ਸ', 'શ', 'ଶ', 'க', 'శ', 'ಶ', 'ശ'];
  const lines = scripts.map((script, index) => ({
    description: repeat(script, 320),
    period: repeat(scripts[(index + 1) % scripts.length] ?? 'A', 120),
    quantity: 1,
    unit_amount_minor: 8_630,
    amount_minor: 8_630,
  }));

  return {
    format_version: 1,
    invoice_number: 'INV-000043',
    issued_at: '2026-08-25',
    currency: 'INR',
    seller: {
      business_name: repeat('শ', 36),
      legal_name: repeat('ਸ਼', 36),
      branch_name: repeat('શ', 36),
      phone: '+91 20 5555 0101',
      email: 'unicode@example.com',
      address: {
        line1: repeat('ଶ', 36),
        line2: repeat('க', 36),
        city: repeat('శ', 24),
        state: repeat('ಶ', 24),
        postal_code: '411001',
        country: repeat('ശ', 24),
      },
    },
    customer: {
      customer_name: repeat('ശ', 36),
      member_number: '1043',
      phone: '+91 98765 43210',
      email: 'member@example.com',
      address: {
        line1: repeat('க', 36),
        line2: repeat('শ', 36),
        city: repeat('શ', 24),
        state: repeat('ਸ਼', 24),
        postal_code: '411002',
        country: repeat('ಶ', 24),
      },
    },
    lines,
    subtotal_minor: 86_300,
    adjustments_minor: 0,
    total_minor: 86_300,
  };
}

function oneLinePayload(
  overrides: Partial<InvoiceDocumentPayloadV1> = {}
): InvoiceDocumentPayloadV1 {
  const base = longPayload();
  const [firstLine] = base.lines;
  if (!firstLine) throw new Error('long fixture must contain a line');

  return {
    ...base,
    invoice_number: 'INV-000044',
    lines: [firstLine],
    subtotal_minor: firstLine.amount_minor,
    adjustments_minor: 0,
    total_minor: firstLine.amount_minor,
    ...overrides,
  };
}

function exactBoundPartyPayload(): InvoiceDocumentPayloadV1 {
  const base = oneLinePayload({ invoice_number: 'INV-000045' });
  const teluguName = 'ఫిట్‌నెస్';
  const seller = {
    business_name: teluguName + 'క'.repeat(100 - Array.from(teluguName).length),
    legal_name: 'గ'.repeat(100),
    branch_name: 'జ'.repeat(100),
    phone: '1'.repeat(50),
    email: 'a'.repeat(50),
    address: {
      line1: 'త'.repeat(30),
      line2: null,
      city: 'న'.repeat(20),
      state: null,
      postal_code: null,
      country: 'భ'.repeat(30),
    },
  };

  expect(
    [
      seller.business_name,
      seller.legal_name,
      seller.branch_name,
      seller.phone,
      seller.email,
      seller.address.line1,
      seller.address.city,
      seller.address.country,
    ].reduce((total, value) => total + Array.from(value).length, 0)
  ).toBe(480);

  return { ...base, seller };
}

describe('renderInvoicePdf', () => {
  it('keeps inherited marks and join controls in their surrounding Indian-script font run', () => {
    expect(buildInvoicePdfTextRuns('ఫిట్‌నెస్')).toEqual([
      { family: 'Noto Sans Telugu', text: 'ఫిట్‌నెస్' },
    ]);
    expect(buildInvoicePdfTextRuns('త᳚')).toEqual([
      { family: 'Noto Sans Telugu', text: 'త᳚' },
    ]);
    expect(buildInvoicePdfTextRuns('\u{11B00}')).toEqual([
      { family: 'Noto Sans Devanagari', text: '\u{11B00}' },
    ]);
    expect(buildInvoicePdfTextRuns('ᴀꜲ')).toEqual([
      { family: 'Noto Sans Extended', text: 'ᴀꜲ' },
    ]);
    expect(buildInvoicePdfTextRuns('☬')).toEqual([
      { family: 'Noto Sans Gurmukhi', text: '☬' },
    ]);
    expect(buildInvoicePdfTextRuns('\u1cf6')).toEqual([
      { family: 'Noto Sans Devanagari', text: '\u1cf6' },
    ]);
    expect(buildInvoicePdfTextRuns('\u1cf7')).toEqual([
      { family: 'Noto Sans Bengali', text: '\u1cf7' },
    ]);
  });

  it('adds a totals-only continuation when a sole final row consumes the continuation frame', () => {
    const model = buildInvoicePdfRenderModel(oneLinePayload());
    const [line] = model.lines;
    if (!line) throw new Error('one-line fixture must contain a line');
    const tallLine = { ...line, description: 'x'.repeat(720), period: null };

    expect(buildInvoicePdfPages({ ...model, lines: [tallLine] })).toEqual([
      [],
      [tallLine],
      [],
    ]);
  });

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

  it('embeds major Indian-script fonts and renders bounded unbroken content', async () => {
    const buffer = await renderInvoicePdf(adversarialUnicodePayload());
    const pdfPath = join(
      fixtureDirectory,
      'invoice-INV-000043-adversarial.pdf'
    );
    writeFileSync(pdfPath, buffer);
    if (process.env.INVOICE_PDF_ADVERSARIAL_PATH) {
      mkdirSync(dirname(process.env.INVOICE_PDF_ADVERSARIAL_PATH), {
        recursive: true,
      });
      writeFileSync(process.env.INVOICE_PDF_ADVERSARIAL_PATH, buffer);
    }

    const metadata = execFileSync('pdfinfo', [pdfPath], { encoding: 'utf8' });
    const pdfSource = buffer.toString('latin1');

    expect(metadata).toContain('Title:           Invoice INV-000043');
    expect(metadata).toContain('Page size:       595.28 x 841.89 pts (A4)');
    expect(metadata).toContain('Pages:           11');
    for (const family of [
      'NotoSansBengali',
      'NotoSansGurmukhi',
      'NotoSansGujarati',
      'NotoSansOriya',
      'NotoSansTamil',
      'NotoSansTelugu',
      'NotoSansKannada',
      'NotoSansMalayalam',
    ]) {
      expect(pdfSource).toContain(family);
    }
  }, 30_000);

  it('moves a sole row when dynamic first-page space cannot also hold totals', async () => {
    const base = oneLinePayload();
    const shortLine = {
      description: 'Gym service',
      period: null,
      quantity: 1,
      unit_amount_minor: 12_345,
      amount_minor: 12_345,
    };
    const payload = {
      ...base,
      lines: [shortLine],
      seller: {
        ...base.seller,
        business_name: 'S'.repeat(40),
        legal_name: 'L'.repeat(60),
        branch_name: 'B'.repeat(60),
      },
    };
    const buffer = await renderInvoicePdf(payload);
    const pdfPath = join(fixtureDirectory, 'invoice-INV-000044-dynamic.pdf');
    writeFileSync(pdfPath, buffer);

    const metadata = execFileSync('pdfinfo', [pdfPath], { encoding: 'utf8' });
    expect(metadata).toContain('Pages:           2');
  }, 30_000);

  it('renders the exact 480-code-point party bound without sharing its page with rows', async () => {
    const buffer = await renderInvoicePdf(exactBoundPartyPayload());
    const pdfPath = join(
      fixtureDirectory,
      'invoice-INV-000045-exact-bound.pdf'
    );
    writeFileSync(pdfPath, buffer);
    if (process.env.INVOICE_PDF_EXACT_BOUND_PATH) {
      mkdirSync(dirname(process.env.INVOICE_PDF_EXACT_BOUND_PATH), {
        recursive: true,
      });
      writeFileSync(process.env.INVOICE_PDF_EXACT_BOUND_PATH, buffer);
    }

    const metadata = execFileSync('pdfinfo', [pdfPath], { encoding: 'utf8' });
    expect(metadata).toContain('Pages:           2');
  }, 30_000);
});
