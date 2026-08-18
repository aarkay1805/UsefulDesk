import { parseMoney } from './import-commit';
import {
  effectiveBalance,
  type MemberImportCandidate,
} from './member-import-candidates';

interface RpcResult {
  data: unknown;
  error: unknown;
}

export interface MemberImportTransactionOptions {
  accountId: string;
  rpc: (
    functionName: string,
    args: { p_payload: Record<string, unknown> }
  ) => PromiseLike<RpcResult>;
  paidAt: (date: string) => string;
  onProgress?: (completed: number, total: number, label: string) => void;
}

export interface MemberImportTransactionGroupResult {
  customerGroupKey: string;
  sourceKeys: string[];
  status: 'imported' | 'failed';
  contactId: string | null;
  membershipId: string | null;
  rows: unknown[];
  error: string | null;
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
  return 'The customer group could not be imported.';
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
          notes: candidate.built.membership.notes,
        }
      : null;
  const service = candidate.serviceComponent?.intent;
  const payment = candidate.built.payment;
  const balance = parseMoney(effectiveBalance(candidate.draftValues) ?? '');
  return {
    source_key: candidate.sourceKey,
    source_row: candidate.sourceRow,
    idempotency_key: candidate.purchaseIdempotencyKey,
    total: candidate.purchaseTotal ?? 0,
    amount_paid: payment?.amount ?? 0,
    balance,
    payment_method: payment?.method ?? 'cash',
    paid_at: payment ? paidAt(payment.paidOn) : null,
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

function groupCandidates(candidates: MemberImportCandidate[]) {
  const groups = new Map<string, MemberImportCandidate[]>();
  for (const candidate of candidates) {
    if (candidate.disposition !== 'included' || !candidate.isReady) continue;
    groups.set(candidate.customerGroupKey, [
      ...(groups.get(candidate.customerGroupKey) ?? []),
      candidate,
    ]);
  }
  return [...groups.entries()]
    .map(
      ([key, rows]) =>
        [key, rows.sort((a, b) => a.sourceRow - b.sourceRow)] as const
    )
    .sort(([, a], [, b]) => a[0].sourceRow - b[0].sourceRow);
}

export async function commitMemberImportGroups(
  candidates: MemberImportCandidate[],
  options: MemberImportTransactionOptions
): Promise<MemberImportTransactionResult> {
  const groups = groupCandidates(candidates);
  const results: MemberImportTransactionGroupResult[] = [];
  for (const [customerGroupKey, rows] of groups) {
    const first = rows[0];
    const payload = {
      account_id: options.accountId,
      idempotency_key: first.customerIdempotencyKey,
      contact: importedContact(first),
      rows: rows.map((candidate) => importedRow(candidate, options.paidAt)),
    };
    const { data, error } = await options.rpc('perform_member_import_group', {
      p_payload: payload,
    });
    if (error || !data || typeof data !== 'object') {
      results.push({
        customerGroupKey,
        sourceKeys: rows.map((candidate) => candidate.sourceKey),
        status: 'failed',
        contactId: null,
        membershipId: null,
        rows: [],
        error: errorMessage(error),
      });
    } else {
      const response = data as {
        contact_id?: string | null;
        membership_id?: string | null;
        rows?: unknown[];
      };
      results.push({
        customerGroupKey,
        sourceKeys: rows.map((candidate) => candidate.sourceKey),
        status: 'imported',
        contactId: response.contact_id ?? null,
        membershipId: response.membership_id ?? null,
        rows: response.rows ?? [],
        error: null,
      });
    }
    options.onProgress?.(
      results.length,
      groups.length,
      `Processed ${results.length} of ${groups.length} customers`
    );
  }
  return { groups: results };
}
