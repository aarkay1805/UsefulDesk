import { normalizeKey } from '@/lib/contacts/dedupe';
import type { DateOrder, StaffRef } from '@/lib/leads/import-coerce';
import {
  buildMembershipRow,
  parseImportDate,
  parseMoney,
  type BuiltMemberRow,
  type MemberImportRow,
} from '@/lib/memberships/import-commit';
import { durationLabel, optionEndDate } from '@/lib/memberships/pricing';
import { isValidE164 } from '@/lib/whatsapp/phone-utils';
import type { MembershipPlan } from '@/types';

export type MemberImportIssueSeverity = 'blocking' | 'decision' | 'notice';
export type MemberImportCandidateDisposition = 'included' | 'excluded';
export type MemberImportCandidateExclusionReason =
  'membership-history' | 'summary-row' | 'existing-member' | 'manual';
export type MemberImportPaymentResolution =
  'trust_paid' | 'trust_balance' | 'member_only' | 'manual';
export type MemberImportExistingContactResolution = 'keep_existing' | 'use_csv';

export interface MemberImportDraftValues extends MemberImportRow {
  /** Source balance is migration-only input; payments never persist it. */
  balance?: string;
}

export interface MemberImportExistingMatch {
  contactId: string;
  isMember: boolean;
  receivedVia?: string | null;
  /** Set only when CSV profile values actually differ from this contact. */
  profileConflict?: boolean;
}

export interface MemberImportReceiptOutcome {
  status: 'created' | 'skipped' | 'failed';
  receiptId?: string;
  message?: string;
}

export interface MemberImportCandidateInput {
  sourceKey: string;
  /** One-based data row in the original CSV/workbook sheet. */
  sourceRow: number;
  legacyMemberId?: string | null;
  originalValues: MemberImportDraftValues;
  existingMatch?: MemberImportExistingMatch | null;
  receiptOutcome?: MemberImportReceiptOutcome | null;
  /** Lets a workbook adapter retain vendor footer/total rows visibly. */
  isSummaryRow?: boolean;
}

export interface MemberImportCandidateIssue {
  code:
    | 'missing-phone'
    | 'invalid-phone'
    | 'shared-phone'
    | 'plan-needs-resolution'
    | 'pricing-option-needs-resolution'
    | 'invalid-membership-values'
    | 'payment-conflict'
    | 'existing-contact'
    | 'expiry-duration-mismatch'
    | 'membership-history'
    | 'summary-row'
    | 'existing-member';
  severity: MemberImportIssueSeverity;
  groupKey: string;
  explanation: string;
  nextAction: string;
  message: string;
  resolved: boolean;
}

export interface MemberImportCandidateResolutions {
  plan: { planId: string; pricingOptionId: string } | null;
  payment: MemberImportPaymentResolution | null;
  existingContact: MemberImportExistingContactResolution | null;
}

export interface MemberImportCandidate {
  sourceKey: string;
  sourceRow: number;
  legacyMemberId: string | null;
  originalValues: MemberImportDraftValues;
  draftValues: MemberImportDraftValues;
  existingMatch: MemberImportExistingMatch | null;
  built: BuiltMemberRow;
  issues: MemberImportCandidateIssue[];
  disposition: MemberImportCandidateDisposition;
  exclusionReason: MemberImportCandidateExclusionReason | null;
  resolutions: MemberImportCandidateResolutions;
  isReady: boolean;
  receiptOutcome: MemberImportReceiptOutcome | null;
}

export interface MemberImportCandidateContext {
  plans: MembershipPlan[];
  dateOrder: DateOrder;
  today: string;
  staff?: StaffRef[];
}

export interface MemberImportPaymentCorrection {
  paid?: string;
  balance?: string;
}

export interface MemberImportCandidateSummary {
  source: number;
  included: number;
  ready: number;
  needsResolution: number;
  exclusions: number;
  automaticExcluded: number;
  explicitlyExcluded: number;
  notices: number;
  newContacts: number;
  attachedContacts: number;
  memberships: number;
  payments: number;
  memberOnlyImports: number;
}

export type MemberImportCandidateFilter =
  'all' | 'needs-resolution' | 'ready' | 'excluded';

type CandidatePatch = Partial<MemberImportDraftValues> & {
  disposition?: MemberImportCandidateDisposition;
};

function trim(value: string | null | undefined): string {
  return value?.trim() ?? '';
}

function normalizeGroupValue(value: string | null | undefined): string {
  return trim(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-');
}

function cloneDraft(values: MemberImportDraftValues): MemberImportDraftValues {
  return {
    ...values,
    tagNames: [...values.tagNames],
    customValues: [...values.customValues],
  };
}

function automaticExclusion(
  candidate: Pick<MemberImportCandidate, 'exclusionReason'>
): boolean {
  return (
    candidate.exclusionReason === 'membership-history' ||
    candidate.exclusionReason === 'summary-row' ||
    candidate.exclusionReason === 'existing-member'
  );
}

function issue(
  code: MemberImportCandidateIssue['code'],
  severity: MemberImportIssueSeverity,
  groupKey: string,
  explanation: string,
  nextAction: string,
  resolved = false
): MemberImportCandidateIssue {
  return {
    code,
    severity,
    groupKey,
    explanation,
    nextAction,
    message: explanation,
    resolved,
  };
}

function membershipStart(
  candidate: MemberImportCandidate,
  context: MemberImportCandidateContext
): string | null {
  return candidate.draftValues.startDate
    ? parseImportDate(candidate.draftValues.startDate, context.dateOrder)
    : null;
}

function historyExclusions(
  candidates: MemberImportCandidate[],
  context: MemberImportCandidateContext
): Map<string, MemberImportCandidateExclusionReason | null> {
  const exclusions = new Map<
    string,
    MemberImportCandidateExclusionReason | null
  >();
  const latestByLegacyId = new Map<
    string,
    { sourceKey: string; start: string; sourceRow: number }
  >();

  for (const candidate of candidates) {
    if (candidate.exclusionReason === 'summary-row') {
      exclusions.set(candidate.sourceKey, 'summary-row');
      continue;
    }
    if (candidate.existingMatch?.isMember) {
      exclusions.set(candidate.sourceKey, 'existing-member');
      continue;
    }
    const legacyMemberId = trim(candidate.legacyMemberId);
    const start = membershipStart(candidate, context);
    if (!legacyMemberId || !start) continue;
    const current = latestByLegacyId.get(legacyMemberId);
    if (
      !current ||
      start > current.start ||
      (start === current.start && candidate.sourceRow > current.sourceRow)
    ) {
      latestByLegacyId.set(legacyMemberId, {
        sourceKey: candidate.sourceKey,
        start,
        sourceRow: candidate.sourceRow,
      });
    }
  }

  for (const candidate of candidates) {
    if (exclusions.has(candidate.sourceKey)) continue;
    const legacyMemberId = trim(candidate.legacyMemberId);
    const latest = legacyMemberId ? latestByLegacyId.get(legacyMemberId) : null;
    if (latest && latest.sourceKey !== candidate.sourceKey) {
      exclusions.set(candidate.sourceKey, 'membership-history');
    }
  }
  return exclusions;
}

function planResolutionDraft(
  context: MemberImportCandidateContext,
  resolution: { planId: string; pricingOptionId: string }
): Pick<MemberImportDraftValues, 'planName' | 'pricingOption'> | null {
  const plan = context.plans.find((item) => item.id === resolution.planId);
  const pricingOption = plan?.pricing_options?.find(
    (item) => item.id === resolution.pricingOptionId && item.is_active
  );
  if (!plan || !pricingOption) return null;
  return {
    planName: plan.name,
    pricingOption: durationLabel(
      pricingOption.duration_count,
      pricingOption.duration_unit
    ),
  };
}

function paymentConflict(values: MemberImportDraftValues): boolean {
  const fee = parseMoney(values.fee ?? '');
  const paid = parseMoney(values.amountPaid ?? '');
  const balance = parseMoney(values.balance ?? '');
  if (fee === null || (paid === null && balance === null)) return false;
  if (paid !== null && paid > fee) return true;
  return (
    paid !== null && balance !== null && Math.abs(paid + balance - fee) > 0.01
  );
}

function expiryMismatch(
  built: BuiltMemberRow,
  values: MemberImportDraftValues,
  context: MemberImportCandidateContext
): boolean {
  const membership = built.membership;
  const explicitEnd = values.endDate
    ? parseImportDate(values.endDate, context.dateOrder)
    : null;
  if (!membership || !explicitEnd) return false;
  const plan = context.plans.find((item) => item.id === membership.plan_id);
  const option = plan?.pricing_options?.find(
    (item) => item.id === membership.pricing_option_id
  );
  return option
    ? optionEndDate(membership.start_date, option) !== explicitEnd
    : false;
}

function rebuildCandidate(
  candidate: MemberImportCandidate,
  context: MemberImportCandidateContext,
  exclusionReason: MemberImportCandidateExclusionReason | null,
  sharedPhones: Set<string>
): MemberImportCandidate {
  const built = buildMembershipRow(
    candidate.draftValues,
    context.plans,
    context.dateOrder,
    context.today,
    context.staff
  );
  const issues: MemberImportCandidateIssue[] = [];
  const phone = trim(candidate.draftValues.phone);
  const phoneKey = normalizeKey(phone);
  if (!phone) {
    issues.push(
      issue(
        'missing-phone',
        'blocking',
        `missing-phone:${candidate.sourceKey}`,
        'A phone number is required.',
        'Add a phone number or exclude this row.'
      )
    );
  } else if (!isValidE164(phoneKey)) {
    issues.push(
      issue(
        'invalid-phone',
        'blocking',
        `invalid-phone:${candidate.sourceKey}`,
        'The phone number is not valid.',
        'Enter a valid international phone number.'
      )
    );
  } else if (
    candidate.disposition === 'included' &&
    sharedPhones.has(phoneKey)
  ) {
    issues.push(
      issue(
        'shared-phone',
        'blocking',
        `shared-phone:${phoneKey}`,
        'This phone is used by another included source row.',
        'Keep one row included or give each member a different phone.'
      )
    );
  }

  if (built.errors.includes('unknown-plan')) {
    const planGroup = `plan:${normalizeGroupValue(candidate.draftValues.planName) || '(blank)'}:${normalizeGroupValue(candidate.draftValues.pricingOption) || '(blank)'}`;
    issues.push(
      issue(
        'plan-needs-resolution',
        'decision',
        planGroup,
        'The CSV plan does not match an active plan.',
        'Choose the matching plan and billing option.'
      )
    );
  }
  if (built.errors.includes('no-pricing')) {
    issues.push(
      issue(
        'pricing-option-needs-resolution',
        'decision',
        `plan:${normalizeGroupValue(candidate.draftValues.planName) || '(blank)'}:${normalizeGroupValue(candidate.draftValues.pricingOption) || '(blank)'}`,
        'The CSV billing option does not match the plan.',
        'Choose the matching billing option.'
      )
    );
  }
  if (
    built.errors.some(
      (error) => error !== 'unknown-plan' && error !== 'no-pricing'
    )
  ) {
    issues.push(
      issue(
        'invalid-membership-values',
        'blocking',
        `membership-values:${candidate.sourceKey}`,
        'One or more membership values are invalid.',
        'Correct the membership values before importing.'
      )
    );
  }

  const hasPaymentConflict = paymentConflict(candidate.draftValues);
  if (hasPaymentConflict) {
    issues.push(
      issue(
        'payment-conflict',
        'decision',
        `payment-conflict:${candidate.sourceKey}`,
        'Paid, balance, and fee do not agree.',
        'Choose which payment values to trust or correct them manually.'
      )
    );
  }
  if (
    candidate.existingMatch &&
    !candidate.existingMatch.isMember &&
    candidate.existingMatch.profileConflict === true &&
    !candidate.resolutions.existingContact
  ) {
    issues.push(
      issue(
        'existing-contact',
        'decision',
        `existing-contact:${candidate.existingMatch.contactId}`,
        'CSV profile values differ from an existing contact.',
        'Keep the existing profile or use the CSV values.'
      )
    );
  }
  if (expiryMismatch(built, candidate.draftValues, context)) {
    issues.push(
      issue(
        'expiry-duration-mismatch',
        'notice',
        `expiry-duration:${candidate.sourceKey}`,
        'CSV expiry differs from the billing option; CSV expiry will be used.',
        'Verify the imported expiry date.'
      )
    );
  }
  if (exclusionReason === 'membership-history') {
    issues.push(
      issue(
        'membership-history',
        'notice',
        `membership-history:${candidate.legacyMemberId ?? candidate.sourceKey}`,
        'Older membership history is retained but excluded from this import.',
        'Review history if needed; no action is required.',
        true
      )
    );
  }
  if (exclusionReason === 'summary-row') {
    issues.push(
      issue(
        'summary-row',
        'notice',
        `summary-row:${candidate.sourceKey}`,
        'Source summary row is retained but excluded.',
        'No action is required.',
        true
      )
    );
  }
  if (exclusionReason === 'existing-member') {
    issues.push(
      issue(
        'existing-member',
        'notice',
        `existing-member:${candidate.existingMatch?.contactId ?? candidate.sourceKey}`,
        'This contact is already a member and cannot be imported again.',
        'Review the existing membership instead.',
        true
      )
    );
  }

  const disposition = exclusionReason ? 'excluded' : candidate.disposition;
  const ready =
    disposition === 'included' &&
    issues.every((item) => item.severity === 'notice' || item.resolved);
  return {
    ...candidate,
    built,
    issues,
    disposition,
    exclusionReason,
    isReady: ready,
  };
}

function recomputeMemberImportCandidates(
  candidates: MemberImportCandidate[],
  context: MemberImportCandidateContext
): MemberImportCandidate[] {
  const automaticExclusions = historyExclusions(candidates, context);
  const withExclusions = candidates.map((candidate) => {
    const automatic = automaticExclusions.get(candidate.sourceKey);
    const manual = candidate.exclusionReason === 'manual';
    return {
      ...candidate,
      disposition: automatic || manual ? 'excluded' : candidate.disposition,
      exclusionReason: automatic ?? (manual ? 'manual' : null),
    };
  });
  const phoneCounts = new Map<string, number>();
  for (const candidate of withExclusions) {
    if (candidate.disposition !== 'included') continue;
    const key = normalizeKey(candidate.draftValues.phone);
    if (key && isValidE164(key))
      phoneCounts.set(key, (phoneCounts.get(key) ?? 0) + 1);
  }
  const sharedPhones = new Set(
    [...phoneCounts.entries()]
      .filter(([, count]) => count > 1)
      .map(([phone]) => phone)
  );
  return withExclusions.map((candidate) =>
    rebuildCandidate(
      candidate,
      context,
      candidate.exclusionReason,
      sharedPhones
    )
  );
}

/** Builds a persistent, editable candidate per source row; no row is dropped. */
export function buildMemberImportCandidates(
  inputs: MemberImportCandidateInput[],
  context: MemberImportCandidateContext
): MemberImportCandidate[] {
  return recomputeMemberImportCandidates(
    inputs.map((input) => ({
      sourceKey: input.sourceKey,
      sourceRow: input.sourceRow,
      legacyMemberId: trim(input.legacyMemberId) || null,
      originalValues: cloneDraft(input.originalValues),
      draftValues: cloneDraft(input.originalValues),
      existingMatch: input.existingMatch ?? null,
      built: {
        membership: null,
        payment: null,
        assignedTo: null,
        churnRisk: null,
        contact: {
          name: null,
          email: null,
          company: null,
          date_of_birth: null,
          gender: null,
          nickname: null,
          height_cm: null,
          weight_kg: null,
          address_line1: null,
          address_line2: null,
          city: null,
          state: null,
          postal_code: null,
          country: null,
        },
        errors: [],
        warnings: [],
      },
      issues: [],
      disposition: input.isSummaryRow ? 'excluded' : 'included',
      exclusionReason: input.isSummaryRow ? 'summary-row' : null,
      resolutions: { plan: null, payment: null, existingContact: null },
      isReady: false,
      receiptOutcome: input.receiptOutcome ?? null,
    })),
    context
  );
}

export function patchMemberImportCandidate(
  candidates: MemberImportCandidate[],
  sourceKey: string,
  patch: CandidatePatch,
  context: MemberImportCandidateContext
): MemberImportCandidate[] {
  return recomputeMemberImportCandidates(
    candidates.map((candidate) => {
      if (candidate.sourceKey !== sourceKey || automaticExclusion(candidate))
        return candidate;
      const { disposition, ...draftPatch } = patch;
      return {
        ...candidate,
        draftValues: { ...candidate.draftValues, ...draftPatch },
        disposition: disposition ?? candidate.disposition,
        exclusionReason:
          disposition === 'excluded'
            ? 'manual'
            : disposition === 'included' &&
                candidate.exclusionReason === 'manual'
              ? null
              : candidate.exclusionReason,
      };
    }),
    context
  );
}

export function resolveGroupedPlan(
  candidates: MemberImportCandidate[],
  sourceKeys: string[],
  resolution: { planId: string; pricingOptionId: string },
  context: MemberImportCandidateContext
): MemberImportCandidate[] {
  const keys = new Set(sourceKeys);
  const draft = planResolutionDraft(context, resolution);
  if (!draft) return candidates;
  return recomputeMemberImportCandidates(
    candidates.map((candidate) =>
      keys.has(candidate.sourceKey) && !automaticExclusion(candidate)
        ? {
            ...candidate,
            draftValues: { ...candidate.draftValues, ...draft },
            resolutions: { ...candidate.resolutions, plan: resolution },
          }
        : candidate
    ),
    context
  );
}

export function resolvePaymentConflict(
  candidates: MemberImportCandidate[],
  sourceKey: string,
  resolution: MemberImportPaymentResolution,
  correction: MemberImportPaymentCorrection | undefined,
  context: MemberImportCandidateContext
): MemberImportCandidate[] {
  return recomputeMemberImportCandidates(
    candidates.map((candidate) => {
      if (candidate.sourceKey !== sourceKey || automaticExclusion(candidate))
        return candidate;
      const fee = parseMoney(candidate.draftValues.fee ?? '');
      const paid = parseMoney(
        correction?.paid ?? candidate.draftValues.amountPaid ?? ''
      );
      const balance = parseMoney(
        correction?.balance ?? candidate.draftValues.balance ?? ''
      );
      let draftValues = { ...candidate.draftValues };
      if (resolution === 'manual') {
        draftValues = {
          ...draftValues,
          ...(correction?.paid === undefined
            ? {}
            : { amountPaid: correction.paid }),
          ...(correction?.balance === undefined
            ? {}
            : { balance: correction.balance }),
        };
      } else if (resolution === 'member_only') {
        draftValues = { ...draftValues, amountPaid: '', feeStatus: '' };
      } else if (resolution === 'trust_paid' && paid !== null) {
        draftValues = {
          ...draftValues,
          amountPaid: String(paid),
          fee: String(paid + (balance ?? 0)),
        };
      } else if (
        resolution === 'trust_balance' &&
        fee !== null &&
        balance !== null
      ) {
        draftValues = {
          ...draftValues,
          amountPaid: String(Math.max(0, fee - balance)),
          balance: String(balance),
        };
      }
      return {
        ...candidate,
        draftValues,
        resolutions: { ...candidate.resolutions, payment: resolution },
      };
    }),
    context
  );
}

export function resolveExistingContact(
  candidates: MemberImportCandidate[],
  sourceKey: string,
  resolution: MemberImportExistingContactResolution,
  context: MemberImportCandidateContext
): MemberImportCandidate[] {
  return recomputeMemberImportCandidates(
    candidates.map((candidate) =>
      candidate.sourceKey === sourceKey && !automaticExclusion(candidate)
        ? {
            ...candidate,
            resolutions: {
              ...candidate.resolutions,
              existingContact: resolution,
            },
          }
        : candidate
    ),
    context
  );
}

export function summarizeMemberImportCandidates(
  candidates: MemberImportCandidate[]
): MemberImportCandidateSummary {
  const included = candidates.filter(
    (candidate) => candidate.disposition === 'included'
  );
  const ready = included.filter((candidate) => candidate.isReady);
  return {
    source: candidates.length,
    included: included.length,
    ready: ready.length,
    needsResolution: included.length - ready.length,
    exclusions: candidates.length - included.length,
    automaticExcluded: candidates.filter(
      (candidate) =>
        candidate.exclusionReason !== null &&
        candidate.exclusionReason !== 'manual'
    ).length,
    explicitlyExcluded: candidates.filter(
      (candidate) => candidate.exclusionReason === 'manual'
    ).length,
    notices: candidates.reduce(
      (count, candidate) =>
        count +
        candidate.issues.filter((item) => item.severity === 'notice').length,
      0
    ),
    newContacts: included.filter((candidate) => !candidate.existingMatch)
      .length,
    attachedContacts: included.filter((candidate) =>
      Boolean(candidate.existingMatch)
    ).length,
    memberships: ready.filter((candidate) =>
      Boolean(candidate.built.membership)
    ).length,
    payments: ready.filter((candidate) => Boolean(candidate.built.payment))
      .length,
    memberOnlyImports: ready.filter(
      (candidate) => candidate.built.membership && !candidate.built.payment
    ).length,
  };
}

export function filterMemberImportCandidates(
  candidates: MemberImportCandidate[],
  filter: MemberImportCandidateFilter
): MemberImportCandidate[] {
  if (filter === 'all') return candidates;
  if (filter === 'ready')
    return candidates.filter((candidate) => candidate.isReady);
  if (filter === 'excluded') {
    return candidates.filter(
      (candidate) => candidate.disposition === 'excluded'
    );
  }
  return candidates.filter(
    (candidate) => candidate.disposition === 'included' && !candidate.isReady
  );
}

export function searchMemberImportCandidates(
  candidates: MemberImportCandidate[],
  query: string
): MemberImportCandidate[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return candidates;
  return candidates.filter((candidate) =>
    [
      candidate.sourceKey,
      candidate.legacyMemberId,
      candidate.draftValues.name,
      candidate.draftValues.phone,
      candidate.draftValues.planName,
    ]
      .filter(Boolean)
      .some((value) => value!.toLowerCase().includes(normalized))
  );
}
