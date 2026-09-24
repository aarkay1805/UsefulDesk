import { describe, expect, it } from 'vitest';

import {
  assignedArrivalOptions,
  normalizeAssignedArrivalTime,
  saveAssignedArrivalTime,
} from './assigned-arrival';

describe('assigned arrival time', () => {
  it('offers each half-hour in a day and a clear choice', () => {
    const options = assignedArrivalOptions((value) => value);
    expect(options).toHaveLength(49);
    expect(options[0]).toEqual({ value: '', label: 'Not assigned' });
    expect(options[1]).toEqual({ value: '00:00', label: '00:00' });
    expect(options[16]).toEqual({ value: '07:30', label: '07:30' });
    expect(options[48]).toEqual({ value: '23:30', label: '23:30' });
  });

  it('accepts database time values but rejects times outside the presets', () => {
    expect(normalizeAssignedArrivalTime('07:30:00')).toBe('07:30');
    expect(normalizeAssignedArrivalTime('07:30')).toBe('07:30');
    expect(normalizeAssignedArrivalTime(null)).toBeNull();
    expect(normalizeAssignedArrivalTime('07:15')).toBeNull();
    expect(normalizeAssignedArrivalTime('24:00')).toBeNull();
  });

  it('writes a cleared time only to the chosen account contact and proves a row changed', async () => {
    const calls: unknown[][] = [];
    const query = {
      update(patch: unknown) {
        calls.push(['update', patch]);
        return this;
      },
      eq(column: string, value: string) {
        calls.push(['eq', column, value]);
        return this;
      },
      select(columns: string) {
        calls.push(['select', columns]);
        return Promise.resolve({ data: [{ id: 'contact-1' }], error: null });
      },
    };
    const client = {
      from: (table: string) => {
        calls.push(['from', table]);
        return query;
      },
    };

    await saveAssignedArrivalTime(
      client as never,
      'account-1',
      'contact-1',
      ''
    );
    expect(calls).toEqual([
      ['from', 'contacts'],
      ['update', { assigned_arrival_time: null }],
      ['eq', 'id', 'contact-1'],
      ['eq', 'account_id', 'account-1'],
      ['select', 'id'],
    ]);
  });

  it('rejects non-preset times and RLS-blocked zero-row updates', async () => {
    const client = {
      from: () => ({
        update: () => ({
          eq: () => ({
            eq: () => ({ select: async () => ({ data: [], error: null }) }),
          }),
        }),
      }),
    };
    await expect(
      saveAssignedArrivalTime(
        client as never,
        'account-1',
        'contact-1',
        '07:15'
      )
    ).rejects.toThrow('Choose a 30-minute arrival time');
    await expect(
      saveAssignedArrivalTime(
        client as never,
        'account-1',
        'contact-1',
        '07:30'
      )
    ).rejects.toThrow('Could not update assigned arrival');
  });
});
