import { describe, expect, it, vi } from 'vitest';

import {
  attendanceSnapshotRpcArgs,
  loadAttendanceSnapshot,
  parseAttendanceSnapshotPage,
  type AttendanceSnapshotQuery,
} from './attendance-snapshot';

const query: AttendanceSnapshotQuery = {
  dayStart: '2026-08-27T18:30:00.000Z',
  dayEnd: '2026-08-28T18:30:00.000Z',
  today: '2026-08-28',
  timeZone: 'Asia/Kolkata',
  weekStart: 1,
  includeUsage: true,
  bucket: 'absent',
  search: '1001',
  planIds: ['11111111-1111-1111-1111-111111111111'],
  sort: { key: 'checked_in_at', dir: 'desc' },
  page: 2,
  pageSize: 25,
};

const response = {
  rows: [
    {
      membership: {
        id: 'membership-1',
        account_id: 'account-1',
        contact_id: 'contact-1',
        member_number: '1001',
        start_date: '2026-08-01',
        end_date: '2026-09-01',
        fee_amount: '900.50',
        contact: { id: 'contact-1', name: 'Asha Rao' },
        plan: {
          id: '11111111-1111-1111-1111-111111111111',
          price: '900.50',
          duration_days: '30',
        },
      },
      attendance: {
        id: 'attendance-1',
        checked_in_at: '2026-08-28T03:30:00Z',
        checked_out_at: null,
      },
      used: '7',
    },
  ],
  page: '2',
  totalCount: '61',
  presentCount: '9',
  absentCount: '70',
  planOptions: [
    { value: '11111111-1111-1111-1111-111111111111', label: 'Monthly' },
  ],
};

describe('member attendance RPC client', () => {
  it('maps every listing, date, usage, and page input to one RPC contract', () => {
    expect(attendanceSnapshotRpcArgs(query)).toEqual({
      p_day_start: '2026-08-27T18:30:00.000Z',
      p_day_end: '2026-08-28T18:30:00.000Z',
      p_today: '2026-08-28',
      p_time_zone: 'Asia/Kolkata',
      p_week_start: 1,
      p_include_usage: true,
      p_bucket: 'absent',
      p_search: '1001',
      p_plan_ids: ['11111111-1111-1111-1111-111111111111'],
      p_sort_key: 'checked_in_at',
      p_sort_direction: 'desc',
      p_page: 2,
      p_page_size: 25,
    });
  });

  it('normalizes the row, usage, exact facets, options, and page', () => {
    expect(parseAttendanceSnapshotPage(response)).toEqual({
      rows: [
        expect.objectContaining({
          membership: expect.objectContaining({
            id: 'membership-1',
            member_number: 1001,
            fee_amount: 900.5,
            plan: expect.objectContaining({
              price: 900.5,
              duration_days: 30,
            }),
          }),
          attendance: expect.objectContaining({ id: 'attendance-1' }),
          used: 7,
        }),
      ],
      page: 2,
      totalCount: 61,
      presentCount: 9,
      absentCount: 70,
      planOptions: [
        {
          value: '11111111-1111-1111-1111-111111111111',
          label: 'Monthly',
        },
      ],
    });
  });

  it('preserves absent rows and zero usage while rejecting malformed bounds', () => {
    expect(
      parseAttendanceSnapshotPage({
        ...response,
        rows: [
          {
            ...response.rows[0],
            attendance: null,
            used: 0,
          },
        ],
      }).rows[0]
    ).toMatchObject({ attendance: null, used: 0 });
    expect(() =>
      parseAttendanceSnapshotPage({ ...response, absentCount: -1 })
    ).toThrow('Invalid attendance absent count');
    expect(() =>
      parseAttendanceSnapshotPage({ ...response, planOptions: {} })
    ).toThrow('Invalid attendance plan options');
    expect(() =>
      parseAttendanceSnapshotPage({
        ...response,
        rows: [{ ...response.rows[0], used: 'NaN' }],
      })
    ).toThrow('Invalid attendance row 1 usage');
  });

  it('uses one abortable request and surfaces database errors', async () => {
    const abortSignal = vi.fn().mockResolvedValue({
      data: response,
      error: null,
    });
    const rpc = vi.fn().mockReturnValue({ abortSignal });
    const supabase = { rpc } as unknown as Parameters<
      typeof loadAttendanceSnapshot
    >[0];
    const controller = new AbortController();

    await expect(
      loadAttendanceSnapshot(supabase, query, controller.signal)
    ).resolves.toMatchObject({ totalCount: 61, page: 2 });
    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith(
      'member_attendance_page',
      attendanceSnapshotRpcArgs(query)
    );
    expect(abortSignal).toHaveBeenCalledWith(controller.signal);

    abortSignal.mockResolvedValueOnce({
      data: null,
      error: new Error('denied'),
    });
    await expect(
      loadAttendanceSnapshot(supabase, query, controller.signal)
    ).rejects.toThrow('denied');
  });
});
