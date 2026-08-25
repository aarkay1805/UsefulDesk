import 'server-only';

import { createRequire } from 'node:module';
import { join } from 'node:path';
import {
  Document,
  Font,
  Page,
  StyleSheet,
  Text,
  View,
  renderToBuffer,
} from '@react-pdf/renderer';
import type { ComponentProps, ReactElement } from 'react';
import { formatCurrencyExact } from '@/lib/currency';
import {
  assertInvoiceDocumentPayload,
  type InvoiceDocumentAddress,
  type InvoiceDocumentPayloadV1,
} from './invoice-documents';

const packageRequire = createRequire(join(process.cwd(), 'package.json'));

Font.register({
  family: 'Noto Sans',
  fonts: [
    {
      src: packageRequire.resolve(
        '@fontsource/noto-sans/files/noto-sans-latin-400-normal.woff'
      ),
      fontWeight: 400,
    },
    {
      src: packageRequire.resolve(
        '@fontsource/noto-sans/files/noto-sans-latin-700-normal.woff'
      ),
      fontWeight: 700,
    },
  ],
});

Font.register({
  family: 'Noto Sans Extended',
  fonts: [
    {
      src: packageRequire.resolve(
        '@fontsource/noto-sans/files/noto-sans-latin-ext-400-normal.woff'
      ),
      fontWeight: 400,
    },
    {
      src: packageRequire.resolve(
        '@fontsource/noto-sans/files/noto-sans-latin-ext-700-normal.woff'
      ),
      fontWeight: 700,
    },
  ],
});

Font.register({
  family: 'Noto Sans Devanagari',
  fonts: [
    {
      src: packageRequire.resolve(
        '@fontsource/noto-sans-devanagari/files/noto-sans-devanagari-devanagari-400-normal.woff'
      ),
      fontWeight: 400,
    },
    {
      src: packageRequire.resolve(
        '@fontsource/noto-sans-devanagari/files/noto-sans-devanagari-devanagari-700-normal.woff'
      ),
      fontWeight: 700,
    },
  ],
});

function registerIndianScriptFont(
  family: string,
  regularSource: string,
  boldSource: string
): void {
  Font.register({
    family,
    fonts: [
      { src: regularSource, fontWeight: 400 },
      { src: boldSource, fontWeight: 700 },
    ],
  });
}

registerIndianScriptFont(
  'Noto Sans Bengali',
  packageRequire.resolve(
    '@fontsource/noto-sans-bengali/files/noto-sans-bengali-bengali-400-normal.woff'
  ),
  packageRequire.resolve(
    '@fontsource/noto-sans-bengali/files/noto-sans-bengali-bengali-700-normal.woff'
  )
);
registerIndianScriptFont(
  'Noto Sans Gurmukhi',
  packageRequire.resolve(
    '@fontsource/noto-sans-gurmukhi/files/noto-sans-gurmukhi-gurmukhi-400-normal.woff'
  ),
  packageRequire.resolve(
    '@fontsource/noto-sans-gurmukhi/files/noto-sans-gurmukhi-gurmukhi-700-normal.woff'
  )
);
registerIndianScriptFont(
  'Noto Sans Gujarati',
  packageRequire.resolve(
    '@fontsource/noto-sans-gujarati/files/noto-sans-gujarati-gujarati-400-normal.woff'
  ),
  packageRequire.resolve(
    '@fontsource/noto-sans-gujarati/files/noto-sans-gujarati-gujarati-700-normal.woff'
  )
);
registerIndianScriptFont(
  'Noto Sans Oriya',
  packageRequire.resolve(
    '@fontsource/noto-sans-oriya/files/noto-sans-oriya-oriya-400-normal.woff'
  ),
  packageRequire.resolve(
    '@fontsource/noto-sans-oriya/files/noto-sans-oriya-oriya-700-normal.woff'
  )
);
registerIndianScriptFont(
  'Noto Sans Tamil',
  packageRequire.resolve(
    '@fontsource/noto-sans-tamil/files/noto-sans-tamil-tamil-400-normal.woff'
  ),
  packageRequire.resolve(
    '@fontsource/noto-sans-tamil/files/noto-sans-tamil-tamil-700-normal.woff'
  )
);
registerIndianScriptFont(
  'Noto Sans Telugu',
  packageRequire.resolve(
    '@fontsource/noto-sans-telugu/files/noto-sans-telugu-telugu-400-normal.woff'
  ),
  packageRequire.resolve(
    '@fontsource/noto-sans-telugu/files/noto-sans-telugu-telugu-700-normal.woff'
  )
);
registerIndianScriptFont(
  'Noto Sans Kannada',
  packageRequire.resolve(
    '@fontsource/noto-sans-kannada/files/noto-sans-kannada-kannada-400-normal.woff'
  ),
  packageRequire.resolve(
    '@fontsource/noto-sans-kannada/files/noto-sans-kannada-kannada-700-normal.woff'
  )
);
registerIndianScriptFont(
  'Noto Sans Malayalam',
  packageRequire.resolve(
    '@fontsource/noto-sans-malayalam/files/noto-sans-malayalam-malayalam-400-normal.woff'
  ),
  packageRequire.resolve(
    '@fontsource/noto-sans-malayalam/files/noto-sans-malayalam-malayalam-700-normal.woff'
  )
);

const graphemeSegmenter = new Intl.Segmenter('und', {
  granularity: 'grapheme',
});

const styles = StyleSheet.create({
  page: {
    backgroundColor: '#ffffff',
    color: '#18212f',
    fontFamily: 'Noto Sans',
    fontSize: 9,
    height: 841.89,
    lineHeight: 1.45,
    maxHeight: 841.89,
    minHeight: 841.89,
    paddingTop: 42,
    paddingRight: 46,
    paddingBottom: 25,
    paddingLeft: 46,
  },
  topRule: {
    borderTopColor: '#18212f',
    borderTopWidth: 3,
    marginBottom: 25,
  },
  headingRow: {
    alignItems: 'flex-start',
    display: 'flex',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 27,
  },
  title: {
    color: '#101827',
    fontSize: 28,
    fontWeight: 700,
    letterSpacing: -0.6,
    lineHeight: 1.1,
    marginBottom: 8,
  },
  metadata: {
    color: '#536174',
    fontSize: 9,
    lineHeight: 1.55,
  },
  continuationMetadata: {
    color: '#536174',
    display: 'flex',
    flexDirection: 'row',
    fontSize: 8,
    justifyContent: 'space-between',
    marginBottom: 15,
  },
  totalHero: {
    alignItems: 'flex-end',
    display: 'flex',
    width: 205,
  },
  eyebrow: {
    color: '#687588',
    fontSize: 8,
    fontWeight: 700,
    letterSpacing: 0.8,
    marginBottom: 5,
    textTransform: 'uppercase',
  },
  heroAmount: {
    color: '#101827',
    fontSize: 21,
    fontWeight: 700,
    lineHeight: 1.15,
    textAlign: 'right',
  },
  parties: {
    display: 'flex',
    flexDirection: 'row',
    gap: 38,
    marginBottom: 28,
  },
  party: {
    flexGrow: 1,
    width: '50%',
  },
  partyName: {
    color: '#101827',
    fontSize: 11,
    fontWeight: 700,
    lineHeight: 1.4,
    marginBottom: 4,
  },
  partyLine: {
    color: '#465466',
    lineHeight: 1.45,
  },
  table: {
    borderBottomColor: '#cdd3dc',
    borderBottomWidth: 1,
    width: '100%',
  },
  tableHeader: {
    backgroundColor: '#f1f3f6',
    borderBottomColor: '#9ca6b4',
    borderBottomWidth: 1,
    borderTopColor: '#9ca6b4',
    borderTopWidth: 1,
    color: '#3b485a',
    display: 'flex',
    flexDirection: 'row',
    fontSize: 7.5,
    fontWeight: 700,
    letterSpacing: 0.45,
    paddingBottom: 7,
    paddingTop: 7,
    textTransform: 'uppercase',
  },
  tableRow: {
    borderBottomColor: '#e3e6eb',
    borderBottomWidth: 0.7,
    display: 'flex',
    flexDirection: 'row',
    paddingBottom: 9,
    paddingTop: 9,
  },
  descriptionColumn: {
    paddingRight: 12,
    width: '52%',
  },
  quantityColumn: {
    paddingRight: 8,
    textAlign: 'right',
    width: '10%',
  },
  unitColumn: {
    paddingRight: 8,
    textAlign: 'right',
    width: '18%',
  },
  amountColumn: {
    textAlign: 'right',
    width: '20%',
  },
  description: {
    color: '#18212f',
    lineHeight: 1.4,
  },
  period: {
    color: '#6a7687',
    fontSize: 7.8,
    lineHeight: 1.4,
    marginTop: 3,
  },
  totals: {
    alignSelf: 'flex-end',
    marginTop: 20,
    width: 245,
  },
  totalRow: {
    color: '#465466',
    display: 'flex',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: 4,
    paddingTop: 4,
  },
  totalLabel: {
    paddingRight: 15,
  },
  totalValue: {
    textAlign: 'right',
  },
  grandTotal: {
    borderTopColor: '#9ca6b4',
    borderTopWidth: 1,
    color: '#101827',
    display: 'flex',
    flexDirection: 'row',
    fontSize: 11,
    fontWeight: 700,
    justifyContent: 'space-between',
    marginTop: 5,
    paddingTop: 10,
  },
  footerBar: {
    color: '#687588',
    display: 'flex',
    flexDirection: 'row',
    fontSize: 7.4,
    justifyContent: 'space-between',
    marginTop: 15,
    width: '100%',
  },
  footerSpacer: {
    flexGrow: 1,
    minHeight: 12,
  },
  footer: {
    color: '#687588',
    flexGrow: 1,
    fontSize: 7.4,
  },
  pageNumber: {
    color: '#687588',
    fontSize: 7.4,
    textAlign: 'right',
    width: 70,
  },
});

type ViewStyle = ComponentProps<typeof View>['style'];

function indianScriptFamilyForCodePoint(codePoint: number): string | null {
  if (codePoint >= 0x0900 && codePoint <= 0x097f) {
    return 'Noto Sans Devanagari';
  }
  if (codePoint >= 0x0980 && codePoint <= 0x09ff) {
    return 'Noto Sans Bengali';
  }
  if (codePoint >= 0x0a00 && codePoint <= 0x0a7f) {
    return 'Noto Sans Gurmukhi';
  }
  if (codePoint >= 0x0a80 && codePoint <= 0x0aff) {
    return 'Noto Sans Gujarati';
  }
  if (codePoint >= 0x0b00 && codePoint <= 0x0b7f) {
    return 'Noto Sans Oriya';
  }
  if (codePoint >= 0x0b80 && codePoint <= 0x0bff) {
    return 'Noto Sans Tamil';
  }
  if (codePoint >= 0x0c00 && codePoint <= 0x0c7f) {
    return 'Noto Sans Telugu';
  }
  if (codePoint >= 0x0c80 && codePoint <= 0x0cff) {
    return 'Noto Sans Kannada';
  }
  if (codePoint >= 0x0d00 && codePoint <= 0x0d7f) {
    return 'Noto Sans Malayalam';
  }
  return null;
}

function fontFamilyForCodePoint(codePoint: number): string {
  const indianFamily = indianScriptFamilyForCodePoint(codePoint);
  if (indianFamily) return indianFamily;
  if (codePoint === 0x0307 || codePoint === 0x0323) {
    return 'Noto Sans Malayalam';
  }
  if (codePoint === 0x262c) return 'Noto Sans Gurmukhi';
  if ((codePoint >= 0x1cd0 && codePoint <= 0x1cff) || codePoint === 0x20b9) {
    return 'Noto Sans Devanagari';
  }
  if (
    (codePoint >= 0xa830 && codePoint <= 0xa839) ||
    (codePoint >= 0xa8e0 && codePoint <= 0xa8ff) ||
    (codePoint >= 0x11b00 && codePoint <= 0x11b09) ||
    codePoint === 0x20a8 ||
    codePoint === 0x20f0 ||
    codePoint === 0x25cc
  ) {
    return 'Noto Sans Devanagari';
  }
  if (
    (codePoint >= 0x0100 && codePoint <= 0x02ff) ||
    (codePoint >= 0x1d00 && codePoint <= 0x1dbf) ||
    (codePoint >= 0x1e00 && codePoint <= 0x1eff) ||
    (codePoint >= 0x20a0 && codePoint <= 0x20cf) ||
    (codePoint >= 0x2c60 && codePoint <= 0x2c7f) ||
    (codePoint >= 0xa720 && codePoint <= 0xa7ff)
  ) {
    return 'Noto Sans Extended';
  }
  return 'Noto Sans';
}

export interface InvoicePdfTextRun {
  family: string;
  text: string;
}

function contextualIndianFamily(
  graphemes: readonly string[],
  index: number
): string | null {
  for (let distance = 1; distance < graphemes.length; distance += 1) {
    const before = graphemes[index - distance];
    if (before) {
      for (const character of Array.from(before).reverse()) {
        const family = indianScriptFamilyForCodePoint(
          character.codePointAt(0) ?? 0
        );
        if (family) return family;
      }
    }

    const after = graphemes[index + distance];
    if (after) {
      for (const character of Array.from(after)) {
        const family = indianScriptFamilyForCodePoint(
          character.codePointAt(0) ?? 0
        );
        if (family) return family;
      }
    }
  }
  return null;
}

function fontFamilyForGrapheme(
  grapheme: string,
  graphemes: readonly string[],
  index: number
): string {
  for (const character of Array.from(grapheme)) {
    const family = indianScriptFamilyForCodePoint(
      character.codePointAt(0) ?? 0
    );
    if (family) return family;
  }

  if (/\p{M}|[\u200c\u200d]/u.test(grapheme)) {
    const contextualFamily = contextualIndianFamily(graphemes, index);
    if (contextualFamily) return contextualFamily;
  }

  return fontFamilyForCodePoint(grapheme.codePointAt(0) ?? 0);
}

export function buildInvoicePdfTextRuns(value: string): InvoicePdfTextRun[] {
  const runs: InvoicePdfTextRun[] = [];
  const graphemes = Array.from(
    graphemeSegmenter.segment(value),
    ({ segment }) => segment
  );

  for (const [index, grapheme] of graphemes.entries()) {
    const current = runs.at(-1);
    const family =
      /^\s+$/u.test(grapheme) && current
        ? current.family
        : fontFamilyForGrapheme(grapheme, graphemes, index);
    if (current?.family === family) {
      current.text += grapheme;
    } else {
      runs.push({ family, text: grapheme });
    }
  }
  return runs;
}

function hardWrapWords(value: string, maxGraphemes: number): string {
  return value
    .split(/(\s+)/u)
    .map((part) => {
      if (/^\s+$/u.test(part)) return part;
      const graphemes = Array.from(
        graphemeSegmenter.segment(part),
        ({ segment }) => segment
      );
      const lines: string[] = [];
      for (let index = 0; index < graphemes.length; index += maxGraphemes) {
        lines.push(graphemes.slice(index, index + maxGraphemes).join(''));
      }
      return lines.join('\n');
    })
    .join('');
}

function UnicodeText({
  children,
  maxWordGraphemes = 24,
  style,
}: {
  children: string;
  maxWordGraphemes?: number;
  style?: ViewStyle;
}): ReactElement {
  const displayText = hardWrapWords(children, maxWordGraphemes);
  const displayLines = displayText.split('\n');
  if (displayLines.length > 1) {
    return (
      <View style={style}>
        {displayLines.map((line, index) => (
          <UnicodeTextLine key={`${line}-${index}`} value={line} />
        ))}
      </View>
    );
  }

  return <UnicodeTextLine style={style} value={displayText} />;
}

function UnicodeTextLine({
  style,
  value,
}: {
  style?: ViewStyle;
  value: string;
}): ReactElement {
  const runs = buildInvoicePdfTextRuns(value);
  if (runs.length === 1) {
    return (
      <Text
        style={[
          style,
          { fontFamily: [runs[0]?.family ?? 'Noto Sans', 'Noto Sans'] },
        ]}
      >
        {value}
      </Text>
    );
  }

  return (
    <Text style={style}>
      {runs.map((run, index) => (
        <Text
          key={`${run.family}-${index}`}
          style={{ fontFamily: [run.family, 'Noto Sans'] }}
        >
          {run.text}
        </Text>
      ))}
    </Text>
  );
}

function MoneyText({
  children,
  style,
}: {
  children: string;
  style?: ViewStyle;
}): ReactElement {
  return (
    <View
      style={[
        style,
        {
          display: 'flex',
          flexDirection: 'row',
          justifyContent: 'flex-end',
        },
      ]}
    >
      {buildInvoicePdfTextRuns(children).map((run, index) => (
        <Text
          key={`${run.family}-${index}`}
          style={{ fontFamily: [run.family, 'Noto Sans'] }}
        >
          {run.text}
        </Text>
      ))}
    </View>
  );
}

function money(minorUnits: number, currency: string): string {
  return formatCurrencyExact(minorUnits / 100, currency);
}

function quantity(value: number): string {
  return Number.isInteger(value)
    ? String(value)
    : String(Number(value.toFixed(3)));
}

function addressLines(address: InvoiceDocumentAddress): string[] {
  return [
    address.line1,
    address.line2,
    [address.city, address.state, address.postal_code]
      .filter(Boolean)
      .join(', '),
    address.country,
  ].filter((line): line is string => Boolean(line?.trim()));
}

export interface InvoicePdfRenderLine {
  description: string;
  period: string | null;
  quantity: string;
  unitPrice: string;
  amount: string;
}

export interface InvoicePdfRenderModel {
  metadataTitle: string;
  headline: string;
  invoiceNumber: string;
  issuedAt: string;
  invoiceTotalLabel: string;
  invoiceTotal: string;
  sellerLabel: string;
  sellerName: string;
  sellerLines: string[];
  customerLabel: string;
  customerName: string;
  customerLines: string[];
  tableHeaders: readonly [string, string, string, string];
  lines: InvoicePdfRenderLine[];
  subtotalLabel: string;
  subtotal: string;
  adjustmentsLabel: string | null;
  adjustments: string | null;
  footer: string;
  pageNumber: (pageNumber: number, totalPages: number) => string;
}

export function buildInvoicePdfRenderModel(
  payload: InvoiceDocumentPayloadV1
): InvoicePdfRenderModel {
  assertInvoiceDocumentPayload(payload);

  return {
    metadataTitle: `Invoice ${payload.invoice_number}`,
    headline: 'Invoice',
    invoiceNumber: `Number ${payload.invoice_number}`,
    issuedAt: `Issued ${payload.issued_at}`,
    invoiceTotalLabel: 'Invoice total',
    invoiceTotal: money(payload.total_minor, payload.currency),
    sellerLabel: 'From',
    sellerName: payload.seller.business_name,
    sellerLines: [
      payload.seller.legal_name,
      payload.seller.branch_name,
      ...addressLines(payload.seller.address),
      payload.seller.phone,
      payload.seller.email,
    ].filter((line): line is string => Boolean(line?.trim())),
    customerLabel: 'Bill to',
    customerName: payload.customer.customer_name,
    customerLines: [
      payload.customer.member_number
        ? `Member ID: ${payload.customer.member_number}`
        : null,
      ...addressLines(payload.customer.address),
      payload.customer.phone,
      payload.customer.email,
    ].filter((line): line is string => Boolean(line?.trim())),
    tableHeaders: ['Description', 'Qty', 'Unit price', 'Amount'],
    lines: payload.lines.map((line) => ({
      description: line.description,
      period: line.period,
      quantity: quantity(line.quantity),
      unitPrice: money(line.unit_amount_minor, payload.currency),
      amount: money(line.amount_minor, payload.currency),
    })),
    subtotalLabel: 'Subtotal',
    subtotal: money(payload.subtotal_minor, payload.currency),
    adjustmentsLabel: payload.adjustments_minor === 0 ? null : 'Adjustments',
    adjustments:
      payload.adjustments_minor === 0
        ? null
        : money(payload.adjustments_minor, payload.currency),
    footer: 'Non-tax invoice - GST and tax calculations are not included.',
    pageNumber: (pageNumber, totalPages) =>
      `Page ${pageNumber} of ${totalPages}`,
  };
}

function PartyLines({ lines }: { lines: (string | null)[] }): ReactElement {
  return (
    <>
      {lines
        .filter((line): line is string => Boolean(line?.trim()))
        .map((line, index) => (
          <UnicodeText
            key={`${line}-${index}`}
            maxWordGraphemes={22}
            style={styles.partyLine}
          >
            {line}
          </UnicodeText>
        ))}
    </>
  );
}

const FIRST_PAGE_ROW_BUDGET = 180;
const CONTINUATION_PAGE_ROW_BUDGET = 430;
const TOTALS_HEIGHT_RESERVE = 92;
const BASELINE_PARTY_HEIGHT = 216;
const PARTY_CHARACTERS_PER_LINE = 22;
const PARTY_NAME_CHARACTERS_PER_LINE = 18;

function wrappedLineCount(value: string, charactersPerLine: number): number {
  return value.split('\n').reduce((count, segment) => {
    return (
      count +
      Math.max(1, Math.ceil(Array.from(segment).length / charactersPerLine))
    );
  }, 0);
}

function estimatedRowHeight(line: InvoicePdfRenderLine): number {
  const descriptionHeight = wrappedLineCount(line.description, 24) * 12.6;
  const periodHeight = line.period
    ? 3 + wrappedLineCount(line.period, 24) * 10.9
    : 0;
  return 18 + descriptionHeight + periodHeight;
}

function estimatedPartyHeight(name: string, lines: readonly string[]): number {
  const nameHeight =
    wrappedLineCount(name, PARTY_NAME_CHARACTERS_PER_LINE) * 15.4 + 4;
  const detailHeight = lines.reduce(
    (height, line) =>
      height + wrappedLineCount(line, PARTY_CHARACTERS_PER_LINE) * 13.05,
    0
  );
  return 17 + nameHeight + detailHeight + 28;
}

function firstPageRowBudget(model: InvoicePdfRenderModel): number {
  const partyHeight = Math.max(
    estimatedPartyHeight(model.sellerName, model.sellerLines),
    estimatedPartyHeight(model.customerName, model.customerLines)
  );
  return Math.max(
    0,
    FIRST_PAGE_ROW_BUDGET - Math.max(0, partyHeight - BASELINE_PARTY_HEIGHT)
  );
}

export function buildInvoicePdfPages(
  model: InvoicePdfRenderModel
): InvoicePdfRenderLine[][] {
  const pages: InvoicePdfRenderLine[][] = [];
  let currentPage: InvoicePdfRenderLine[] = [];
  let usedHeight = 0;
  let budget = firstPageRowBudget(model);

  for (const line of model.lines) {
    const rowHeight = estimatedRowHeight(line);
    if (pages.length === 0 && currentPage.length === 0 && rowHeight > budget) {
      pages.push([]);
      budget = CONTINUATION_PAGE_ROW_BUDGET;
    }
    if (rowHeight > CONTINUATION_PAGE_ROW_BUDGET) {
      throw new TypeError(
        'Invalid invoice document payload: a line exceeds the V1 page frame'
      );
    }
    if (currentPage.length > 0 && usedHeight + rowHeight > budget) {
      pages.push(currentPage);
      currentPage = [];
      usedHeight = 0;
      budget = CONTINUATION_PAGE_ROW_BUDGET;
    }
    currentPage.push(line);
    usedHeight += rowHeight;
  }
  if (currentPage.length > 0) pages.push(currentPage);

  const lastPage = pages.at(-1);
  if (!lastPage) return pages;

  const lastPageRowBudget =
    pages.length === 1
      ? firstPageRowBudget(model)
      : CONTINUATION_PAGE_ROW_BUDGET;
  const lastPageTotalsBudget = Math.max(
    0,
    lastPageRowBudget - TOTALS_HEIGHT_RESERVE
  );
  const lastPageHeight = lastPage.reduce(
    (total, line) => total + estimatedRowHeight(line),
    0
  );
  if (lastPageHeight <= lastPageTotalsBudget) return pages;

  const finalLine = lastPage.at(-1);
  if (!finalLine) return pages;
  const continuationTotalsBudget =
    CONTINUATION_PAGE_ROW_BUDGET - TOTALS_HEIGHT_RESERVE;
  if (estimatedRowHeight(finalLine) > continuationTotalsBudget) {
    pages.push([]);
    return pages;
  }

  lastPage.pop();
  if (lastPage.length === 0 && pages.length > 1) pages.pop();
  pages.push([finalLine]);

  return pages;
}

function TableHeader({
  model,
}: {
  model: InvoicePdfRenderModel;
}): ReactElement {
  return (
    <View style={styles.tableHeader}>
      <Text style={styles.descriptionColumn}>{model.tableHeaders[0]}</Text>
      <Text style={styles.quantityColumn}>{model.tableHeaders[1]}</Text>
      <Text style={styles.unitColumn}>{model.tableHeaders[2]}</Text>
      <Text style={styles.amountColumn}>{model.tableHeaders[3]}</Text>
    </View>
  );
}

function TableRows({ lines }: { lines: InvoicePdfRenderLine[] }): ReactElement {
  return (
    <>
      {lines.map((line, index) => (
        <View
          key={`${index}-${line.description}`}
          style={styles.tableRow}
          wrap={false}
        >
          <View style={styles.descriptionColumn}>
            <UnicodeText maxWordGraphemes={24} style={styles.description}>
              {line.description}
            </UnicodeText>
            {line.period ? (
              <UnicodeText maxWordGraphemes={24} style={styles.period}>
                {line.period}
              </UnicodeText>
            ) : null}
          </View>
          <Text style={styles.quantityColumn}>{line.quantity}</Text>
          <MoneyText style={styles.unitColumn}>{line.unitPrice}</MoneyText>
          <MoneyText style={styles.amountColumn}>{line.amount}</MoneyText>
        </View>
      ))}
    </>
  );
}

function Totals({ model }: { model: InvoicePdfRenderModel }): ReactElement {
  return (
    <View style={styles.totals} wrap={false}>
      <View style={styles.totalRow}>
        <Text style={styles.totalLabel}>{model.subtotalLabel}</Text>
        <MoneyText style={styles.totalValue}>{model.subtotal}</MoneyText>
      </View>
      {model.adjustmentsLabel && model.adjustments ? (
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>{model.adjustmentsLabel}</Text>
          <MoneyText style={styles.totalValue}>{model.adjustments}</MoneyText>
        </View>
      ) : null}
      <View style={styles.grandTotal}>
        <Text style={styles.totalLabel}>{model.invoiceTotalLabel}</Text>
        <MoneyText style={styles.totalValue}>{model.invoiceTotal}</MoneyText>
      </View>
    </View>
  );
}

function Footer({
  model,
  pageNumber,
  totalPages,
}: {
  model: InvoicePdfRenderModel;
  pageNumber: number;
  totalPages: number;
}): ReactElement {
  return (
    <>
      <View style={styles.footerSpacer} />
      <View style={styles.footerBar}>
        <Text style={styles.footer}>{model.footer}</Text>
        <Text style={styles.pageNumber}>
          {model.pageNumber(pageNumber, totalPages)}
        </Text>
      </View>
    </>
  );
}

function InvoicePdfDocument({
  model,
}: {
  model: InvoicePdfRenderModel;
}): ReactElement {
  const pages = buildInvoicePdfPages(model);

  return (
    <Document
      author={model.sellerName}
      creator="UsefulDesk"
      language="en"
      subject="Immutable non-tax invoice"
      title={model.metadataTitle}
    >
      {pages.map((lines, pageIndex) => {
        const firstPage = pageIndex === 0;
        const lastPage = pageIndex === pages.length - 1;

        return (
          <Page
            key={`invoice-page-${pageIndex + 1}`}
            size="A4"
            style={styles.page}
            wrap={false}
          >
            <View style={styles.topRule} />

            {firstPage ? (
              <>
                <View style={styles.headingRow} wrap={false}>
                  <View>
                    <Text style={styles.title}>{model.headline}</Text>
                    <Text style={styles.metadata}>{model.invoiceNumber}</Text>
                    <Text style={styles.metadata}>{model.issuedAt}</Text>
                  </View>
                  <View style={styles.totalHero}>
                    <Text style={styles.eyebrow}>
                      {model.invoiceTotalLabel}
                    </Text>
                    <MoneyText style={styles.heroAmount}>
                      {model.invoiceTotal}
                    </MoneyText>
                  </View>
                </View>

                <View style={styles.parties} wrap={false}>
                  <View style={styles.party}>
                    <Text style={styles.eyebrow}>{model.sellerLabel}</Text>
                    <UnicodeText maxWordGraphemes={18} style={styles.partyName}>
                      {model.sellerName}
                    </UnicodeText>
                    <PartyLines lines={model.sellerLines} />
                  </View>
                  <View style={styles.party}>
                    <Text style={styles.eyebrow}>{model.customerLabel}</Text>
                    <UnicodeText maxWordGraphemes={18} style={styles.partyName}>
                      {model.customerName}
                    </UnicodeText>
                    <PartyLines lines={model.customerLines} />
                  </View>
                </View>
              </>
            ) : (
              <View style={styles.continuationMetadata}>
                <Text>{model.metadataTitle}</Text>
                <Text>{model.issuedAt}</Text>
              </View>
            )}

            <View style={styles.table}>
              <TableHeader model={model} />
              <TableRows lines={lines} />
            </View>
            {lastPage ? <Totals model={model} /> : null}
            <Footer
              model={model}
              pageNumber={pageIndex + 1}
              totalPages={pages.length}
            />
          </Page>
        );
      })}
    </Document>
  );
}

export async function renderInvoicePdf(
  payload: InvoiceDocumentPayloadV1
): Promise<Buffer> {
  const model = buildInvoicePdfRenderModel(payload);
  return renderToBuffer(<InvoicePdfDocument model={model} />);
}
