import { type MemberImportCandidate } from './member-import-candidates';

interface RpcResult {
  data: unknown;
  error: unknown;
}

export interface MemberImportTransactionOptions {
  accountId: string;
  /** The private draft UUID. It scopes the database idempotency contract. */
  importJobId: string;
  rpc: (
    functionName: string,
    args: { p_payload: Record<string, unknown> }
  ) => PromiseLike<RpcResult>;
  paidAt: (date: string) => string;
  /**
   * Durable journal from the private draft. A checkpoint's payload is the
   * exact object sent to the RPC; it is deliberately never rebuilt on retry.
   */
  checkpoints?: MemberImportTransactionCheckpoint[];
  checkpoint?: (
    checkpoint: MemberImportTransactionCheckpoint
  ) => Promise<boolean>;
  /** Persist and size-check every exact pending payload before any RPC. */
  prepare?: (
    checkpoints: MemberImportTransactionCheckpoint[]
  ) => Promise<boolean>;
  onProgress?: (completed: number, total: number, label: string) => void;
}

export type MemberImportTransactionGroupStatus =
  'imported' | 'failed' | 'uncertain';

export interface MemberImportTransactionGroupResult {
  customerGroupKey: string;
  sourceKeys: string[];
  status: MemberImportTransactionGroupStatus;
  contactId: string | null;
  membershipId: string | null;
  rows: unknown[];
  error: string | null;
}

/** One immutable, author-private execution checkpoint per customer group. */
export interface MemberImportTransactionCheckpoint {
  customerGroupKey: string;
  sourceKeys: string[];
  payload: Record<string, unknown>;
  status: 'pending' | MemberImportTransactionGroupStatus;
  result: MemberImportTransactionGroupResult | null;
}

export interface MemberImportTransactionResult {
  groups: MemberImportTransactionGroupResult[];
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  if (
    error &&
    typeof error === 'object' &&
    'message' in error &&
    typeof error.message === 'string'
  ) {
    return error.message;
  }
  return 'This member and their purchases could not be imported.';
}

function importedContact(candidate: MemberImportCandidate) {
  const profile = candidate.built.contact;
  const mappedProfile = Object.fromEntries(
    Object.entries(profile).filter(([, value]) => value !== null)
  );
  return {
    id: candidate.existingMatch?.contactId ?? null,
    phone: candidate.draftValues.phone,
    ...(candidate.built.assignedTo
      ? { assigned_to: candidate.built.assignedTo }
      : {}),
    ...(candidate.built.churnRisk !== null
      ? { churn_risk: candidate.built.churnRisk }
      : {}),
    use_csv: candidate.resolutions.existingContact === 'use_csv',
    ...mappedProfile,
  };
}

function importedRow(
  candidate: MemberImportCandidate,
  paidAt: MemberImportTransactionOptions['paidAt']
) {
  const membership =
    candidate.membershipComponent?.included && candidate.built.membership
      ? {
          plan_id: candidate.built.membership.plan_id,
          pricing_option_id: candidate.built.membership.pricing_option_id,
          start_date: candidate.built.membership.start_date,
          end_date: candidate.built.membership.end_date,
          status: candidate.built.membership.status,
          frozen_at: candidate.built.membership.frozen_at,
          fee_amount: candidate.built.membership.fee_amount,
          list_price: candidate.built.membership.list_price,
          discount_type: candidate.built.membership.discount_type,
          discount_value: candidate.built.membership.discount_value,
          discount_amount: candidate.built.membership.discount_amount,
          historical_price: candidate.built.membership.historical_price,
          notes: candidate.built.membership.notes,
        }
      : null;
  const service = candidate.serviceComponent?.intent;
  const payment = candidate.built.payment;
  const accounting = candidate.accounting;
  return {
    source_key: candidate.sourceKey,
    source_row: candidate.sourceRow,
    idempotency_key: candidate.purchaseIdempotencyKey,
    total: accounting?.total ?? 0,
    amount_paid: accounting?.amountPaid ?? 0,
    balance: accounting?.balance ?? 0,
    payment_method: payment?.method ?? 'cash',
    paid_at: payment ? paidAt(payment.paidOn) : null,
    ...(candidate.resolutions.cancelledDebt
      ? { cancellation_debt: candidate.resolutions.cancelledDebt }
      : {}),
    membership,
    service: service
      ? {
          item_id: service.itemId,
          option_id: service.optionId,
          trainer_id: service.trainerId,
          start_date: service.startDate,
          end_date: service.endDate,
          sold_amount: service.soldAmount,
          list_amount: service.listAmount,
          discount_amount: service.discountAmount,
          status: service.status === 'cancelled' ? 'cancelled' : 'active',
          explicit_price: service.explicitPrice,
          explicit_end_date: service.explicitEndDate,
        }
      : null,
  };
}

function groupCandidates(
  candidates: MemberImportCandidate[],
  checkpoints: Map<string, MemberImportTransactionCheckpoint>
) {
  const groups = new Map<string, MemberImportCandidate[]>();
  const journalOwnedSourceKeys = new Set(
    [...checkpoints.values()].flatMap((checkpoint) => checkpoint.sourceKeys)
  );
  for (const candidate of candidates) {
    // A checkpoint owns these source rows. Never form a fresh group from an
    // edited or newly matched version beside its exact saved retry payload.
    if (journalOwnedSourceKeys.has(candidate.sourceKey)) continue;
    if (candidate.disposition !== 'included' || !candidate.isReady) continue;
    groups.set(candidate.customerGroupKey, [
      ...(groups.get(candidate.customerGroupKey) ?? []),
      candidate,
    ]);
  }
  // Resume an already attempted group even if a fresh lookup now marks its
  // contact as a member. The durable payload, not a rebuilt candidate, owns
  // that replay decision.
  for (const checkpoint of checkpoints.values()) {
    const rows = candidates.filter((candidate) =>
      checkpoint.sourceKeys.includes(candidate.sourceKey)
    );
    if (rows.length > 0) groups.set(checkpoint.customerGroupKey, rows);
  }
  return [...groups.entries()]
    .map(
      ([key, rows]) =>
        [key, rows.sort((a, b) => a.sourceRow - b.sourceRow)] as const
    )
    .sort(([, a], [, b]) => a[0].sourceRow - b[0].sourceRow);
}

function isDefiniteRpcError(error: unknown): boolean {
  if (
    !error ||
    typeof error !== 'object' ||
    !('code' in error) ||
    typeof error.code !== 'string'
  ) {
    return false;
  }
  // Only errors which PostgreSQL necessarily raises while rejecting the
  // statement are safe to offer as a corrected retry. Connection failures
  // (08xxx) and completion-unknown (40003) can happen after a commit.
  const code = error.code;
  return (
    code === 'P0001' ||
    code === '42501' ||
    code.startsWith('22') ||
    code.startsWith('23')
  );
}

function responseForRows(
  data: unknown,
  sourceKeys: string[]
): { contactId: string; membershipId: string | null; rows: unknown[] } | null {
  if (!data || typeof data !== 'object') return null;
  const response = data as {
    contact_id?: unknown;
    membership_id?: unknown;
    rows?: unknown;
  };
  if (
    typeof response.contact_id !== 'string' ||
    !response.contact_id ||
    !Array.isArray(response.rows)
  ) {
    return null;
  }
  const returnedKeys = new Set<string>();
  for (const row of response.rows) {
    if (
      !row ||
      typeof row !== 'object' ||
      typeof row.source_key !== 'string' ||
      row.status !== 'imported' ||
      (row.membership_id != null && typeof row.membership_id !== 'string') ||
      (row.invoice_id != null && typeof row.invoice_id !== 'string') ||
      returnedKeys.has(row.source_key)
    ) {
      return null;
    }
    returnedKeys.add(row.source_key);
  }
  if (
    returnedKeys.size !== sourceKeys.length ||
    sourceKeys.some((sourceKey) => !returnedKeys.has(sourceKey))
  ) {
    return null;
  }
  return {
    contactId: response.contact_id,
    membershipId:
      typeof response.membership_id === 'string'
        ? response.membership_id
        : null,
    rows: response.rows,
  };
}

function newCheckpoint(
  customerGroupKey: string,
  rows: MemberImportCandidate[],
  options: MemberImportTransactionOptions
): MemberImportTransactionCheckpoint {
  const first = rows[0];
  return {
    customerGroupKey,
    sourceKeys: rows.map((candidate) => candidate.sourceKey),
    payload: {
      account_id: options.accountId,
      import_job_id: options.importJobId,
      idempotency_key: first.customerIdempotencyKey,
      contact: importedContact(first),
      rows: rows.map((candidate) => importedRow(candidate, options.paidAt)),
    },
    status: 'pending',
    result: null,
  };
}

export async function commitMemberImportGroups(
  candidates: MemberImportCandidate[],
  options: MemberImportTransactionOptions
): Promise<MemberImportTransactionResult> {
  if (!options.importJobId.trim()) {
    throw new Error(
      'A saved import draft is required before importing members.'
    );
  }
  const checkpointByGroup = new Map(
    (options.checkpoints ?? []).map((checkpoint) => [
      checkpoint.customerGroupKey,
      checkpoint,
    ])
  );
  const groups = groupCandidates(candidates, checkpointByGroup);
  const prepared = new Map<string, MemberImportTransactionCheckpoint>();
  for (const [customerGroupKey, rows] of groups) {
    const saved = checkpointByGroup.get(customerGroupKey);
    if (!saved || saved.status !== 'imported') {
      prepared.set(
        customerGroupKey,
        saved
          ? { ...saved, status: 'pending', result: null }
          : newCheckpoint(customerGroupKey, rows, options)
      );
    }
  }
  if (options.prepare && !(await options.prepare([...prepared.values()]))) {
    throw new Error(
      'Could not save every import checkpoint. No member was sent for this import.'
    );
  }
  const results: MemberImportTransactionGroupResult[] = [];
  for (const [customerGroupKey] of groups) {
    const saved = checkpointByGroup.get(customerGroupKey);
    if (saved?.status === 'imported' && saved.result) {
      results.push(saved.result);
      options.onProgress?.(
        results.length,
        groups.length,
        `Processed ${results.length} of ${groups.length} members`
      );
      continue;
    }

    let checkpoint = prepared.get(customerGroupKey)!;
    if (options.checkpoint && !(await options.checkpoint(checkpoint))) {
      // This sits outside the RPC try/catch. A draft that did not acknowledge
      // the exact payload must stop the import instead of being labelled an
      // unknown outcome; the request has not left this client.
      throw new Error(
        'Could not save this import checkpoint. No member was sent for this group.'
      );
    }

    try {
      const payload = checkpoint.payload;
      const { data, error } = await options.rpc('perform_member_import_group', {
        p_payload: payload,
      });
      const response = responseForRows(data, checkpoint.sourceKeys);
      const group: MemberImportTransactionGroupResult =
        error && isDefiniteRpcError(error)
          ? {
              customerGroupKey,
              sourceKeys: checkpoint.sourceKeys,
              status: 'failed',
              contactId: null,
              membershipId: null,
              rows: [],
              error: errorMessage(error),
            }
          : response
            ? {
                customerGroupKey,
                sourceKeys: checkpoint.sourceKeys,
                status: 'imported',
                contactId: response.contactId,
                membershipId: response.membershipId,
                rows: response.rows,
                error: null,
              }
            : {
                customerGroupKey,
                sourceKeys: checkpoint.sourceKeys,
                status: 'uncertain',
                contactId: null,
                membershipId: null,
                rows: [],
                error: errorMessage(error),
              };
      checkpoint = { ...checkpoint, status: group.status, result: group };
      if (options.checkpoint && !(await options.checkpoint(checkpoint))) {
        throw new Error('Could not save the import result checkpoint.');
      }
      results.push(group);
    } catch (error) {
      const group: MemberImportTransactionGroupResult = {
        customerGroupKey,
        sourceKeys: checkpoint.sourceKeys,
        status: 'uncertain',
        contactId: null,
        membershipId: null,
        rows: [],
        error: errorMessage(error),
      };
      checkpoint = { ...checkpoint, status: 'uncertain', result: group };
      if (options.checkpoint) await options.checkpoint(checkpoint);
      results.push(group);
    }
    options.onProgress?.(
      results.length,
      groups.length,
      `Processed ${results.length} of ${groups.length} members`
    );
  }
  return { groups: results };
}
