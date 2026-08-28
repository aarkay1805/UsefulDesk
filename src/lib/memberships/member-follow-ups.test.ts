import { describe, expect, it, vi } from 'vitest';

import {
  loadMemberFollowUps,
  memberFollowUpsRpcArgs,
  parseMemberFollowUpsPage,
  type MemberFollowUpsQuery,
} from './member-follow-ups';
import { UNASSIGNED_FOLLOW_UP } from './follow-up-filters';

const query: MemberFollowUpsQuery = {
  today: '2026-08-28',
  search: '1001',
  scope: 'team',
  filters: {
    reasons: ['renewal', 'payment'],
    assignees: [UNASSIGNED_FOLLOW_UP, '11111111-1111-4111-8111-111111111111'],
    buckets: ['overdue'],
  },
  sort: { key: 'customer', dir: 'desc' },
  page: 2,
  pageSize: 25,
};

const response = {
  rows: [
    {
      id: 'follow-up-1',
      membership_id: 'membership-1',
      created_by: 'user-1',
      assigned_to: null,
      reason: 'renewal',
      task_type: 'call',
      due_date: '2026-08-27',
      status: 'open',
      note: 'Call after lunch',
      contact: { id: 'contact-1', name: 'Asha Rao' },
      membership: {
        id: 'membership-1',
        member_number: '1001',
        start_date: '2026-08-01',
        end_date: '2026-09-01',
        fee_amount: '2500.00',
        contact: { id: 'contact-1', name: 'Asha Rao' },
      },
    },
  ],
  page: '2',
  totalCount: '61',
  bucketCounts: {
    all: '70',
    overdue: '18',
    today: '4',
    upcoming: '48',
  },
};

describe('member follow-ups RPC client', () => {
  it('maps every filter, owner scope, sort, and page to one bounded RPC', () => {
    expect(memberFollowUpsRpcArgs(query)).toEqual({
      p_today: '2026-08-28',
      p_search: '1001',
      p_scope: 'team',
      p_reasons: ['renewal', 'payment'],
      p_assignee_ids: ['11111111-1111-4111-8111-111111111111'],
      p_include_unassigned: true,
      p_buckets: ['overdue'],
      p_sort_key: 'customer',
      p_sort_direction: 'desc',
      p_page: 2,
      p_page_size: 25,
    });
  });

  it('preserves rows, authored/assigned identity, exact totals, and facets', () => {
    expect(parseMemberFollowUpsPage(response)).toEqual({
      rows: [
        expect.objectContaining({
          id: 'follow-up-1',
          created_by: 'user-1',
          assigned_to: null,
          due_date: '2026-08-27',
          contact: expect.objectContaining({ name: 'Asha Rao' }),
          membership: expect.objectContaining({
            member_number: 1001,
            fee_amount: 2500,
          }),
        }),
      ],
      page: 2,
      totalCount: 61,
      bucketCounts: { all: 70, overdue: 18, today: 4, upcoming: 48 },
    });
  });

  it('accepts the exact empty result and rejects malformed boundaries', () => {
    expect(
      parseMemberFollowUpsPage({
        rows: [],
        page: 0,
        totalCount: 0,
        bucketCounts: { all: 0, overdue: 0, today: 0, upcoming: 0 },
      })
    ).toEqual({
      rows: [],
      page: 0,
      totalCount: 0,
      bucketCounts: { all: 0, overdue: 0, today: 0, upcoming: 0 },
    });
    expect(() =>
      parseMemberFollowUpsPage({ ...response, totalCount: -1 })
    ).toThrow('Invalid member follow-up total count');
    expect(() =>
      parseMemberFollowUpsPage({ ...response, rows: [{ id: 'bad' }] })
    ).toThrow('Invalid member follow-up row 1 contact');
  });

  it('uses one abortable database request and surfaces database errors', async () => {
    const abortSignal = vi.fn().mockResolvedValue({
      data: response,
      error: null,
    });
    const rpc = vi.fn().mockReturnValue({ abortSignal });
    const supabase = { rpc } as unknown as Parameters<
      typeof loadMemberFollowUps
    >[0];
    const controller = new AbortController();

    await expect(
      loadMemberFollowUps(supabase, query, controller.signal)
    ).resolves.toMatchObject({ totalCount: 61, page: 2 });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith(
      'member_follow_ups_page',
      memberFollowUpsRpcArgs(query)
    );
    expect(abortSignal).toHaveBeenCalledWith(controller.signal);

    abortSignal.mockResolvedValueOnce({
      data: null,
      error: new Error('denied'),
    });
    await expect(
      loadMemberFollowUps(supabase, query, controller.signal)
    ).rejects.toThrow('denied');
  });
});
