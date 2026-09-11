import type { TemplateContractId } from '@/lib/whatsapp/template-contracts';
import type { TemplateReadinessCode } from '@/lib/whatsapp/template-readiness';

export type ReminderDiagnosticKind =
  'membership_renewal' | 'service_renewal' | 'installment_reminder';

export type ReminderDiagnosticState =
  'disabled' | 'blocked' | 'deferred' | 'no_eligible' | 'ready';

export interface ReminderDiagnosticTemplate {
  ready: boolean;
  code: TemplateReadinessCode;
  message?: string;
}

export interface ReminderDiagnosticInput {
  kind: ReminderDiagnosticKind;
  enabled: boolean;
  whatsappConnected: boolean;
  template: ReminderDiagnosticTemplate;
  /** Exact date-matched worker candidates before phone/claim/window gates. */
  dateMatchedCount: number;
  /** Current, unclaimed candidates that could send in the active window. */
  pendingCount: number;
  /** Date-matched candidates that lack a required send prerequisite (phone). */
  blockedCount: number;
  /** Current, unclaimed candidates held only by the account-local send window. */
  deferredCount: number;
}

export interface ReminderDiagnostic {
  kind: ReminderDiagnosticKind;
  state: ReminderDiagnosticState;
  dateMatchedCount: number;
  pendingCount: number;
  blockedCount: number;
  deferredCount: number;
  reason: string;
  templateContract: TemplateContractId;
}

const CONTRACT_BY_KIND: Record<ReminderDiagnosticKind, TemplateContractId> = {
  membership_renewal: 'membership_renewal',
  service_renewal: 'service_renewal',
  installment_reminder: 'installment_reminder',
};

/**
 * Converts raw, no-PII worker prerequisites into the operator-facing state.
 * This is deliberately pure so the authenticated route and Settings agree on
 * the exact meaning of a disabled schedule, a blocked setup, and an empty
 * but healthy candidate cohort.
 */
export function diagnoseReminder(
  input: ReminderDiagnosticInput
): ReminderDiagnostic {
  const templateContract = CONTRACT_BY_KIND[input.kind];

  if (!input.enabled) {
    return {
      kind: input.kind,
      state: 'disabled',
      dateMatchedCount: input.dateMatchedCount,
      pendingCount: input.pendingCount,
      blockedCount: input.blockedCount,
      deferredCount: input.deferredCount,
      reason:
        input.kind === 'installment_reminder'
          ? 'No joining-payment installment is currently due.'
          : 'This reminder schedule is off.',
      templateContract,
    };
  }

  if (!input.whatsappConnected) {
    return {
      kind: input.kind,
      state: 'blocked',
      dateMatchedCount: input.dateMatchedCount,
      pendingCount: input.pendingCount,
      blockedCount: input.blockedCount,
      deferredCount: input.deferredCount,
      reason: 'Connect WhatsApp before this reminder can be sent.',
      templateContract,
    };
  }

  if (!input.template.ready) {
    return {
      kind: input.kind,
      state: 'blocked',
      dateMatchedCount: input.dateMatchedCount,
      pendingCount: input.pendingCount,
      blockedCount: input.blockedCount,
      deferredCount: input.deferredCount,
      reason:
        input.template.message ??
        'The required WhatsApp template is not ready.',
      templateContract,
    };
  }

  if (input.dateMatchedCount === 0) {
    return {
      kind: input.kind,
      state: 'no_eligible',
      dateMatchedCount: 0,
      pendingCount: 0,
      blockedCount: 0,
      deferredCount: 0,
      reason: 'No eligible reminders are due right now.',
      templateContract,
    };
  }

  if (input.deferredCount > 0) {
    return {
      kind: input.kind,
      state: 'deferred',
      dateMatchedCount: input.dateMatchedCount,
      pendingCount: input.pendingCount,
      blockedCount: input.blockedCount,
      deferredCount: input.deferredCount,
      reason: `${input.deferredCount} reminder${input.deferredCount === 1 ? '' : 's'} will be eligible after the 9:00 AM local send window opens.`,
      templateContract,
    };
  }

  if (input.pendingCount > 0) {
    return {
      kind: input.kind,
      state: 'ready',
      dateMatchedCount: input.dateMatchedCount,
      pendingCount: input.pendingCount,
      blockedCount: input.blockedCount,
      deferredCount: 0,
      reason: `${input.pendingCount} unclaimed reminder${input.pendingCount === 1 ? '' : 's'} can send now.`,
      templateContract,
    };
  }

  if (input.blockedCount > 0) {
    return {
      kind: input.kind,
      state: 'blocked',
      dateMatchedCount: input.dateMatchedCount,
      pendingCount: 0,
      blockedCount: input.blockedCount,
      deferredCount: 0,
      reason: `${input.blockedCount} date-matched reminder${input.blockedCount === 1 ? '' : 's'} need${input.blockedCount === 1 ? 's' : ''} a contact phone number.`,
      templateContract,
    };
  }

  return {
    kind: input.kind,
    state: 'no_eligible',
    dateMatchedCount: input.dateMatchedCount,
    pendingCount: 0,
    blockedCount: 0,
    deferredCount: 0,
    reason: 'All date-matched reminders are already claimed or sent.',
    templateContract,
  };
}
