import 'server-only';

import { createHash } from 'node:crypto';
import {
  createClient as createSupabaseClient,
  type SupabaseClient,
} from '@supabase/supabase-js';

import {
  assertInvoiceDocumentPayload,
  type InvoiceDocumentPayloadV1,
  type InvoiceDocumentReservation,
} from './invoice-documents';
import { renderInvoicePdf } from './invoice-pdf';

const BUCKET = 'invoice-documents';
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface ErrorResult {
  message: string;
  code?: string;
}

interface DependencyResult<T> {
  data: T | null;
  error: ErrorResult | null;
}

interface FinalizeInput {
  invoiceId: string;
  generationToken: string;
  sha256: string;
  byteCount: number;
}

interface FailInput {
  invoiceId: string;
  generationToken: string;
  error: string;
}

type StoredBytes = Blob | ArrayBuffer | Uint8Array;

export interface InvoiceDocumentServiceDependencies {
  reserve(invoiceId: string): Promise<DependencyResult<unknown>>;
  finalize(input: FinalizeInput): Promise<DependencyResult<unknown>>;
  fail(input: FailInput): Promise<DependencyResult<unknown>>;
  download(path: string): Promise<DependencyResult<StoredBytes>>;
  upload(
    path: string,
    bytes: Uint8Array,
    options: { contentType: 'application/pdf'; upsert: false }
  ): Promise<DependencyResult<unknown>>;
  remove(paths: string[]): Promise<DependencyResult<unknown>>;
  render(payload: InvoiceDocumentPayloadV1): Promise<Buffer>;
  hash(bytes: Uint8Array): Promise<string>;
}

export interface EnsureInvoiceDocumentInput {
  accountId: string;
  invoiceId: string;
  userId: string;
}

export interface ReadyInvoiceDocument {
  documentId: string;
  invoiceId: string;
  invoiceNumber: string;
  storagePath: string;
  sha256: string;
  byteCount: number;
  bytes: Uint8Array;
}

export class InvoiceDocumentConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvoiceDocumentConflictError';
  }
}

export class InvoiceDocumentPreparingError extends InvoiceDocumentConflictError {
  readonly retryable = true;

  constructor(
    message = 'Invoice document generation is already in progress. Please retry shortly.'
  ) {
    super(message);
    this.name = 'InvoiceDocumentPreparingError';
  }
}

export class InvoiceDocumentIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvoiceDocumentIntegrityError';
  }
}

export class InvoiceDocumentOrchestrationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'InvoiceDocumentOrchestrationError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function externalError(result: DependencyResult<unknown>, operation: string) {
  if (!result.error) return;
  if (result.error.code === '22023') {
    throw new InvoiceDocumentConflictError(result.error.message);
  }
  throw new Error(result.error.message || `${operation} failed`);
}

function oneRow(result: DependencyResult<unknown>, operation: string): unknown {
  externalError(result, operation);
  if (!Array.isArray(result.data) || result.data.length !== 1) {
    throw new InvoiceDocumentOrchestrationError(
      `${operation} returned an invalid zero-or-multiple-row result.`
    );
  }
  return result.data[0];
}

function parseReservation(result: DependencyResult<unknown>) {
  const value = oneRow(result, 'Invoice document reservation');
  if (!isRecord(value)) {
    throw new InvoiceDocumentOrchestrationError(
      'Invoice document reservation result is malformed.'
    );
  }

  const outcome = value.outcome;
  const status = value.document_status;
  if (
    (outcome !== 'ready' &&
      outcome !== 'generating' &&
      outcome !== 'claimed') ||
    (status !== 'ready' && status !== 'generating' && status !== 'failed') ||
    typeof value.document_id !== 'string' ||
    !UUID_PATTERN.test(value.document_id) ||
    typeof value.storage_path !== 'string' ||
    !Object.prototype.hasOwnProperty.call(value, 'payload_snapshot') ||
    !Object.prototype.hasOwnProperty.call(value, 'generation_token') ||
    !Object.prototype.hasOwnProperty.call(value, 'sha256') ||
    !Object.prototype.hasOwnProperty.call(value, 'byte_count') ||
    !Object.prototype.hasOwnProperty.call(value, 'last_error')
  ) {
    throw new InvoiceDocumentOrchestrationError(
      'Invoice document reservation result is malformed.'
    );
  }
  if (outcome === 'ready' && status !== 'ready') {
    throw new InvoiceDocumentOrchestrationError(
      'Invoice document reservation result has inconsistent ready state.'
    );
  }
  if (outcome !== 'ready' && status !== 'generating') {
    throw new InvoiceDocumentOrchestrationError(
      'Invoice document reservation result has inconsistent lease state.'
    );
  }

  return value as unknown as InvoiceDocumentReservation;
}

function validateReservationAccountScope(
  reservation: InvoiceDocumentReservation,
  input: EnsureInvoiceDocumentInput
) {
  const expectedPrefix = `account-${input.accountId}/${input.invoiceId}/invoice-`;
  if (
    !reservation.storage_path.startsWith(expectedPrefix) ||
    !reservation.storage_path.endsWith('.pdf')
  ) {
    throw new InvoiceDocumentOrchestrationError(
      'Invoice document reservation returned an out-of-scope storage path.'
    );
  }
}

function validateReservationScope(
  reservation: InvoiceDocumentReservation,
  input: EnsureInvoiceDocumentInput,
  payload: InvoiceDocumentPayloadV1
) {
  const expectedPath =
    `account-${input.accountId}/${input.invoiceId}/` +
    `invoice-${payload.invoice_number}.pdf`;
  if (reservation.storage_path !== expectedPath) {
    throw new InvoiceDocumentOrchestrationError(
      'Invoice document reservation returned an out-of-scope storage path.'
    );
  }
}

function parseReadyMetadata(
  reservation: InvoiceDocumentReservation,
  input: EnsureInvoiceDocumentInput,
  payload: InvoiceDocumentPayloadV1
) {
  validateReservationScope(reservation, input, payload);
  if (
    typeof reservation.sha256 !== 'string' ||
    !SHA256_PATTERN.test(reservation.sha256) ||
    typeof reservation.byte_count !== 'number' ||
    !Number.isSafeInteger(reservation.byte_count) ||
    reservation.byte_count <= 0
  ) {
    throw new InvoiceDocumentOrchestrationError(
      'Invoice document ready metadata is malformed.'
    );
  }
  return {
    sha256: reservation.sha256,
    byteCount: reservation.byte_count,
  };
}

function parseGenerationToken(reservation: InvoiceDocumentReservation) {
  if (
    typeof reservation.generation_token !== 'string' ||
    !UUID_PATTERN.test(reservation.generation_token)
  ) {
    throw new InvoiceDocumentOrchestrationError(
      'Invoice document claimed lease has no generation token.'
    );
  }
  return reservation.generation_token;
}

async function toBytes(value: StoredBytes): Promise<Uint8Array> {
  if (value instanceof Blob) {
    return new Uint8Array(await value.arrayBuffer());
  }
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  if (value instanceof Uint8Array) return Uint8Array.from(value);
  throw new InvoiceDocumentIntegrityError(
    'Invoice document Storage returned an unsupported object body.'
  );
}

function boundedOperatorError(error: unknown): string {
  const message =
    error instanceof Error && error.message.trim()
      ? error.message.trim()
      : 'Document generation failed.';
  return Array.from(message).slice(0, 500).join('');
}

function validateFinalizedRow(
  result: DependencyResult<unknown>,
  input: EnsureInvoiceDocumentInput,
  reservation: InvoiceDocumentReservation,
  generationToken: string,
  sha256: string,
  byteCount: number
) {
  const value = oneRow(result, 'Invoice document finalization');
  if (
    !isRecord(value) ||
    value.id !== reservation.document_id ||
    value.account_id !== input.accountId ||
    value.invoice_id !== input.invoiceId ||
    value.status !== 'ready' ||
    value.storage_path !== reservation.storage_path ||
    value.generation_token !== generationToken ||
    value.sha256 !== sha256 ||
    value.byte_count !== byteCount ||
    value.format_version !== 1 ||
    typeof value.generated_at !== 'string'
  ) {
    throw new InvoiceDocumentOrchestrationError(
      'Invoice document finalization result is malformed.'
    );
  }
}

function validateFailedRow(
  result: DependencyResult<unknown>,
  input: EnsureInvoiceDocumentInput,
  reservation: InvoiceDocumentReservation,
  generationToken: string
) {
  const value = oneRow(result, 'Record document generation failure');
  if (
    !isRecord(value) ||
    value.id !== reservation.document_id ||
    value.account_id !== input.accountId ||
    value.invoice_id !== input.invoiceId ||
    value.status !== 'failed' ||
    value.generation_token !== generationToken ||
    typeof value.last_error !== 'string' ||
    value.last_error.length === 0 ||
    Array.from(value.last_error).length > 500
  ) {
    throw new InvoiceDocumentOrchestrationError(
      'Record document generation failure returned a malformed result.'
    );
  }
}

export function createInvoiceDocumentService(
  dependencies: InvoiceDocumentServiceDependencies
) {
  return {
    async ensure(
      input: EnsureInvoiceDocumentInput
    ): Promise<ReadyInvoiceDocument> {
      const reservation = parseReservation(
        await dependencies.reserve(input.invoiceId)
      );
      validateReservationAccountScope(reservation, input);

      if (reservation.outcome === 'generating') {
        assertInvoiceDocumentPayload(reservation.payload_snapshot);
        validateReservationScope(
          reservation,
          input,
          reservation.payload_snapshot
        );
        throw new InvoiceDocumentPreparingError();
      }

      if (reservation.outcome === 'ready') {
        assertInvoiceDocumentPayload(reservation.payload_snapshot);
        const payload = reservation.payload_snapshot;
        const metadata = parseReadyMetadata(reservation, input, payload);
        const downloaded = await dependencies.download(
          reservation.storage_path
        );
        if (downloaded.error || downloaded.data === null) {
          throw new InvoiceDocumentIntegrityError(
            `Ready invoice document object is missing at ${reservation.storage_path}.`
          );
        }
        const readyBytes = await toBytes(downloaded.data);
        const readyHash = await dependencies.hash(readyBytes);
        if (
          readyBytes.byteLength !== metadata.byteCount ||
          readyHash !== metadata.sha256
        ) {
          throw new InvoiceDocumentIntegrityError(
            `Ready invoice document object failed its stored integrity check at ${reservation.storage_path}.`
          );
        }
        return {
          documentId: reservation.document_id,
          invoiceId: input.invoiceId,
          invoiceNumber: payload.invoice_number,
          storagePath: reservation.storage_path,
          sha256: metadata.sha256,
          byteCount: metadata.byteCount,
          bytes: readyBytes,
        };
      }

      const generationToken = parseGenerationToken(reservation);
      let uploaded = false;
      try {
        assertInvoiceDocumentPayload(reservation.payload_snapshot);
        const payload = reservation.payload_snapshot;
        validateReservationScope(reservation, input, payload);
        const rendered = Uint8Array.from(await dependencies.render(payload));
        if (rendered.byteLength === 0) {
          throw new Error('Invoice PDF renderer returned an empty document.');
        }
        const sha256 = await dependencies.hash(rendered);
        if (!SHA256_PATTERN.test(sha256)) {
          throw new Error('Invoice PDF hashing returned an invalid checksum.');
        }
        const upload = await dependencies.upload(
          reservation.storage_path,
          rendered,
          { contentType: 'application/pdf', upsert: false }
        );
        externalError(upload, 'Invoice document upload');
        uploaded = true;

        const finalized = await dependencies.finalize({
          invoiceId: input.invoiceId,
          generationToken,
          sha256,
          byteCount: rendered.byteLength,
        });
        validateFinalizedRow(
          finalized,
          input,
          reservation,
          generationToken,
          sha256,
          rendered.byteLength
        );

        return {
          documentId: reservation.document_id,
          invoiceId: input.invoiceId,
          invoiceNumber: payload.invoice_number,
          storagePath: reservation.storage_path,
          sha256,
          byteCount: rendered.byteLength,
          bytes: rendered,
        };
      } catch (error) {
        try {
          validateFailedRow(
            await dependencies.fail({
              invoiceId: input.invoiceId,
              generationToken,
              error: boundedOperatorError(error),
            }),
            input,
            reservation,
            generationToken
          );
        } catch (failureError) {
          throw new InvoiceDocumentOrchestrationError(
            'Could not record document generation failure for the claimed lease.',
            { cause: failureError }
          );
        }

        // A successful token-bound fail proves this lease did not finalize.
        // Only then is an object uploaded by this attempt safe to remove; an
        // ambiguous finalize response may conceal a committed ready row.
        if (uploaded) {
          const cleanup = await dependencies.remove([reservation.storage_path]);
          if (cleanup.error) {
            console.error(
              '[invoice document] failed to remove unfinalized object:',
              cleanup.error.message
            );
          }
        }
        throw error;
      }
    },
  };
}

let adminClient: SupabaseClient | null = null;

function getAdminClient(): SupabaseClient {
  if (!adminClient) {
    adminClient = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
          detectSessionInUrl: false,
        },
      }
    );
  }
  return adminClient;
}

function defaultDependencies(): InvoiceDocumentServiceDependencies {
  return {
    async reserve(invoiceId) {
      return getAdminClient().rpc('reserve_invoice_document', {
        p_invoice_id: invoiceId,
      });
    },
    async finalize(input) {
      return getAdminClient().rpc('finalize_invoice_document', {
        p_invoice_id: input.invoiceId,
        p_generation_token: input.generationToken,
        p_sha256: input.sha256,
        p_byte_count: input.byteCount,
      });
    },
    async fail(input) {
      return getAdminClient().rpc('fail_invoice_document', {
        p_invoice_id: input.invoiceId,
        p_generation_token: input.generationToken,
        p_error: input.error,
      });
    },
    async download(path) {
      return getAdminClient().storage.from(BUCKET).download(path);
    },
    async upload(path, value, options) {
      return getAdminClient().storage.from(BUCKET).upload(path, value, options);
    },
    async remove(paths) {
      return getAdminClient().storage.from(BUCKET).remove(paths);
    },
    render: renderInvoicePdf,
    async hash(value) {
      return createHash('sha256').update(value).digest('hex');
    },
  };
}

export async function ensureInvoiceDocument(
  input: EnsureInvoiceDocumentInput
): Promise<ReadyInvoiceDocument> {
  // The route must finish its account-scoped browser-client lookup before it
  // calls this function. The service-role client remains lazy until reserve.
  return createInvoiceDocumentService(defaultDependencies()).ensure(input);
}
