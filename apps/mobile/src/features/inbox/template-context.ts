import {
  loadLegalBusinessName,
  type LegalBusinessNameResult,
} from '../../../../../src/lib/whatsapp/legal-business-name';
import { mobileSupabase, selectedBranchRef } from '../../data/supabase';
import type { TemplateMembershipDetails } from './template-presentation';

export type LegalNameState =
  | { status: 'ready'; name: string }
  | { status: 'missing' }
  | { status: 'unavailable' };

export type MembershipState =
  | { status: 'ready'; membership: TemplateMembershipDetails | null }
  | { status: 'unavailable' };

export interface TemplateContextState {
  legalName: LegalNameState;
  membership: MembershipState;
}

export interface TemplateContextSource {
  loadLegalName(accountId: string): Promise<LegalBusinessNameResult>;
  loadMembership(accountId: string, contactId: string): Promise<unknown>;
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function parseTemplateMembership(
  row: unknown
): TemplateMembershipDetails | null {
  const membership = object(row);
  if (!membership) return null;
  const planValue = Array.isArray(membership.plan)
    ? membership.plan[0]
    : membership.plan;
  const fee =
    typeof membership.fee_amount === 'number'
      ? membership.fee_amount
      : typeof membership.fee_amount === 'string' &&
          membership.fee_amount.trim() !== ''
        ? Number(membership.fee_amount)
        : null;
  return {
    planName: nonEmptyString(object(planValue)?.name),
    endDate: nonEmptyString(membership.end_date),
    feeAmount: fee !== null && Number.isFinite(fee) ? fee : null,
  };
}

/**
 * Send waits for these details, so a read that never answers must not hold
 * the button forever. After this long the reader types the values instead.
 */
const CONTEXT_TIMEOUT_MS = 8000;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error('Template details timed out')),
      timeoutMs
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Everything the picker can fill in by itself, loaded once when it opens.
 * Each half fails on its own: a missing membership still leaves the legal
 * name, and neither failure stops the reader typing the values instead.
 */
export async function loadTemplateContext(
  source: TemplateContextSource,
  accountId: string,
  contactId: string,
  timeoutMs = CONTEXT_TIMEOUT_MS
): Promise<TemplateContextState> {
  const [legal, membership] = await Promise.allSettled([
    withTimeout(
      Promise.resolve().then(() => source.loadLegalName(accountId)),
      timeoutMs
    ),
    withTimeout(
      Promise.resolve().then(() => source.loadMembership(accountId, contactId)),
      timeoutMs
    ),
  ]);

  const legalName: LegalNameState =
    legal.status === 'fulfilled'
      ? legal.value.ok
        ? { status: 'ready', name: legal.value.name }
        : legal.value.code === 'legal_business_identity_missing'
          ? { status: 'missing' }
          : { status: 'unavailable' }
      : { status: 'unavailable' };

  return {
    legalName,
    membership:
      membership.status === 'fulfilled'
        ? {
            status: 'ready',
            membership: parseTemplateMembership(membership.value),
          }
        : { status: 'unavailable' },
  };
}

function requireSelectedBranch(accountId: string): void {
  if (selectedBranchRef.get() !== accountId) {
    throw new Error('Template details are unavailable');
  }
}

export const mobileTemplateContextSource: TemplateContextSource = {
  async loadLegalName(accountId) {
    requireSelectedBranch(accountId);
    return loadLegalBusinessName(
      mobileSupabase as unknown as Parameters<typeof loadLegalBusinessName>[0],
      accountId
    );
  },

  async loadMembership(accountId, contactId) {
    requireSelectedBranch(accountId);
    const { data, error } = await mobileSupabase
      .from('memberships')
      .select('end_date, fee_amount, plan:membership_plans(name)')
      .eq('account_id', accountId)
      .eq('contact_id', contactId)
      .setHeader('x-usefuldesk-account-id', accountId)
      .maybeSingle();
    if (error) throw new Error('Could not load membership details');
    return data;
  },
};
