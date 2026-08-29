import { describe, expect, it, vi } from 'vitest';

import {
  buildMemberBulkEditProperties,
  proveMemberBulkWrite,
  runMemberAssignmentBulkEdit,
} from './member-bulk-edit';

describe('All Members bulk edit', () => {
  it('exposes only Assigned to, active Trainer choices, and canonical Churn risk values', () => {
    const properties = buildMemberBulkEditProperties(
      [{ user_id: 'staff-1', full_name: 'Asha' }],
      [
        { id: 'trainer-active', display_name: 'Dev', is_active: true },
        { id: 'trainer-archived', display_name: 'Ira', is_active: false },
      ]
    );

    expect(properties.map(({ key, label }) => ({ key, label }))).toEqual([
      { key: 'assignee', label: 'Assigned to' },
      { key: 'trainer', label: 'Trainer' },
      { key: 'churnRisk', label: 'Churn risk' },
    ]);
    expect(
      properties.every((property) => property.group === 'Member fields')
    ).toBe(true);
    expect(properties[1].editor).toMatchObject({
      kind: 'select',
      options: [
        { value: '__no_trainer__', label: 'No trainer' },
        { value: 'trainer-active', label: 'Dev' },
      ],
    });
    expect(properties[2].editor).toMatchObject({
      kind: 'select',
      options: [
        { value: 'yes', label: 'Yes' },
        { value: 'no', label: 'No' },
      ],
    });
  });

  it('reports approved, pending, and failed assignment outcomes independently', async () => {
    const request = vi.fn(async (id: string) => {
      if (id === 'pending') return 'pending' as const;
      if (id === 'failed') throw new Error('blocked');
      return 'approved' as const;
    });

    await expect(
      runMemberAssignmentBulkEdit(['approved', 'pending', 'failed'], request, 2)
    ).resolves.toEqual({
      approvedIds: ['approved'],
      pendingIds: ['pending'],
      failed: [{ id: 'failed', error: expect.any(Error) }],
    });
    expect(request).toHaveBeenCalledTimes(3);
  });

  it('proves returned writes for partial-failure reconciliation', () => {
    const outcome = proveMemberBulkWrite(
      ['contact-1', 'contact-2', 'contact-3'],
      [{ id: 'contact-1' }, { id: 'contact-3' }]
    );
    expect(outcome).toEqual({
      succeededIds: ['contact-1', 'contact-3'],
      failedIds: ['contact-2'],
    });
  });
});
