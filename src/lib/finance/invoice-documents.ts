export interface InvoiceDocumentAddress {
  line1: string | null;
  line2: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  country: string | null;
}

export interface InvoiceDocumentSellerSnapshot {
  business_name: string;
  legal_name: string | null;
  branch_name: string | null;
  phone: string | null;
  email: string | null;
  address: InvoiceDocumentAddress;
}

export interface InvoiceDocumentCustomerSnapshot {
  customer_name: string;
  member_number: string | null;
  phone: string | null;
  email: string | null;
  address: InvoiceDocumentAddress;
}

export interface InvoiceDocumentLineV1 {
  description: string;
  period: string | null;
  quantity: number;
  unit_amount_minor: number;
  amount_minor: number;
}

export interface InvoiceDocumentPayloadV1 {
  format_version: 1;
  invoice_number: string;
  issued_at: string;
  currency: string;
  seller: InvoiceDocumentSellerSnapshot;
  customer: InvoiceDocumentCustomerSnapshot;
  lines: readonly InvoiceDocumentLineV1[];
  subtotal_minor: number;
  adjustments_minor: number;
  total_minor: number;
}

export interface InvoiceDocumentReservation {
  outcome: 'ready' | 'generating' | 'claimed';
  document_id: string;
  document_status: 'generating' | 'ready' | 'failed';
  generation_token: string | null;
  payload_snapshot: unknown;
  storage_path: string;
  sha256: string | null;
  byte_count: number | null;
  last_error: string | null;
}

const MUTABLE_KEY_PARTS = new Set([
  'balance',
  'paid',
  'payment',
  'payments',
  'refund',
  'refunds',
  'credit',
  'credits',
  'contact',
  'contacts',
  'membership',
  'memberships',
  'profile',
  'profiles',
  'receipt',
  'receipts',
]);

const PAYLOAD_KEYS = [
  'format_version',
  'invoice_number',
  'issued_at',
  'currency',
  'seller',
  'customer',
  'lines',
  'subtotal_minor',
  'adjustments_minor',
  'total_minor',
] as const;

const SELLER_KEYS = [
  'business_name',
  'legal_name',
  'branch_name',
  'phone',
  'email',
  'address',
] as const;

const CUSTOMER_KEYS = [
  'customer_name',
  'member_number',
  'phone',
  'email',
  'address',
] as const;

const ADDRESS_KEYS = [
  'line1',
  'line2',
  'city',
  'state',
  'postal_code',
  'country',
] as const;

const LINE_KEYS = [
  'description',
  'period',
  'quantity',
  'unit_amount_minor',
  'amount_minor',
] as const;

const TEXT_LIMITS = {
  primaryName: 100,
  legalOrBranchName: 120,
  memberNumber: 80,
  phone: 80,
  email: 254,
  addressField: 140,
  lineDescription: 320,
  linePeriod: 120,
  partyCombined: 480,
} as const;

export type InvoiceDocumentFontFamily =
  | 'Noto Sans'
  | 'Noto Sans Extended'
  | 'Noto Sans Devanagari'
  | 'Noto Sans Bengali'
  | 'Noto Sans Gurmukhi'
  | 'Noto Sans Gujarati'
  | 'Noto Sans Oriya'
  | 'Noto Sans Tamil'
  | 'Noto Sans Telugu'
  | 'Noto Sans Kannada'
  | 'Noto Sans Malayalam';

type CodePointRange = readonly [start: number, end: number];

// Generated from fontkit characterSet values for the eleven registered regular
// WOFFs. Ranges exclude Cc/Cs/Cf/Cn and the existing pictographic exclusion.
// Overlaps are assigned to the first family that owns the code point.
const REGISTERED_FONT_CMAPS: readonly {
  family: InvoiceDocumentFontFamily;
  ranges: readonly CodePointRange[];
}[] = [
  {
    family: 'Noto Sans',
    ranges: [
      [0x20, 0x7e],
      [0xa0, 0xa8],
      [0xaa, 0xac],
      [0xaf, 0xff],
      [0x131, 0x131],
      [0x152, 0x153],
      [0x2bb, 0x2bc],
      [0x2c6, 0x2c6],
      [0x2da, 0x2da],
      [0x2dc, 0x2dc],
      [0x300, 0x301],
      [0x303, 0x304],
      [0x308, 0x309],
      [0x323, 0x323],
      [0x329, 0x329],
      [0x2002, 0x2002],
      [0x2009, 0x2009],
      [0x2013, 0x2014],
      [0x2018, 0x201a],
      [0x201c, 0x201e],
      [0x2022, 0x2022],
      [0x2026, 0x2026],
      [0x2032, 0x2033],
      [0x2039, 0x203a],
      [0x2044, 0x2044],
      [0x20ac, 0x20ac],
      [0x2212, 0x2212],
      [0xfffd, 0xfffd],
    ],
  },
  {
    family: 'Noto Sans Extended',
    ranges: [
      [0x100, 0x130],
      [0x132, 0x151],
      [0x154, 0x2ba],
      [0x2bd, 0x2c5],
      [0x2c7, 0x2cc],
      [0x2ce, 0x2d7],
      [0x2dd, 0x2ff],
      [0x1d00, 0x1dbf],
      [0x1e00, 0x1e9f],
      [0x1ef2, 0x1eff],
      [0x2020, 0x2020],
      [0x20a0, 0x20ab],
      [0x20ad, 0x20c0],
      [0x2113, 0x2113],
      [0x2c60, 0x2c7f],
      [0xa720, 0xa7ca],
      [0xa7d0, 0xa7d1],
      [0xa7d3, 0xa7d3],
      [0xa7d5, 0xa7d9],
      [0xa7f2, 0xa7ff],
    ],
  },
  {
    family: 'Noto Sans Devanagari',
    ranges: [
      [0x900, 0x97f],
      [0x1cd0, 0x1cf6],
      [0x1cf8, 0x1cf9],
      [0x20f0, 0x20f0],
      [0x25cc, 0x25cc],
      [0xa830, 0xa839],
      [0xa8e0, 0xa8ff],
      [0x11b00, 0x11b09],
    ],
  },
  {
    family: 'Noto Sans Bengali',
    ranges: [
      [0x980, 0x983],
      [0x985, 0x98c],
      [0x98f, 0x990],
      [0x993, 0x9a8],
      [0x9aa, 0x9b0],
      [0x9b2, 0x9b2],
      [0x9b6, 0x9b9],
      [0x9bc, 0x9c4],
      [0x9c7, 0x9c8],
      [0x9cb, 0x9ce],
      [0x9d7, 0x9d7],
      [0x9dc, 0x9dd],
      [0x9df, 0x9e3],
      [0x9e6, 0x9fe],
      [0x1cf7, 0x1cf7],
    ],
  },
  {
    family: 'Noto Sans Gurmukhi',
    ranges: [
      [0xa01, 0xa03],
      [0xa05, 0xa0a],
      [0xa0f, 0xa10],
      [0xa13, 0xa28],
      [0xa2a, 0xa30],
      [0xa32, 0xa33],
      [0xa35, 0xa36],
      [0xa38, 0xa39],
      [0xa3c, 0xa3c],
      [0xa3e, 0xa42],
      [0xa47, 0xa48],
      [0xa4b, 0xa4d],
      [0xa51, 0xa51],
      [0xa59, 0xa5c],
      [0xa5e, 0xa5e],
      [0xa66, 0xa76],
      [0x262c, 0x262c],
    ],
  },
  {
    family: 'Noto Sans Gujarati',
    ranges: [
      [0xa81, 0xa83],
      [0xa85, 0xa8d],
      [0xa8f, 0xa91],
      [0xa93, 0xaa8],
      [0xaaa, 0xab0],
      [0xab2, 0xab3],
      [0xab5, 0xab9],
      [0xabc, 0xac5],
      [0xac7, 0xac9],
      [0xacb, 0xacd],
      [0xad0, 0xad0],
      [0xae0, 0xae3],
      [0xae6, 0xaf1],
      [0xaf9, 0xaff],
    ],
  },
  {
    family: 'Noto Sans Oriya',
    ranges: [
      [0xb01, 0xb03],
      [0xb05, 0xb0c],
      [0xb0f, 0xb10],
      [0xb13, 0xb28],
      [0xb2a, 0xb30],
      [0xb32, 0xb33],
      [0xb35, 0xb39],
      [0xb3c, 0xb44],
      [0xb47, 0xb48],
      [0xb4b, 0xb4d],
      [0xb55, 0xb57],
      [0xb5c, 0xb5d],
      [0xb5f, 0xb63],
      [0xb66, 0xb77],
    ],
  },
  {
    family: 'Noto Sans Tamil',
    ranges: [
      [0xb82, 0xb83],
      [0xb85, 0xb8a],
      [0xb8e, 0xb90],
      [0xb92, 0xb95],
      [0xb99, 0xb9a],
      [0xb9c, 0xb9c],
      [0xb9e, 0xb9f],
      [0xba3, 0xba4],
      [0xba8, 0xbaa],
      [0xbae, 0xbb9],
      [0xbbe, 0xbc2],
      [0xbc6, 0xbc8],
      [0xbca, 0xbcd],
      [0xbd0, 0xbd0],
      [0xbd7, 0xbd7],
      [0xbe6, 0xbfa],
    ],
  },
  {
    family: 'Noto Sans Telugu',
    ranges: [
      [0xc00, 0xc0c],
      [0xc0e, 0xc10],
      [0xc12, 0xc28],
      [0xc2a, 0xc39],
      [0xc3c, 0xc44],
      [0xc46, 0xc48],
      [0xc4a, 0xc4d],
      [0xc55, 0xc56],
      [0xc58, 0xc5a],
      [0xc5d, 0xc5d],
      [0xc60, 0xc63],
      [0xc66, 0xc6f],
      [0xc77, 0xc7f],
    ],
  },
  {
    family: 'Noto Sans Kannada',
    ranges: [
      [0xc80, 0xc8c],
      [0xc8e, 0xc90],
      [0xc92, 0xca8],
      [0xcaa, 0xcb3],
      [0xcb5, 0xcb9],
      [0xcbc, 0xcc4],
      [0xcc6, 0xcc8],
      [0xcca, 0xccd],
      [0xcd5, 0xcd6],
      [0xcdd, 0xcde],
      [0xce0, 0xce3],
      [0xce6, 0xcef],
      [0xcf1, 0xcf3],
    ],
  },
  {
    family: 'Noto Sans Malayalam',
    ranges: [
      [0x307, 0x307],
      [0xd00, 0xd0c],
      [0xd0e, 0xd10],
      [0xd12, 0xd44],
      [0xd46, 0xd48],
      [0xd4a, 0xd4f],
      [0xd54, 0xd63],
      [0xd66, 0xd7f],
    ],
  },
];

export function invoiceDocumentFontFamilyForCodePoint(
  codePoint: number
): InvoiceDocumentFontFamily | null {
  for (const { family, ranges } of REGISTERED_FONT_CMAPS) {
    if (ranges.some(([start, end]) => codePoint >= start && codePoint <= end)) {
      return family;
    }
  }
  return null;
}

const documentTextSegmenter = new Intl.Segmenter('und', {
  granularity: 'grapheme',
});

function isIndianFontFamily(family: InvoiceDocumentFontFamily | null): boolean {
  return (
    family !== null && family !== 'Noto Sans' && family !== 'Noto Sans Extended'
  );
}

function hasSupportedIndicBase(grapheme: string): boolean {
  return Array.from(grapheme).some((character) => {
    if (!/[\p{L}\p{N}]/u.test(character)) return false;
    return isIndianFontFamily(
      invoiceDocumentFontFamilyForCodePoint(character.codePointAt(0) ?? -1)
    );
  });
}

function fail(message: string): never {
  throw new TypeError(`Invalid invoice document payload: ${message}`);
}

function assertRecord(
  value: unknown,
  label: string
): asserts value is Record<string, unknown> {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    fail(`${label} must be an object`);
  }
}

function assertExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  label: string
): void {
  const expected = new Set(keys);
  const unsupported = Object.keys(value).filter((key) => !expected.has(key));
  const missing = keys.filter(
    (key) => !Object.prototype.hasOwnProperty.call(value, key)
  );

  if (unsupported.length > 0) {
    fail(`${label} contains unsupported keys: ${unsupported.join(', ')}`);
  }
  if (missing.length > 0) {
    fail(`${label} is missing keys: ${missing.join(', ')}`);
  }
}

function assertNoMutableFacts(
  value: unknown,
  seen = new WeakSet<object>()
): void {
  if (value === null || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) assertNoMutableFacts(item, seen);
    return;
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    const keyParts = key.toLowerCase().split(/[^a-z0-9]+/);
    if (keyParts.some((part) => MUTABLE_KEY_PARTS.has(part))) {
      fail(`mutable or live fact key is not allowed: ${key}`);
    }
    assertNoMutableFacts(nestedValue, seen);
  }
}

function assertRequiredText(
  value: unknown,
  label: string,
  maxCodePoints: number
): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    fail(`${label} must be a non-empty string`);
  }
  assertRenderableText(value, label, maxCodePoints);
}

function assertNullableText(
  value: unknown,
  label: string,
  maxCodePoints: number
): asserts value is string | null {
  if (value !== null && typeof value !== 'string') {
    fail(`${label} must be a string or null`);
  }
  if (typeof value === 'string') {
    assertRenderableText(value, label, maxCodePoints);
  }
}

function assertRenderableText(
  value: string,
  label: string,
  maxCodePoints: number
): void {
  if (/\p{Cc}|\p{Cs}/u.test(value)) {
    fail(`${label} must not contain control characters`);
  }

  for (const { segment: grapheme } of documentTextSegmenter.segment(value)) {
    const indicJoinerContext = hasSupportedIndicBase(grapheme);
    for (const character of Array.from(grapheme)) {
      const codePoint = character.codePointAt(0) ?? -1;
      if (/\p{Cf}/u.test(character)) {
        if (
          (codePoint === 0x200c || codePoint === 0x200d) &&
          indicJoinerContext
        ) {
          continue;
        }
        fail(`${label} must not contain format control characters`);
      }
      if (
        invoiceDocumentFontFamilyForCodePoint(codePoint) === null ||
        /\p{Extended_Pictographic}/u.test(character)
      ) {
        fail(`${label} contains a script without a supported V1 font`);
      }
    }
  }
  if (Array.from(value).length > maxCodePoints) {
    fail(`${label} must contain at most ${maxCodePoints} code points`);
  }
}

function assertSafeMinorUnit(
  value: unknown,
  label: string,
  options: { nonNegative?: boolean } = {}
): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    fail(`${label} must be a safe integer minor-unit amount`);
  }
  if (options.nonNegative && value < 0) {
    fail(`${label} must not be negative`);
  }
}

function assertAddress(
  value: unknown,
  label: string,
  required: readonly ('line1' | 'city' | 'country')[]
): asserts value is InvoiceDocumentAddress {
  assertRecord(value, label);
  assertExactKeys(value, ADDRESS_KEYS, label);

  for (const key of ADDRESS_KEYS) {
    assertNullableText(value[key], `${label}.${key}`, TEXT_LIMITS.addressField);
  }
  for (const key of required) {
    assertRequiredText(value[key], `${label}.${key}`, TEXT_LIMITS.addressField);
  }
}

function combinedTextLength(values: readonly (string | null)[]): number {
  return values.reduce(
    (length, value) => length + (value ? Array.from(value).length : 0),
    0
  );
}

function addressValues(address: InvoiceDocumentAddress): (string | null)[] {
  return ADDRESS_KEYS.map((key) => address[key]);
}

function assertSeller(
  value: unknown
): asserts value is InvoiceDocumentSellerSnapshot {
  assertRecord(value, 'seller');
  assertExactKeys(value, SELLER_KEYS, 'seller');
  assertRequiredText(
    value.business_name,
    'seller.business_name',
    TEXT_LIMITS.primaryName
  );
  assertNullableText(
    value.legal_name,
    'seller.legal_name',
    TEXT_LIMITS.legalOrBranchName
  );
  assertNullableText(
    value.branch_name,
    'seller.branch_name',
    TEXT_LIMITS.legalOrBranchName
  );
  assertNullableText(value.phone, 'seller.phone', TEXT_LIMITS.phone);
  assertNullableText(value.email, 'seller.email', TEXT_LIMITS.email);
  assertAddress(value.address, 'seller.address', ['line1', 'city', 'country']);
  if (
    combinedTextLength([
      value.business_name,
      value.legal_name,
      value.branch_name,
      value.phone,
      value.email,
      ...addressValues(value.address),
    ]) > TEXT_LIMITS.partyCombined
  ) {
    fail(
      `seller combined text must contain at most ${TEXT_LIMITS.partyCombined} code points`
    );
  }
}

function assertCustomer(
  value: unknown
): asserts value is InvoiceDocumentCustomerSnapshot {
  assertRecord(value, 'customer');
  assertExactKeys(value, CUSTOMER_KEYS, 'customer');
  assertRequiredText(
    value.customer_name,
    'customer.customer_name',
    TEXT_LIMITS.primaryName
  );
  assertNullableText(
    value.member_number,
    'customer.member_number',
    TEXT_LIMITS.memberNumber
  );
  assertNullableText(value.phone, 'customer.phone', TEXT_LIMITS.phone);
  assertNullableText(value.email, 'customer.email', TEXT_LIMITS.email);
  assertAddress(value.address, 'customer.address', []);
  if (
    combinedTextLength([
      value.customer_name,
      value.member_number,
      value.phone,
      value.email,
      ...addressValues(value.address),
    ]) > TEXT_LIMITS.partyCombined
  ) {
    fail(
      `customer combined text must contain at most ${TEXT_LIMITS.partyCombined} code points`
    );
  }
}

function isIsoCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

export function invoiceDocumentFilename(number: string): string {
  const safeNumber = number
    .normalize('NFKD')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 80);

  return `invoice-${safeNumber || 'document'}.pdf`;
}

export function invoiceDocumentRoute(id: string): string {
  return `/api/invoices/${encodeURIComponent(id)}/document`;
}

export function assertInvoiceDocumentPayload(
  value: unknown
): asserts value is InvoiceDocumentPayloadV1 {
  assertNoMutableFacts(value);
  assertRecord(value, 'payload');
  assertExactKeys(value, PAYLOAD_KEYS, 'payload');

  if (value.format_version !== 1) {
    fail('format_version must be 1');
  }
  if (
    typeof value.invoice_number !== 'string' ||
    !/^INV-\d{6,}$/.test(value.invoice_number)
  ) {
    fail('invoice_number must match INV-000001');
  }
  if (
    typeof value.issued_at !== 'string' ||
    !isIsoCalendarDate(value.issued_at)
  ) {
    fail('issued_at must be a valid YYYY-MM-DD date');
  }
  if (
    typeof value.currency !== 'string' ||
    !/^[A-Z]{3}$/.test(value.currency)
  ) {
    fail('currency must be an uppercase three-letter code');
  }

  assertSeller(value.seller);
  assertCustomer(value.customer);

  if (!Array.isArray(value.lines) || value.lines.length === 0) {
    fail('lines must be a non-empty array');
  }

  let lineSum = 0;
  for (const [index, line] of value.lines.entries()) {
    const label = `lines[${index}]`;
    assertRecord(line, label);
    assertExactKeys(line, LINE_KEYS, label);
    assertRequiredText(
      line.description,
      `${label}.description`,
      TEXT_LIMITS.lineDescription
    );
    assertNullableText(line.period, `${label}.period`, TEXT_LIMITS.linePeriod);
    if (
      typeof line.quantity !== 'number' ||
      !Number.isFinite(line.quantity) ||
      line.quantity <= 0
    ) {
      fail(`${label}.quantity must be a positive finite number`);
    }
    assertSafeMinorUnit(line.unit_amount_minor, `${label}.unit_amount_minor`, {
      nonNegative: true,
    });
    assertSafeMinorUnit(line.amount_minor, `${label}.amount_minor`, {
      nonNegative: true,
    });
    lineSum += line.amount_minor;
    if (!Number.isSafeInteger(lineSum)) {
      fail('line amounts exceed the safe integer range');
    }
  }

  assertSafeMinorUnit(value.subtotal_minor, 'subtotal_minor', {
    nonNegative: true,
  });
  assertSafeMinorUnit(value.adjustments_minor, 'adjustments_minor');
  assertSafeMinorUnit(value.total_minor, 'total_minor', { nonNegative: true });

  if (lineSum !== value.subtotal_minor) {
    fail('line amounts must reconcile to subtotal_minor');
  }
  const reconciledTotal = value.subtotal_minor + value.adjustments_minor;
  if (!Number.isSafeInteger(reconciledTotal)) {
    fail('subtotal plus adjustments exceeds the safe integer range');
  }
  if (reconciledTotal !== value.total_minor) {
    fail('subtotal_minor plus adjustments_minor must equal total_minor');
  }
}
