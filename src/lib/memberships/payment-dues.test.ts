import { describe, expect, it, vi } from 'vitest';

import {
  loadMemberPaymentDues,
  memberPaymentDuesRpcArgs,
  parseMemberPaymentDuesPage,
  type MemberPaymentDuesQuery,
} from './payment-dues';

const query: MemberPaymentDuesQuery = {
  today: '2026-08-28',
  search: '1001',
  filters: {
    plans: ['11111111-1111-1111-1111-111111111111'],
    buckets: ['overdue'],
  },
  sort: { key: 'balance', dir: 'desc' },
  page: 2,
  pageSize: 25,
};

const response = {
  rows: [
    {
      id: 'membership-1',
      member_number: '1001',
      start_date: '2026-08-01',
      fee_amount: '900.50',
      balance: '400.25',
    },
  ],
  page: 2,
  totalCount: '61',
  outstandingCount: '70',
  bucketCounts: { due_today: '3', overdue: '64' },
  planOptions: [
    { id: '11111111-1111-1111-1111-111111111111', name: 'Monthly' },
  ],
  summary: {
    today: '1500.00',
    week: '7200.50',
    month: '24000.75',
    outstanding: '10000.25',
  },
};

describe('member payment dues RPC client', () => {
  it('maps every listing input to one bounded RPC contract', () => {
    expect(memberPaymentDuesRpcArgs(query)).toEqual({
      p_today: '2026-08-28',
      p_search: '1001',
      p_plan_ids: ['11111111-1111-1111-1111-111111111111'],
      p_buckets: ['overdue'],
      p_sort_key: 'balance',
      p_sort_direction: 'desc',
      p_page: 2,
      p_page_size: 25,
    });
  });

  it('normalizes JSON numeric values without changing rows or totals', () => {
    expect(parseMemberPaymentDuesPage(response)).toEqual({
      rows: [
        expect.objectContaining({
          id: 'membership-1',
          member_number: 1001,
          fee_amount: 900.5,
          balance: 400.25,
        }),
      ],
      page: 2,
      totalCount: 61,
      outstandingCount: 70,
      bucketCounts: { due_today: 3, overdue: 64 },
      planOptions: [
        { id: '11111111-1111-1111-1111-111111111111', name: 'Monthly' },
      ],
      summary: {
        today: 1500,
        week: 7200.5,
        month: 24000.75,
        outstanding: 10000.25,
      },
    });
  });

  it('rejects malformed boundaries and totals', () => {
    expect(() =>
      parseMemberPaymentDuesPage({ ...response, totalCount: -1 })
    ).toThrow('Invalid member payment total count');
    expect(() =>
      parseMemberPaymentDuesPage({
        ...response,
        summary: { ...response.summary, outstanding: 'NaN' },
      })
    ).toThrow('Invalid member payment outstanding total');
    expect(() => parseMemberPaymentDuesPage({ ...response, rows: {} })).toThrow(
      'Invalid member payment rows'
    );
  });

  it('uses one abortable database request and surfaces database errors', async () => {
    const abortSignal = vi.fn().mockResolvedValue({
      data: response,
      error: null,
    });
    const rpc = vi.fn().mockReturnValue({ abortSignal });
    const supabase = { rpc } as unknown as Parameters<
      typeof loadMemberPaymentDues
    >[0];
    const controller = new AbortController();

    await expect(
      loadMemberPaymentDues(supabase, query, controller.signal)
    ).resolves.toMatchObject({ totalCount: 61, page: 2 });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith(
      'member_payment_dues_page',
      memberPaymentDuesRpcArgs(query)
    );
    expect(abortSignal).toHaveBeenCalledWith(controller.signal);

    abortSignal.mockResolvedValueOnce({
      data: null,
      error: new Error('denied'),
    });
    await expect(
      loadMemberPaymentDues(supabase, query, controller.signal)
    ).rejects.toThrow('denied');
  });
});
