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
  label: string
): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    fail(`${label} must be a non-empty string`);
  }
}

function assertNullableText(
  value: unknown,
  label: string
): asserts value is string | null {
  if (value !== null && typeof value !== 'string') {
    fail(`${label} must be a string or null`);
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
    assertNullableText(value[key], `${label}.${key}`);
  }
  for (const key of required) {
    assertRequiredText(value[key], `${label}.${key}`);
  }
}

function assertSeller(
  value: unknown
): asserts value is InvoiceDocumentSellerSnapshot {
  assertRecord(value, 'seller');
  assertExactKeys(value, SELLER_KEYS, 'seller');
  assertRequiredText(value.business_name, 'seller.business_name');
  assertNullableText(value.legal_name, 'seller.legal_name');
  assertNullableText(value.branch_name, 'seller.branch_name');
  assertNullableText(value.phone, 'seller.phone');
  assertNullableText(value.email, 'seller.email');
  assertAddress(value.address, 'seller.address', ['line1', 'city', 'country']);
}

function assertCustomer(
  value: unknown
): asserts value is InvoiceDocumentCustomerSnapshot {
  assertRecord(value, 'customer');
  assertExactKeys(value, CUSTOMER_KEYS, 'customer');
  assertRequiredText(value.customer_name, 'customer.customer_name');
  assertNullableText(value.member_number, 'customer.member_number');
  assertNullableText(value.phone, 'customer.phone');
  assertNullableText(value.email, 'customer.email');
  assertAddress(value.address, 'customer.address', []);
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
    assertRequiredText(line.description, `${label}.description`);
    assertNullableText(line.period, `${label}.period`);
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
