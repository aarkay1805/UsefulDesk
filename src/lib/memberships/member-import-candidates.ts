import { normalizeKey } from '@/lib/contacts/dedupe';
import type { DateOrder, StaffRef } from '@/lib/leads/import-coerce';
import {
  buildMembershipRow,
  parseImportDate,
  parseMoney,
  parsePaymentMethod,
  type BuiltMemberRow,
  type MemberImportRow,
} from '@/lib/memberships/import-commit';
import { durationLabel, optionEndDate } from '@/lib/memberships/pricing';
import {
  buildImportedServiceIntent,
  type ImportedServiceIntent,
  type MemberImportServiceFacts,
} from '@/lib/memberships/member-import-services';
import { isValidE164 } from '@/lib/whatsapp/phone-utils';
import type {
  CatalogItem,
  MembershipPlan,
  Trainer,
  TrainerRate,
} from '@/types';

export type MemberImportIssueSeverity = 'blocking' | 'decision' | 'notice';
export type MemberImportCandidateDisposition = 'included' | 'excluded';
export type MemberImportCandidateExclusionReason =
  'membership-history' | 'summary-row' | 'existing-member' | 'manual';
export type MemberImportPaymentResolution =
  'trust_paid' | 'trust_balance' | 'member_only' | 'manual';
export type MemberImportExistingContactResolution = 'keep_existing' | 'use_csv';

export interface MemberImportDraftValues extends MemberImportRow {
  /**
   * Reconciliation-only balance. A resolve-step correction writes here and
   * outranks the mapped `amountDue` column; payments never persist either.
   */
  balance?: string;
}

/** Mapped "Amount due", unless the reviewer corrected it during resolve. */
export function effectiveBalance(
  values: MemberImportDraftValues
): string | undefined {
  return values.balance ?? values.amountDue;
}

export interface MemberImportExistingMatch {
  contactId: string;
  isMember: boolean;
  receivedVia?: string | null;
  /** Set only when imported profile values actually differ from this contact. */
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
    | 'pricing-mismatch'
    | 'expiry-not-after-start'
    | 'payment-conflict'
    | 'existing-contact'
    | 'offering-needs-classification'
    | 'service-needs-resolution'
    | 'service-values-invalid'
    | 'service-expiry-mismatch'
    | 'trainer-ignored'
    | 'trainer-unmatched'
    | 'assignee-unmatched'
    | 'churn-risk-unmatched'
    | 'profile-value-invalid'
    | 'cancelled-dues-written-off'
    | 'duplicate-service'
    | 'purchase-total-mismatch'
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
  offering?:
    | { kind: 'membership'; planId: string; pricingOptionId: string }
    | { kind: 'service'; itemId: string; optionId: string }
    | null;
  service?: {
    itemId: string;
    optionId: string;
    trainerId: string | null;
  } | null;
  payment: MemberImportPaymentResolution | null;
  existingContact: MemberImportExistingContactResolution | null;
}

export type MemberImportOutcomeKind =
  'membership' | 'service' | 'membership_service' | 'none';

export interface MemberImportMembershipComponent {
  included: boolean;
  exclusionReason: 'membership-history' | 'existing-member' | null;
  membership: BuiltMemberRow['membership'];
}

export interface MemberImportServiceComponent {
  intent: ImportedServiceIntent;
}

export interface MemberImportCandidate {
  sourceKey: string;
  sourceRow: number;
  legacyMemberId: string | null;
  originalValues: MemberImportDraftValues;
  draftValues: MemberImportDraftValues;
  existingMatch: MemberImportExistingMatch | null;
  built: BuiltMemberRow;
  membershipComponent: MemberImportMembershipComponent | null;
  serviceComponent: MemberImportServiceComponent | null;
  outcomeKind: MemberImportOutcomeKind;
  customerGroupKey: string;
  customerIdempotencyKey: string;
  purchaseIdempotencyKey: string;
  purchaseTotal: number | null;
  issues: MemberImportCandidateIssue[];
  disposition: MemberImportCandidateDisposition;
  exclusionReason: MemberImportCandidateExclusionReason | null;
  resolutions: MemberImportCandidateResolutions;
  isReady: boolean;
  receiptOutcome: MemberImportReceiptOutcome | null;
}

export interface MemberImportCandidateContext {
  plans: MembershipPlan[];
  catalogItems?: CatalogItem[];
  trainers?: Trainer[];
  trainerRates?: TrainerRate[];
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
  uniqueCustomers: number;
  services: number;
  combinedInvoices: number;
  serviceOnlyInvoices: number;
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

function deterministicUuid(value: string): string {
  const seeds = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35];
  const words = seeds.map((seed) => {
    let hash = seed >>> 0;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
  });
  const chars = words.join('').split('');
  chars[12] = '4';
  chars[16] = ((Number.parseInt(chars[16], 16) & 0x3) | 0x8).toString(16);
  const hex = chars.join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function hasMembershipSource(candidate: MemberImportCandidate): boolean {
  return Boolean(
    trim(candidate.draftValues.planName) ||
    candidate.resolutions.offering?.kind === 'membership'
  );
}

function hasServiceSource(candidate: MemberImportCandidate): boolean {
  return Boolean(
    trim(candidate.draftValues.serviceName) ||
    candidate.resolutions.offering?.kind === 'service'
  );
}

function serviceFacts(
  context: MemberImportCandidateContext
): MemberImportServiceFacts {
  return {
    catalogItems: context.catalogItems ?? [],
    trainers: context.trainers ?? [],
    trainerRates: context.trainerRates ?? [],
  };
}

function inferOfferingResolution(
  values: MemberImportDraftValues,
  context: MemberImportCandidateContext
): MemberImportCandidateResolutions['offering'] {
  const offering = normalizeGroupValue(values.offering);
  if (!offering) return null;
  const plans = context.plans.filter(
    (plan) =>
      plan.is_active !== false && normalizeGroupValue(plan.name) === offering
  );
  const services = (context.catalogItems ?? []).filter(
    (item) =>
      item.kind === 'service' &&
      item.is_active &&
      normalizeGroupValue(item.name) === offering
  );
  if (plans.length === 1 && services.length === 0) {
    let options = (plans[0].pricing_options ?? [])
      .filter((option) => option.is_active)
      .sort((a, b) => a.sort_order - b.sort_order);
    const wantedOption = normalizeGroupValue(values.pricingOption);
    if (wantedOption) {
      options = options.filter(
        (option) =>
          normalizeGroupValue(
            durationLabel(option.duration_count, option.duration_unit)
          ) === wantedOption
      );
    }
    if (options.length !== 1) return null;
    return {
      kind: 'membership',
      planId: plans[0].id,
      pricingOptionId: options[0].id,
    };
  }
  if (services.length === 1 && plans.length === 0) {
    let options = (services[0].catalog_options ?? [])
      .filter((option) => option.is_active)
      .sort((a, b) => a.sort_order - b.sort_order);
    const wantedOption = normalizeGroupValue(values.serviceOption);
    if (wantedOption) {
      options = options.filter(
        (option) =>
          option.duration_count !== null &&
          option.duration_unit !== null &&
          normalizeGroupValue(
            durationLabel(option.duration_count, option.duration_unit)
          ) === wantedOption
      );
    }
    if (options.length !== 1) return null;
    return { kind: 'service', itemId: services[0].id, optionId: options[0].id };
  }
  return null;
}

function materializedDraft(
  candidate: MemberImportCandidate,
  context: MemberImportCandidateContext
): MemberImportDraftValues {
  const offering = candidate.resolutions.offering;
  if (offering?.kind === 'membership') {
    const planDraft = planResolutionDraft(context, offering);
    return planDraft
      ? { ...candidate.draftValues, ...planDraft }
      : candidate.draftValues;
  }
  if (offering?.kind === 'service') {
    const item = (context.catalogItems ?? []).find(
      (candidateItem) => candidateItem.id === offering.itemId
    );
    const option = item?.catalog_options?.find(
      (candidateOption) => candidateOption.id === offering.optionId
    );
    if (
      !item ||
      !option ||
      option.duration_count === null ||
      option.duration_unit === null
    ) {
      return candidate.draftValues;
    }
    return {
      ...candidate.draftValues,
      serviceName: item.name,
      serviceOption: durationLabel(option.duration_count, option.duration_unit),
    };
  }
  return candidate.draftValues;
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
): {
  rows: Map<string, MemberImportCandidateExclusionReason | null>;
  memberships: Map<string, 'membership-history' | 'existing-member'>;
} {
  const exclusions = new Map<
    string,
    MemberImportCandidateExclusionReason | null
  >();
  const membershipExclusions = new Map<
    string,
    'membership-history' | 'existing-member'
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
    if (!hasMembershipSource(candidate)) continue;
    if (candidate.existingMatch?.isMember) {
      if (hasServiceSource(candidate)) {
        membershipExclusions.set(candidate.sourceKey, 'existing-member');
      } else {
        exclusions.set(candidate.sourceKey, 'existing-member');
      }
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
      if (hasServiceSource(candidate)) {
        membershipExclusions.set(candidate.sourceKey, 'membership-history');
      } else {
        exclusions.set(candidate.sourceKey, 'membership-history');
      }
    }
  }
  return { rows: exclusions, memberships: membershipExclusions };
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
  const balance = parseMoney(effectiveBalance(values) ?? '');
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
  if (!option) return false;
  // A same-day source row was read as a one-day membership, so judge the term
  // against what was actually stored rather than the date the source had no
  // way to express. Without this every correctly handled per-session row
  // carries a mismatch notice, and the genuinely odd rows — a six-month plan
  // recorded as starting and ending on one day — stop standing out.
  const comparable =
    explicitEnd === membership.start_date ? membership.end_date : explicitEnd;
  return optionEndDate(membership.start_date, option) !== comparable;
}

function rebuildCandidate(
  candidate: MemberImportCandidate,
  context: MemberImportCandidateContext,
  exclusionReason: MemberImportCandidateExclusionReason | null,
  membershipExclusion: 'membership-history' | 'existing-member' | null,
  customerGroup: { key: string; conflict: boolean }
): MemberImportCandidate {
  const values = materializedDraft(candidate, context);
  const membershipSource = hasMembershipSource(candidate);
  const serviceSource = hasServiceSource(candidate);
  const membershipBuildValues = serviceSource
    ? { ...values, amountPaid: '', feeStatus: '', paidAt: '' }
    : values;
  let built = buildMembershipRow(
    membershipBuildValues,
    context.plans,
    context.dateOrder,
    context.today,
    context.staff,
    context.trainers
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
        'Every member needs their own phone number.',
        'Add one, or exclude the row.'
      )
    );
  } else if (!isValidE164(phoneKey)) {
    issues.push(
      issue(
        'invalid-phone',
        'blocking',
        `invalid-phone:${candidate.sourceKey}`,
        'This is not a valid phone number.',
        'Re-enter it with the account country code, or exclude the row.'
      )
    );
  } else if (candidate.disposition === 'included' && customerGroup.conflict) {
    issues.push(
      issue(
        'shared-phone',
        'blocking',
        `shared-phone:${phoneKey}`,
        'More than one member in this file uses this phone number.',
        'Give each member their own number, or exclude the duplicate. UsefulDesk never merges these records.'
      )
    );
  }

  if (
    trim(values.offering) &&
    !candidate.resolutions.offering &&
    !trim(values.planName) &&
    !trim(values.serviceName)
  ) {
    issues.push(
      issue(
        'offering-needs-classification',
        'decision',
        `offering:${normalizeGroupValue(values.offering)}`,
        'This offering could be either a plan or a service.',
        'Choose the active plan or service it should become.'
      )
    );
  }

  if (membershipSource && built.errors.includes('unknown-plan')) {
    const planGroup = `plan:${normalizeGroupValue(candidate.draftValues.planName) || '(blank)'}:${normalizeGroupValue(candidate.draftValues.pricingOption) || '(blank)'}`;
    issues.push(
      issue(
        'plan-needs-resolution',
        'decision',
        planGroup,
        'This plan name does not match an active plan.',
        'Choose the plan and billing option to use instead.'
      )
    );
  }
  if (membershipSource && built.errors.includes('no-pricing')) {
    issues.push(
      issue(
        'pricing-option-needs-resolution',
        'decision',
        `plan:${normalizeGroupValue(candidate.draftValues.planName) || '(blank)'}:${normalizeGroupValue(candidate.draftValues.pricingOption) || '(blank)'}`,
        'This billing option does not belong to the chosen plan.',
        'Choose the billing option to use instead.'
      )
    );
  }
  if (built.warnings.includes('unknown-trainer')) {
    issues.push(
      issue(
        'trainer-unmatched',
        'notice',
        `trainer:${normalizeGroupValue(values.membershipTrainer)}`,
        `“${trim(values.membershipTrainer)}” is not an active trainer, so these members import without one.`,
        'Add the trainer in Settings → Products & services, then re-import, or set it on the member later.',
        true
      )
    );
  }
  // Every other `built.warnings` code needs a consumer for the same reason
  // the trainer one does: a warning nobody renders is a value dropped in
  // silence, which is exactly how the unmatched assignee went unnoticed.
  if (built.warnings.includes('unknown-assignee')) {
    issues.push(
      issue(
        'assignee-unmatched',
        'notice',
        `assignee:${normalizeGroupValue(values.assignedTo)}`,
        `“${trim(values.assignedTo)}” is not a teammate on this account, so a new member is assigned to whoever runs the import instead.`,
        'Invite them from Settings → Members, then re-import, or reassign the member later.',
        true
      )
    );
  }
  if (built.warnings.includes('unknown-churn-risk')) {
    issues.push(
      issue(
        'churn-risk-unmatched',
        'notice',
        `churn-risk:${normalizeGroupValue(values.churnRisk)}`,
        `“${trim(values.churnRisk)}” could not be read as yes or no, so these members import without a churn risk.`,
        'Use yes/no, true/false, 1/0, or high/low in the source column, or set churn risk on the member later.',
        true
      )
    );
  }
  if (built.warnings.includes('invalid-profile-value')) {
    issues.push(
      issue(
        'profile-value-invalid',
        'notice',
        'profile-value',
        'Height or weight could not be read, so these members import without it.',
        'Use a value like 175 cm or 5\'9" for height and 70 kg for weight, then re-import, or set it on the member later.',
        true
      )
    );
  }
  // An INACTIVE row with a future expiry maps to `cancelled`, whose current
  // period is voided on commit. The money disappearing is the point of the
  // notice: the row still imports, but never without saying so.
  if (built.warnings.includes('cancelled-dues-written-off')) {
    issues.push(
      issue(
        'cancelled-dues-written-off',
        'notice',
        'cancelled-dues',
        'This membership is cancelled with an unpaid balance, so the balance is written off on import.',
        'Exclude the row if the balance is still collectible, or import to clear it.',
        true
      )
    );
  }
  if (membershipSource && built.errors.includes('expiry-not-after-start')) {
    issues.push(
      issue(
        'expiry-not-after-start',
        'blocking',
        `expiry-range:${candidate.sourceKey}`,
        'Expiry is not after the start date, so this membership covers no time.',
        'Set an expiry at least a day after the start — a per-session row usually means the next day — or exclude it.'
      )
    );
  }
  if (membershipSource && built.errors.includes('pricing-mismatch')) {
    issues.push(
      issue(
        'pricing-mismatch',
        'blocking',
        `pricing:${candidate.sourceKey}`,
        'List price, discount, and fee charged do not add up.',
        'Correct one of the three amounts, or leave the discount columns unmapped.'
      )
    );
  }
  if (
    membershipSource &&
    built.errors.some(
      (error) =>
        error !== 'unknown-plan' &&
        error !== 'no-pricing' &&
        error !== 'pricing-mismatch' &&
        error !== 'expiry-not-after-start'
    )
  ) {
    issues.push(
      issue(
        'invalid-membership-values',
        'blocking',
        `membership-values:${candidate.sourceKey}`,
        'Some membership values in this row cannot be read.',
        'Correct them below, or exclude the row.'
      )
    );
  }

  let serviceComponent: MemberImportServiceComponent | null = null;
  if (serviceSource) {
    const serviceResult = buildImportedServiceIntent(
      {
        serviceName: values.serviceName ?? values.offering ?? '',
        serviceOption: values.serviceOption,
        trainerName: values.serviceTrainer,
        startDate: values.serviceStart,
        fallbackStartDate: values.startDate,
        endDate: values.serviceEnd,
        listPrice: values.serviceListPrice,
        discountAmount: values.serviceDiscountAmount,
        discountPercent: values.serviceDiscountPercent,
        soldPrice: values.serviceSoldPrice,
        status: values.serviceStatus,
        resolution:
          candidate.resolutions.service ??
          (candidate.resolutions.offering?.kind === 'service'
            ? {
                itemId: candidate.resolutions.offering.itemId,
                optionId: candidate.resolutions.offering.optionId,
                trainerId: null,
              }
            : undefined),
      },
      serviceFacts(context),
      context
    );
    if (serviceResult.intent) {
      serviceComponent = { intent: serviceResult.intent };
    }
    for (const serviceIssue of serviceResult.errors) {
      issues.push(
        issue(
          serviceIssue.code === 'service-unresolved' ||
            serviceIssue.code === 'service-option-unresolved' ||
            serviceIssue.code === 'trainer-unresolved' ||
            serviceIssue.code === 'trainer-required' ||
            serviceIssue.code === 'trainer-rate-missing'
            ? 'service-needs-resolution'
            : 'service-values-invalid',
          serviceIssue.code.includes('unresolved') ||
            serviceIssue.code.includes('trainer')
            ? 'decision'
            : 'blocking',
          `service:${normalizeGroupValue(values.serviceName ?? values.offering)}:${normalizeGroupValue(values.serviceOption)}:${normalizeGroupValue(values.serviceTrainer)}`,
          serviceIssue.message,
          'Choose an active service and option, or exclude the row.'
        )
      );
    }
    for (const notice of serviceResult.notices) {
      issues.push(
        issue(
          notice.code === 'trainer-ignored'
            ? 'trainer-ignored'
            : 'service-expiry-mismatch',
          'notice',
          `${notice.code}:${candidate.sourceKey}`,
          notice.message,
          'Check the imported service terms.',
          true
        )
      );
    }
  }

  const explicitTotal = trim(values.fee) ? parseMoney(values.fee ?? '') : null;
  const membershipConfiguredAmount = built.membership?.fee_amount ?? 0;
  const serviceAmount = serviceComponent?.intent.soldAmount ?? 0;
  const purchaseTotal =
    explicitTotal ?? membershipConfiguredAmount + serviceAmount;
  if (trim(values.fee) && explicitTotal === null && serviceComponent) {
    issues.push(
      issue(
        'purchase-total-mismatch',
        'blocking',
        `purchase-total:${candidate.sourceKey}`,
        'The row total is not a valid amount.',
        'Enter the amount this member was charged.'
      )
    );
  }
  if (explicitTotal !== null && serviceComponent && !membershipSource) {
    if (Math.abs(explicitTotal - serviceAmount) > 0.01) {
      issues.push(
        issue(
          'purchase-total-mismatch',
          'blocking',
          `purchase-total:${candidate.sourceKey}`,
          'The row total does not match the service price.',
          'Correct the total, or the service sold price.'
        )
      );
    }
  }
  if (explicitTotal !== null && serviceComponent && built.membership) {
    const membershipAmount = explicitTotal - serviceAmount;
    if (membershipAmount < 0) {
      issues.push(
        issue(
          'purchase-total-mismatch',
          'blocking',
          `purchase-total:${candidate.sourceKey}`,
          'The row total is less than the service price on its own.',
          'Correct the total, or the service sold price.'
        )
      );
    } else {
      built = {
        ...built,
        membership: { ...built.membership, fee_amount: membershipAmount },
      };
    }
  }

  const amountPaid = parseMoney(values.amountPaid ?? '');
  const paidOn = values.paidAt
    ? parseImportDate(values.paidAt, context.dateOrder)
    : null;
  if (
    amountPaid !== null &&
    amountPaid > purchaseTotal &&
    !paymentConflict(values)
  ) {
    issues.push(
      issue(
        'payment-conflict',
        'decision',
        `payment-conflict:${candidate.sourceKey}`,
        'Paid is more than this row’s total.',
        'Choose which figures to trust, or import without a payment.'
      )
    );
  }
  built = {
    ...built,
    payment:
      amountPaid !== null && amountPaid > 0
        ? {
            amount: amountPaid,
            method: parsePaymentMethod(values.paymentMethod ?? ''),
            paidOn:
              paidOn ??
              built.membership?.start_date ??
              serviceComponent?.intent.startDate ??
              context.today,
          }
        : null,
  };

  if (!membershipSource) {
    built = {
      ...built,
      membership: null,
      errors: [],
    };
  } else if (membershipExclusion) {
    built = { ...built, membership: null };
  }

  const hasPaymentConflict = paymentConflict(candidate.draftValues);
  if (hasPaymentConflict) {
    issues.push(
      issue(
        'payment-conflict',
        'decision',
        `payment-conflict:${candidate.sourceKey}`,
        'Paid, balance, and total do not add up.',
        'Choose which figures to trust, or enter corrected ones.'
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
        'This phone already belongs to a contact with different details.',
        'Keep the saved details, or replace them with the ones in your file.'
      )
    );
  }
  if (expiryMismatch(built, candidate.draftValues, context)) {
    issues.push(
      issue(
        'expiry-duration-mismatch',
        'notice',
        `expiry-duration:${candidate.sourceKey}`,
        'The expiry in your file differs from the billing option. Your file’s date will be used.',
        'Check the imported expiry date.'
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
  if (membershipExclusion === 'membership-history') {
    issues.push(
      issue(
        'membership-history',
        'notice',
        `membership-history:${candidate.legacyMemberId ?? candidate.sourceKey}`,
        'The older membership component is excluded; this row’s service remains eligible.',
        'Review the service purchase; no membership action is required.',
        true
      )
    );
  }
  if (membershipExclusion === 'existing-member') {
    issues.push(
      issue(
        'existing-member',
        'notice',
        `existing-member:${candidate.existingMatch?.contactId ?? candidate.sourceKey}`,
        'The existing membership is kept; this row’s service remains eligible.',
        'Review the service purchase; no membership action is required.',
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
  const membershipComponent = membershipSource
    ? {
        included: membershipExclusion === null && Boolean(built.membership),
        exclusionReason: membershipExclusion,
        membership: built.membership,
      }
    : null;
  const outcomeKind: MemberImportOutcomeKind =
    membershipComponent?.included && serviceComponent
      ? 'membership_service'
      : membershipComponent?.included
        ? 'membership'
        : serviceComponent
          ? 'service'
          : 'none';
  const ready =
    disposition === 'included' &&
    issues.every((item) => item.severity === 'notice' || item.resolved);
  return {
    ...candidate,
    draftValues: values,
    built,
    membershipComponent,
    serviceComponent,
    outcomeKind,
    customerGroupKey: customerGroup.key,
    customerIdempotencyKey: deterministicUuid(`customer:${customerGroup.key}`),
    purchaseIdempotencyKey: deterministicUuid(
      `purchase:${customerGroup.key}:${candidate.sourceKey}`
    ),
    purchaseTotal,
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
    const automatic = automaticExclusions.rows.get(candidate.sourceKey);
    const manual = candidate.exclusionReason === 'manual';
    return {
      ...candidate,
      disposition: automatic || manual ? 'excluded' : candidate.disposition,
      exclusionReason: automatic ?? (manual ? 'manual' : null),
    };
  });
  const rowsByPhone = new Map<string, MemberImportCandidate[]>();
  for (const candidate of withExclusions) {
    if (candidate.disposition !== 'included') continue;
    const key = normalizeKey(candidate.draftValues.phone);
    if (key && isValidE164(key)) {
      rowsByPhone.set(key, [...(rowsByPhone.get(key) ?? []), candidate]);
    }
  }
  const customerGroups = new Map<string, { key: string; conflict: boolean }>();
  for (const [phone, rows] of rowsByPhone) {
    const legacyIds = new Set(
      rows.map((row) => normalizeGroupValue(row.legacyMemberId)).filter(Boolean)
    );
    const names = new Set(
      rows
        .map((row) => normalizeGroupValue(row.draftValues.name))
        .filter(Boolean)
    );
    const conflict = legacyIds.size > 1 || names.size > 1;
    const legacyIdentity = [...legacyIds].sort()[0] ?? '';
    const key = `phone:${phone}:legacy:${legacyIdentity || '-'}`;
    for (const row of rows)
      customerGroups.set(row.sourceKey, { key, conflict });
  }
  const rebuilt = withExclusions.map((candidate) =>
    rebuildCandidate(
      candidate,
      context,
      candidate.exclusionReason,
      automaticExclusions.memberships.get(candidate.sourceKey) ?? null,
      customerGroups.get(candidate.sourceKey) ?? {
        key: `source:${candidate.sourceKey}`,
        conflict: false,
      }
    )
  );
  const servicePurchaseCounts = new Map<string, number>();
  for (const candidate of rebuilt) {
    if (candidate.disposition !== 'included' || !candidate.serviceComponent)
      continue;
    const service = candidate.serviceComponent.intent;
    const key = [
      candidate.customerGroupKey,
      service.optionId,
      service.startDate,
      service.endDate,
      service.soldAmount,
      service.trainerId ?? '-',
    ].join(':');
    servicePurchaseCounts.set(key, (servicePurchaseCounts.get(key) ?? 0) + 1);
  }
  return rebuilt.map((candidate) => {
    const service = candidate.serviceComponent?.intent;
    if (!service || candidate.disposition !== 'included') return candidate;
    const duplicateKey = [
      candidate.customerGroupKey,
      service.optionId,
      service.startDate,
      service.endDate,
      service.soldAmount,
      service.trainerId ?? '-',
    ].join(':');
    if ((servicePurchaseCounts.get(duplicateKey) ?? 0) < 2) return candidate;
    const issues = [
      ...candidate.issues,
      issue(
        'duplicate-service',
        'blocking',
        `duplicate-service:${duplicateKey}`,
        'This is an exact duplicate of another included service purchase.',
        'Exclude one row or correct the service terms so each purchase is distinct.'
      ),
    ];
    return { ...candidate, issues, isReady: false };
  });
}

/** Builds a persistent, editable candidate per source row; no row is dropped. */
export function buildMemberImportCandidates(
  inputs: MemberImportCandidateInput[],
  context: MemberImportCandidateContext
): MemberImportCandidate[] {
  return recomputeMemberImportCandidates(
    inputs.map((input) => {
      const draftValues = cloneDraft(input.originalValues);
      return {
        sourceKey: input.sourceKey,
        sourceRow: input.sourceRow,
        legacyMemberId: trim(input.legacyMemberId) || null,
        originalValues: cloneDraft(input.originalValues),
        draftValues,
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
            trainer_id: null,
          },
          errors: [],
          warnings: [],
        },
        membershipComponent: null,
        serviceComponent: null,
        outcomeKind: 'none' as const,
        customerGroupKey: `source:${input.sourceKey}`,
        customerIdempotencyKey: deterministicUuid(
          `customer:source:${input.sourceKey}`
        ),
        purchaseIdempotencyKey: deterministicUuid(
          `purchase:source:${input.sourceKey}`
        ),
        purchaseTotal: null,
        issues: [],
        disposition: input.isSummaryRow
          ? ('excluded' as const)
          : ('included' as const),
        exclusionReason: input.isSummaryRow ? ('summary-row' as const) : null,
        resolutions: {
          plan: null,
          offering: inferOfferingResolution(draftValues, context),
          service: null,
          payment: null,
          existingContact: null,
        },
        isReady: false,
        receiptOutcome: input.receiptOutcome ?? null,
      };
    }),
    context
  );
}

/** Recomputes saved candidates from editable source facts and current account
 * references. Persisted readiness is deliberately ignored on resume. */
export function revalidateMemberImportCandidates(
  candidates: MemberImportCandidate[],
  context: MemberImportCandidateContext
): MemberImportCandidate[] {
  return recomputeMemberImportCandidates(
    candidates.map((candidate) => ({
      ...candidate,
      originalValues: cloneDraft(candidate.originalValues),
      draftValues: cloneDraft(candidate.draftValues),
      membershipComponent: null,
      serviceComponent: null,
      outcomeKind: 'none',
      purchaseTotal: null,
      issues: [],
      isReady: false,
      resolutions: {
        plan: candidate.resolutions?.plan ?? null,
        offering:
          candidate.resolutions?.offering ??
          inferOfferingResolution(candidate.draftValues, context),
        service: candidate.resolutions?.service ?? null,
        payment: candidate.resolutions?.payment ?? null,
        existingContact: candidate.resolutions?.existingContact ?? null,
      },
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

export function resolveGroupedOffering(
  candidates: MemberImportCandidate[],
  sourceKeys: string[],
  resolution: NonNullable<MemberImportCandidateResolutions['offering']>,
  context: MemberImportCandidateContext
): MemberImportCandidate[] {
  const keys = new Set(sourceKeys);
  return recomputeMemberImportCandidates(
    candidates.map((candidate) =>
      keys.has(candidate.sourceKey) && !automaticExclusion(candidate)
        ? {
            ...candidate,
            resolutions: { ...candidate.resolutions, offering: resolution },
          }
        : candidate
    ),
    context
  );
}

export function resolveGroupedService(
  candidates: MemberImportCandidate[],
  sourceKeys: string[],
  resolution: {
    itemId: string;
    optionId: string;
    trainerId: string | null;
  },
  context: MemberImportCandidateContext
): MemberImportCandidate[] {
  const keys = new Set(sourceKeys);
  return recomputeMemberImportCandidates(
    candidates.map((candidate) =>
      keys.has(candidate.sourceKey) && !automaticExclusion(candidate)
        ? {
            ...candidate,
            resolutions: { ...candidate.resolutions, service: resolution },
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
        correction?.balance ?? effectiveBalance(candidate.draftValues) ?? ''
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
    uniqueCustomers: new Set(
      ready.map((candidate) => candidate.customerGroupKey)
    ).size,
    memberships: ready.filter(
      (candidate) => candidate.membershipComponent?.included
    ).length,
    services: ready.filter((candidate) => candidate.serviceComponent).length,
    combinedInvoices: ready.filter(
      (candidate) =>
        candidate.membershipComponent?.included && candidate.serviceComponent
    ).length,
    serviceOnlyInvoices: ready.filter(
      (candidate) =>
        !candidate.membershipComponent?.included && candidate.serviceComponent
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
      candidate.draftValues.serviceName,
      candidate.draftValues.offering,
    ]
      .filter(Boolean)
      .some((value) => value!.toLowerCase().includes(normalized))
  );
}
