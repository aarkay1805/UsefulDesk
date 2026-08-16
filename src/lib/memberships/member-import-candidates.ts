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
    | 'offering-needs-classification'
    | 'service-needs-resolution'
    | 'service-values-invalid'
    | 'service-expiry-mismatch'
    | 'trainer-ignored'
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
  } else if (candidate.disposition === 'included' && customerGroup.conflict) {
    issues.push(
      issue(
        'shared-phone',
        'blocking',
        `shared-phone:${phoneKey}`,
        'This phone has conflicting names or source member identities.',
        'Correct the identity values or exclude the conflicting row.'
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
        'Choose whether this source offering is a membership or service.',
        'Select an active plan and billing option or service and option.'
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
        'The CSV plan does not match an active plan.',
        'Choose the matching plan and billing option.'
      )
    );
  }
  if (membershipSource && built.errors.includes('no-pricing')) {
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
    membershipSource &&
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
          'Choose active service facts or correct this source row.'
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
          'Verify the imported service terms.',
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
  if (explicitTotal !== null && serviceComponent && !membershipSource) {
    if (Math.abs(explicitTotal - serviceAmount) > 0.01) {
      issues.push(
        issue(
          'purchase-total-mismatch',
          'blocking',
          `purchase-total:${candidate.sourceKey}`,
          'The row fee does not equal the resolved service sold price.',
          'Correct the row fee or service sold price.'
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
          'The row fee is lower than the resolved service sold price.',
          'Correct the combined row fee or service sold price.'
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
        'Amount paid is greater than this row’s resolved purchase total.',
        'Correct the payment or import the purchase without a payment.'
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
