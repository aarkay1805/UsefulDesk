import { describe, expect, it } from 'vitest';

import {
  LEAD_BOARD_LIMIT,
  LeadListingRequestCoordinator,
  buildLeadListingRpcArgs,
  idsFromLeadListing,
  leadListingRequestKey,
  leadListingScopeKey,
  normalizeLeadListingSnapshot,
  pageForLeadListingScope,
  type LeadListingInput,
  type LeadListingRpcClient,
} from './listing';

const ACCOUNT_ID = '00000000-0000-4000-8000-000000000001';
const FIELD_ID = '00000000-0000-4000-8000-000000000002';
const TAG_ID = '00000000-0000-4000-8000-000000000003';

function input(overrides: Partial<LeadListingInput> = {}): LeadListingInput {
  return {
    accountId: ACCOUNT_ID,
    mode: 'table',
    search: '  Aarav  ',
    filters: {
      owner: ['00000000-0000-4000-8000-000000000010'],
      assigned: [
        '__unassigned__',
        '00000000-0000-4000-8000-000000000011',
        'pending:00000000-0000-4000-8000-000000000012',
      ],
      createdBy: ['00000000-0000-4000-8000-000000000013'],
      leadStatus: ['new', 'qualified'],
      source: ['referral'],
      tags: [TAG_ID],
      gender: ['male'],
      customValues: { [FIELD_ID]: ['Gold', 'Silver'] },
      createdSince: '2026-08-01T00:00:00.000Z',
    },
    quickFilter: 'no_followup',
    todayStart: '2026-08-27T18:30:00.000Z',
    tomorrowStart: '2026-08-28T18:30:00.000Z',
    sort: { key: 'custom', direction: 'desc', customFieldId: FIELD_ID },
    page: 2,
    pageSize: 25,
    activeCustomFieldIds: [FIELD_ID],
    ...overrides,
  };
}

function deferredClient() {
  let resolve!: (value: {
    data: unknown;
    error: { message?: string } | null;
  }) => void;
  const promise = new Promise<{
    data: unknown;
    error: { message?: string } | null;
  }>((done) => {
    resolve = done;
  });
  let calls = 0;
  let signal: AbortSignal | undefined;
  const request = {
    then: promise.then.bind(promise),
    abortSignal(nextSignal: AbortSignal) {
      signal = nextSignal;
      return promise;
    },
  };
  const client = {
    rpc(name: string) {
      expect(name).toBe('lead_listing_snapshot');
      calls += 1;
      return request;
    },
  } as LeadListingRpcClient;
  return {
    client,
    get calls() {
      return calls;
    },
    get signal() {
      return signal;
    },
    resolve,
  };
}

describe('lead listing RPC arguments', () => {
  it('normalizes every detailed filter into the named SQL contract', () => {
    expect(buildLeadListingRpcArgs(input())).toEqual({
      p_account_id: ACCOUNT_ID,
      p_mode: 'table',
      p_search: 'Aarav',
      p_owner_ids: ['00000000-0000-4000-8000-000000000010'],
      p_assigned_ids: ['00000000-0000-4000-8000-000000000011'],
      p_include_unassigned: true,
      p_pending_invitation_ids: ['00000000-0000-4000-8000-000000000012'],
      p_created_by_ids: ['00000000-0000-4000-8000-000000000013'],
      p_lead_statuses: ['new', 'qualified'],
      p_sources: ['referral'],
      p_tag_ids: [TAG_ID],
      p_genders: ['male'],
      p_created_since: '2026-08-01T00:00:00.000Z',
      p_custom_filters: { [FIELD_ID]: ['Gold', 'Silver'] },
      p_quick_filter: 'no_followup',
      p_today_start: '2026-08-27T18:30:00.000Z',
      p_tomorrow_start: '2026-08-28T18:30:00.000Z',
      p_sort_key: 'custom',
      p_sort_direction: 'desc',
      p_sort_custom_field_id: FIELD_ID,
      p_page: 2,
      p_page_size: 25,
      p_active_custom_field_ids: [FIELD_ID],
    });
  });

  it('keeps ordinary board requests bounded and bulk modes explicit', () => {
    const board = input({
      mode: 'board',
      page: 0,
      pageSize: LEAD_BOARD_LIMIT,
      activeCustomFieldIds: [],
    });
    const ids = input({
      mode: 'ids',
      page: 0,
      pageSize: null,
      activeCustomFieldIds: [],
    });

    expect(buildLeadListingRpcArgs(board).p_page_size).toBe(500);
    expect(buildLeadListingRpcArgs(ids)).toMatchObject({
      p_mode: 'ids',
      p_page: 0,
      p_page_size: null,
    });
    expect(buildLeadListingRpcArgs(ids)).not.toHaveProperty('p_include_facets');
  });
});

describe('lead listing response normalization', () => {
  it('normalizes counts, hydrated tags, custom values, and id results', () => {
    const snapshot = normalizeLeadListingSnapshot({
      rows: [
        {
          id: 'lead-1',
          phone: '919999999999',
          created_at: '2026-08-28T00:00:00Z',
          updated_at: '2026-08-28T00:00:00Z',
          tags: [{ id: TAG_ID, name: 'VIP', color: '#fff' }],
          customValues: { [FIELD_ID]: 42 },
        },
      ],
      totalCount: '9',
      quickFilterCounts: {
        no_followup: '3',
        unassigned: 2,
        mine: null,
        new_today: -1,
      },
    });

    expect(snapshot.totalCount).toBe(9);
    expect(snapshot.quickFilterCounts).toEqual({
      no_followup: 3,
      unassigned: 2,
      mine: 0,
      new_today: 0,
    });
    expect(snapshot.rows[0].tags[0].name).toBe('VIP');
    expect(snapshot.rows[0].customValues[FIELD_ID]).toBe('42');
    expect(idsFromLeadListing(snapshot)).toEqual(['lead-1']);
  });
});

describe('lead listing request lifecycle', () => {
  it('resets a changed search/filter scope before constructing the request', () => {
    const previous = leadListingScopeKey({
      search: '',
      filters: {
        ...input().filters,
        createdRange: 'all',
      },
      quickFilter: 'all',
    });
    const next = leadListingScopeKey({
      search: 'Aarav',
      filters: {
        ...input().filters,
        createdRange: 'all',
      },
      quickFilter: 'all',
    });

    expect(pageForLeadListingScope(previous, next, 4)).toBe(0);
    expect(pageForLeadListingScope(next, next, 4)).toBe(4);
  });

  it('shares simultaneous identical requests instead of issuing duplicates', async () => {
    const deferred = deferredClient();
    const coordinator = new LeadListingRequestCoordinator();
    const request = input();

    const first = coordinator.load(deferred.client, request);
    const second = coordinator.load(deferred.client, request);
    expect(second).toBe(first);
    expect(deferred.calls).toBe(1);

    deferred.resolve({ data: { rows: [], totalCount: 0 }, error: null });
    await expect(first).resolves.toMatchObject({ rows: [], totalCount: 0 });
  });

  it('aborts superseded database work when the request key changes', async () => {
    const firstClient = deferredClient();
    const secondClient = deferredClient();
    const coordinator = new LeadListingRequestCoordinator();

    const first = coordinator.load(firstClient.client, input());
    const secondInput = input({ page: 3 });
    expect(leadListingRequestKey(secondInput)).not.toBe(
      leadListingRequestKey(input())
    );
    const second = coordinator.load(secondClient.client, secondInput);

    expect(firstClient.signal?.aborted).toBe(true);
    expect(firstClient.calls).toBe(1);
    expect(secondClient.calls).toBe(1);
    firstClient.resolve({ data: { rows: [] }, error: null });
    secondClient.resolve({ data: { rows: [] }, error: null });
    await Promise.all([first, second]);
  });
});
