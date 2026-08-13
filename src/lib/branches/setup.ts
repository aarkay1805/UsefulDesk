export const BRANCH_SETUP_PACKS = [
  'membership_catalog',
  'lead_setup',
  'reminders',
  'automations',
  'flows',
] as const;

export type BranchSetupPack = (typeof BRANCH_SETUP_PACKS)[number];
export type BranchSetupStartMode = 'blank' | 'copy';
export type BranchReadinessState = 'setup' | 'ready' | 'attention';

export const BRANCH_SETUP_WARNING_CODES = [
  'PACK_EMPTY',
  'PLAN_WITHOUT_ACTIVE_PRICE',
  'CATALOG_TRAINER_REQUIRED',
  'CATALOG_STANDARD_PRICE_MISSING',
  'LEAD_FORM_DISABLED',
  'REMINDERS_DISABLED',
  'AUTOMATION_SKIPPED_UNSUPPORTED_TRIGGER',
  'AUTOMATION_SKIPPED_UNSUPPORTED_STEP',
  'AUTOMATION_SKIPPED_INVALID_CONFIG',
  'AUTOMATION_SKIPPED_UNRESOLVED_REFERENCE',
  'AUTOMATION_ASSIGNMENT_RESET',
  'AUTOMATION_WEBHOOK_CLEARED',
  'AUTOMATION_TEMPLATE_REVIEW_REQUIRED',
  'FLOW_SKIPPED_UNSUPPORTED_TRIGGER',
  'FLOW_SKIPPED_UNSUPPORTED_NODE',
  'FLOW_SKIPPED_INVALID_GRAPH',
  'FLOW_SKIPPED_UNRESOLVED_REFERENCE',
  'FLOW_HANDOFF_CLEARED',
  'FLOW_MEDIA_CLEARED',
] as const;

export type BranchSetupWarningCode =
  (typeof BRANCH_SETUP_WARNING_CODES)[number];

/**
 * Stable, shared copy for warning codes emitted by the SQL snapshot analyzer.
 * UI surfaces may add source names/counts, but the meaning of a code belongs
 * here rather than in page-specific conditionals.
 */
export const BRANCH_SETUP_WARNING_REGISTRY: Record<
  BranchSetupWarningCode,
  string
> = {
  PACK_EMPTY: 'The selected setup pack has no configuration to copy.',
  PLAN_WITHOUT_ACTIVE_PRICE: 'A membership plan has no active pricing option.',
  CATALOG_TRAINER_REQUIRED:
    'A catalog item requires a trainer assignment in the new branch.',
  CATALOG_STANDARD_PRICE_MISSING:
    'A catalog pricing option has no standard price.',
  LEAD_FORM_DISABLED:
    'The copied lead form is disabled and must be reviewed before use.',
  REMINDERS_DISABLED:
    'Copied reminder timing is disabled until it is reviewed.',
  AUTOMATION_SKIPPED_UNSUPPORTED_TRIGGER:
    'An automation with an unsupported trigger was skipped.',
  AUTOMATION_SKIPPED_UNSUPPORTED_STEP:
    'An automation with an unsupported step was skipped.',
  AUTOMATION_SKIPPED_INVALID_CONFIG:
    'An automation with invalid configuration was skipped.',
  AUTOMATION_SKIPPED_UNRESOLVED_REFERENCE:
    'An automation with an unresolved reference was skipped.',
  AUTOMATION_ASSIGNMENT_RESET:
    'An automation assignment was reset for the new branch.',
  AUTOMATION_WEBHOOK_CLEARED:
    'Webhook details were cleared from a copied automation.',
  AUTOMATION_TEMPLATE_REVIEW_REQUIRED:
    'A copied automation template must be reviewed before activation.',
  FLOW_SKIPPED_UNSUPPORTED_TRIGGER:
    'A flow with an unsupported trigger was skipped.',
  FLOW_SKIPPED_UNSUPPORTED_NODE: 'A flow with an unsupported node was skipped.',
  FLOW_SKIPPED_INVALID_GRAPH: 'A flow with an invalid graph was skipped.',
  FLOW_SKIPPED_UNRESOLVED_REFERENCE:
    'A flow with an unresolved reference was skipped.',
  FLOW_HANDOFF_CLEARED: 'A flow handoff assignment was cleared.',
  FLOW_MEDIA_CLEARED:
    'Flow media was cleared and must be added again before activation.',
};

export const BRANCH_SETUP_REASON_CODES = [
  'SOURCE_NOT_ACTIVE',
  'SNAPSHOT_TOO_LARGE',
  'ROW_LIMIT_EXCEEDED',
  'CURRENCY_MISMATCH',
] as const;

export type BranchSetupReasonCode = (typeof BRANCH_SETUP_REASON_CODES)[number];

export const COPY_BREAKDOWN_KEYS = [
  'membershipPlans',
  'planPricingOptions',
  'catalogItems',
  'catalogOptions',
  'leadFieldOptions',
  'tags',
  'customFields',
  'leadForms',
  'reminderSettings',
  'automations',
  'automationSteps',
  'flows',
  'flowNodes',
] as const;

export type CopyBreakdown = Record<
  (typeof COPY_BREAKDOWN_KEYS)[number],
  number
>;

export interface BranchSetupWarning {
  code: BranchSetupWarningCode;
  count?: number;
  pack?: BranchSetupPack;
  sourceAccountId?: string;
  displayName?: string;
}

export interface BranchSetupCopied {
  totalRows: number;
  breakdown: CopyBreakdown;
}

export interface BranchSetupPreview {
  startMode: BranchSetupStartMode;
  packs: BranchSetupPack[];
  eligible: boolean;
  reasonCodes: BranchSetupReasonCode[];
  source: null | {
    accountId: string;
    currency: string;
    branchStatus: 'active' | 'read_only' | 'archived';
    readinessState: BranchReadinessState;
    setupReviewedAt: string | null;
  };
  targetCurrency: string;
  packEligibility: Partial<
    Record<
      BranchSetupPack,
      { eligible: boolean; reasonCode?: BranchSetupReasonCode }
    >
  >;
  copied: BranchSetupCopied;
  warnings: BranchSetupWarning[];
  skipped?: { automations: number; flows: number };
  exclusions: string[];
}

export interface BranchSetupCreationResult {
  accountId: string;
  readinessState: 'setup';
  replayed: boolean;
  setupReviewedAt: null;
  setup: {
    startMode: BranchSetupStartMode;
    sourceAccountId: string | null;
    packs: BranchSetupPack[];
  };
  copied: BranchSetupCopied;
  systemSeeded: { expenseCategories: number };
  warnings: BranchSetupWarning[];
  credentialsCloned: false;
}

export interface BranchSetupCompletionResult {
  accountId: string;
  readinessState: 'ready';
  setupReviewedAt: string;
  setupReviewedBy: string;
  alreadyComplete: boolean;
}

export function isBranchSetupPack(value: unknown): value is BranchSetupPack {
  return (
    typeof value === 'string' &&
    (BRANCH_SETUP_PACKS as readonly string[]).includes(value)
  );
}

export function isBranchSetupStartMode(
  value: unknown
): value is BranchSetupStartMode {
  return value === 'blank' || value === 'copy';
}

/** Deduplicate in canonical order and apply the SQL pack dependency. */
export function normalizeBranchSetupPacks(
  values: readonly BranchSetupPack[]
): BranchSetupPack[] {
  const selected = new Set(values);
  if (selected.has('automations') || selected.has('flows')) {
    selected.add('lead_setup');
  }
  return BRANCH_SETUP_PACKS.filter((pack) => selected.has(pack));
}

export function parseBranchSetupPacks(
  values: readonly unknown[]
): { ok: true; packs: BranchSetupPack[] } | { ok: false; invalid: unknown } {
  const invalid = values.find((value) => !isBranchSetupPack(value));
  if (invalid !== undefined) return { ok: false, invalid };
  return {
    ok: true,
    packs: normalizeBranchSetupPacks(values as BranchSetupPack[]),
  };
}

export interface BranchSetupPlanRow {
  is_active: boolean;
  pricing_options?: Array<{ is_active: boolean }> | null;
}

/** Mirrors complete_organization_branch_setup's sole catalog prerequisite. */
export function hasBranchSetupPrerequisite(
  plans: readonly BranchSetupPlanRow[]
): boolean {
  return plans.some(
    (plan) =>
      plan.is_active &&
      (plan.pricing_options ?? []).some((option) => option.is_active)
  );
}

export function isBranchSetupComplete(input: {
  branchStatus: 'active' | 'read_only' | 'archived';
  readinessState: BranchReadinessState;
  setupReviewedAt: string | null;
  hasPrerequisite: boolean;
}): boolean {
  return (
    input.branchStatus === 'active' &&
    input.readinessState === 'ready' &&
    input.setupReviewedAt !== null &&
    input.hasPrerequisite
  );
}
