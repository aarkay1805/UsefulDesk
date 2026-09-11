/** Plain account-local dates are used for every schedule decision. */
export interface ReminderMilestone {
  key: string;
  /** Negative values are before the subject's effective due date. */
  offsetDays: number;
}

export interface DueMilestoneInput {
  anchorDate: string;
  today: string;
  activatedOn: string;
  milestones: readonly ReminderMilestone[];
  handledKeys: readonly string[];
  catchUpDays: number;
}

export type LifecycleReminderKind =
  | 'invoice_due'
  | 'invoice_overdue'
  | 'installment_overdue'
  | 'membership_post_expiry'
  | 'service_post_expiry'
  | 'promise_to_pay'
  | 'payment_link_follow_up'
  | 'payment_confirmation'
  | 'autopay_recovery'
  | 'session_pack_low'
  | 'session_pack_exhausted'
  | 'freeze_return'
  | 'membership_win_back'
  | 'service_win_back';

export type LifecycleReminderState =
  | 'queued'
  | 'leased'
  | 'attempting'
  | 'accepted'
  | 'delivered'
  | 'failed'
  | 'blocked'
  | 'deferred'
  | 'skipped'
  | 'ambiguous';

export interface InvoiceCollectionSettings {
  accountId: string;
  enabled: boolean;
  activatedOn: string | null;
  activatedAt: string | null;
  beforeDueDays: number[];
  overdueDays: number[];
  catchUpDays: number;
  sendWindowStart: number;
  sendWindowEnd: number;
}

export interface LifecycleReminderJob {
  id: string;
  account_id: string;
  contact_id: string;
  invoice_id: string | null;
  installment_plan_id: string | null;
  membership_id?: string | null;
  member_service_id?: string | null;
  collection_commitment_id?: string | null;
  payment_link_id?: string | null;
  payment_link_revision?: number | null;
  commitment_revision?: number | null;
  payment_id?: string | null;
  autopay_failure_event_id?: string | null;
  kind: LifecycleReminderKind;
  business_key: string;
  subject_cycle_id: string;
  milestone_key: string;
  effective_due_on: string;
  activation_generation: string;
  state: LifecycleReminderState;
  attempt_count: number;
  lease_owner: string | null;
  lease_generation: number;
  provider_message_id: string | null;
  reason?: { renewed?: boolean; period_end?: string | null; code?: string } | null;
}

export interface ReminderRunSummary {
  accountsConsidered: number;
  queued: number;
  deferred: number;
  attempted: number;
  accepted: number;
  blocked: number;
  skipped: number;
  failed: number;
  ambiguous: number;
  infrastructureFailures: number;
  notes: string[];
}
