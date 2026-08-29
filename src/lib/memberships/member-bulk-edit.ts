import type { BulkEditProperty } from '@/components/leads/bulk-edit-dialog';
import {
  CHURN_RISK_OPTIONS,
  NO_TRAINER_MEMBER_FILTER,
  UNASSIGNED_MEMBER_FILTER,
} from '@/lib/memberships/filters';

export type MemberBulkEditKey = 'assignee' | 'trainer' | 'churnRisk';

export interface MemberBulkStaffOption {
  user_id: string;
  full_name: string;
}

export interface MemberBulkTrainerOption {
  id: string;
  display_name: string;
  is_active: boolean;
}

/**
 * The All Members bulk editor is intentionally narrower than the member
 * schema. Membership lifecycle, plan, expiry, status, fee, billing, and other
 * financial fields never enter this allowlist.
 */
export function buildMemberBulkEditProperties(
  staff: readonly MemberBulkStaffOption[],
  trainers: readonly MemberBulkTrainerOption[]
): BulkEditProperty[] {
  return [
    {
      key: 'assignee',
      label: 'Assigned to',
      group: 'Member fields',
      editor: {
        kind: 'select',
        variant: 'plain',
        options: [
          { value: UNASSIGNED_MEMBER_FILTER, label: 'Unassigned' },
          ...staff.map((member) => ({
            value: member.user_id,
            label: member.full_name,
          })),
        ],
      },
    },
    {
      key: 'trainer',
      label: 'Trainer',
      group: 'Member fields',
      editor: {
        kind: 'select',
        variant: 'plain',
        options: [
          { value: NO_TRAINER_MEMBER_FILTER, label: 'No trainer' },
          ...trainers
            .filter((trainer) => trainer.is_active)
            .map((trainer) => ({
              value: trainer.id,
              label: trainer.display_name,
            })),
        ],
      },
    },
    {
      key: 'churnRisk',
      label: 'Churn risk',
      group: 'Member fields',
      editor: {
        kind: 'select',
        variant: 'plain',
        options: CHURN_RISK_OPTIONS,
      },
    },
  ];
}

export function isMemberBulkEditKey(value: string): value is MemberBulkEditKey {
  return value === 'assignee' || value === 'trainer' || value === 'churnRisk';
}

export interface ProvenMemberBulkWrite {
  succeededIds: string[];
  failedIds: string[];
}

/** Reconcile a bulk update with the ids returned by `.select('id')`. */
export function proveMemberBulkWrite(
  requestedIds: readonly string[],
  returnedRows: readonly { id: string }[] | null | undefined
): ProvenMemberBulkWrite {
  const returned = new Set((returnedRows ?? []).map((row) => row.id));
  return {
    succeededIds: requestedIds.filter((id) => returned.has(id)),
    failedIds: requestedIds.filter((id) => !returned.has(id)),
  };
}

export interface MemberAssignmentBulkResult {
  approvedIds: string[];
  pendingIds: string[];
  failed: { id: string; error: unknown }[];
}

/**
 * Run approval-gated assignment requests with a small bounded worker pool so
 * an all-matching selection cannot flood PostgREST and one failure cannot
 * abort the remaining contacts.
 */
export async function runMemberAssignmentBulkEdit(
  contactIds: readonly string[],
  request: (contactId: string) => Promise<'approved' | 'pending'>,
  concurrency = 5
): Promise<MemberAssignmentBulkResult> {
  const outcomes = new Map<
    string,
    { kind: 'approved' | 'pending' } | { kind: 'failed'; error: unknown }
  >();
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < contactIds.length) {
      const contactId = contactIds[nextIndex++];
      try {
        outcomes.set(contactId, { kind: await request(contactId) });
      } catch (error) {
        outcomes.set(contactId, { kind: 'failed', error });
      }
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(Math.max(1, concurrency), contactIds.length) },
      () => worker()
    )
  );

  return {
    approvedIds: contactIds.filter(
      (id) => outcomes.get(id)?.kind === 'approved'
    ),
    pendingIds: contactIds.filter((id) => outcomes.get(id)?.kind === 'pending'),
    failed: contactIds.flatMap((id) => {
      const outcome = outcomes.get(id);
      return outcome?.kind === 'failed' ? [{ id, error: outcome.error }] : [];
    }),
  };
}
