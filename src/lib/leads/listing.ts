import type { SupabaseClient } from '@supabase/supabase-js';

import type { Contact, Tag } from '@/types';
import type { LeadQuickFilter } from '@/lib/leads/quick-filters';

export const LEAD_BOARD_LIMIT = 500;

export type LeadListingMode = 'table' | 'board' | 'ids' | 'export';
export type LeadListingSortDirection = 'asc' | 'desc';
export type LeadListingSortKey =
  | 'name'
  | 'lead_status'
  | 'phone'
  | 'email'
  | 'company'
  | 'source'
  | 'gender'
  | 'received_via'
  | 'created_at'
  | 'assigned_name'
  | 'created_by_name'
  | 'tag_name'
  | 'custom';

export interface LeadListingSort {
  key: LeadListingSortKey;
  direction: LeadListingSortDirection;
  customFieldId?: string | null;
}

export interface LeadListingFiltersInput {
  owner: string[];
  assigned: string[];
  createdBy: string[];
  leadStatus: string[];
  source: string[];
  tags: string[];
  gender: string[];
  customValues: Record<string, string[]>;
  createdSince: string | null;
}

export interface LeadListingInput {
  accountId: string;
  mode: LeadListingMode;
  search: string;
  filters: LeadListingFiltersInput;
  quickFilter: LeadQuickFilter;
  todayStart: string;
  tomorrowStart: string;
  sort: LeadListingSort;
  page: number;
  pageSize: number | null;
  activeCustomFieldIds: string[];
}

export interface LeadListingContact extends Contact {
  tags: Tag[];
  customValues: Record<string, string>;
}

export interface LeadQuickFilterCounts {
  no_followup: number;
  unassigned: number;
  mine: number;
  new_today: number;
}

export interface LeadListingSnapshot {
  rows: LeadListingContact[];
  totalCount: number;
  quickFilterCounts: LeadQuickFilterCounts;
}

const EMPTY_COUNTS: LeadQuickFilterCounts = {
  no_followup: 0,
  unassigned: 0,
  mine: 0,
  new_today: 0,
};

const UNASSIGNED = '__unassigned__';
const PENDING_PREFIX = 'pending:';

function finiteCount(value: unknown): number {
  const count = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(count) && count >= 0 ? count : 0;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

export function normalizeLeadListingSnapshot(
  value: unknown
): LeadListingSnapshot {
  const root =
    value && typeof value === 'object'
      ? (value as Record<string, unknown>)
      : {};
  const counts =
    root.quickFilterCounts && typeof root.quickFilterCounts === 'object'
      ? (root.quickFilterCounts as Record<string, unknown>)
      : {};

  const rows = (Array.isArray(root.rows) ? root.rows : []).map((raw) => {
    const row =
      raw && typeof raw === 'object'
        ? (raw as Record<string, unknown>)
        : ({} as Record<string, unknown>);
    const customValues =
      row.customValues && typeof row.customValues === 'object'
        ? Object.fromEntries(
            Object.entries(row.customValues as Record<string, unknown>).map(
              ([key, item]) => [key, item == null ? '' : String(item)]
            )
          )
        : {};
    return {
      ...row,
      tags: Array.isArray(row.tags) ? (row.tags as Tag[]) : [],
      customValues,
    } as unknown as LeadListingContact;
  });

  return {
    rows,
    totalCount: finiteCount(root.totalCount),
    quickFilterCounts: {
      ...EMPTY_COUNTS,
      no_followup: finiteCount(counts.no_followup),
      unassigned: finiteCount(counts.unassigned),
      mine: finiteCount(counts.mine),
      new_today: finiteCount(counts.new_today),
    },
  };
}

export function buildLeadListingRpcArgs(input: LeadListingInput) {
  const assignedIds = input.filters.assigned.filter(
    (value) => value !== UNASSIGNED && !value.startsWith(PENDING_PREFIX)
  );
  const pendingInvitationIds = input.filters.assigned
    .filter((value) => value.startsWith(PENDING_PREFIX))
    .map((value) => value.slice(PENDING_PREFIX.length));

  return {
    p_account_id: input.accountId,
    p_mode: input.mode,
    p_search: input.search.trim(),
    p_owner_ids: input.filters.owner,
    p_assigned_ids: assignedIds,
    p_include_unassigned: input.filters.assigned.includes(UNASSIGNED),
    p_pending_invitation_ids: pendingInvitationIds,
    p_created_by_ids: input.filters.createdBy,
    p_lead_statuses: input.filters.leadStatus,
    p_sources: input.filters.source,
    p_tag_ids: input.filters.tags,
    p_genders: input.filters.gender,
    p_created_since: input.filters.createdSince,
    p_custom_filters: input.filters.customValues,
    p_quick_filter: input.quickFilter,
    p_today_start: input.todayStart,
    p_tomorrow_start: input.tomorrowStart,
    p_sort_key: input.sort.key,
    p_sort_direction: input.sort.direction,
    p_sort_custom_field_id: input.sort.customFieldId ?? null,
    p_page: input.page,
    p_page_size: input.pageSize,
    p_active_custom_field_ids: input.activeCustomFieldIds,
  };
}

export function leadListingRequestKey(input: LeadListingInput): string {
  return JSON.stringify(buildLeadListingRpcArgs(input));
}

export function leadListingScopeKey(input: {
  search: string;
  filters: Omit<LeadListingFiltersInput, 'createdSince'> & {
    createdRange?: string;
  };
  quickFilter: LeadQuickFilter;
}): string {
  return JSON.stringify([
    input.search.trim(),
    input.filters,
    input.quickFilter,
  ]);
}

export function pageForLeadListingScope(
  previousScopeKey: string,
  nextScopeKey: string,
  page: number
): number {
  return previousScopeKey === nextScopeKey ? page : 0;
}

interface RpcResponse {
  data: unknown;
  error: { message?: string } | null;
}

interface AbortableRpcRequest extends PromiseLike<RpcResponse> {
  abortSignal(signal: AbortSignal): PromiseLike<RpcResponse>;
}

export interface LeadListingRpcClient {
  rpc(name: string, args: Record<string, unknown>): AbortableRpcRequest;
}

export async function loadLeadListingSnapshot(
  client: LeadListingRpcClient,
  input: LeadListingInput,
  signal: AbortSignal
): Promise<LeadListingSnapshot> {
  const request = client.rpc(
    'lead_listing_snapshot',
    buildLeadListingRpcArgs(input)
  );
  const { data, error } = await request.abortSignal(signal);
  if (error) throw new Error(error.message || 'Failed to load leads');
  return normalizeLeadListingSnapshot(data);
}

/**
 * One page owns one coordinator. Strict-effect replays and simultaneous
 * consumers of the same key share the in-flight RPC; a genuinely newer key
 * aborts the superseded database request before starting its replacement.
 */
export class LeadListingRequestCoordinator {
  private current:
    | {
        key: string;
        controller: AbortController;
        promise: Promise<LeadListingSnapshot>;
      }
    | undefined;

  load(
    client: LeadListingRpcClient,
    input: LeadListingInput
  ): Promise<LeadListingSnapshot> {
    const key = leadListingRequestKey(input);
    if (this.current?.key === key) return this.current.promise;

    this.current?.controller.abort();
    const controller = new AbortController();
    const promise = loadLeadListingSnapshot(
      client,
      input,
      controller.signal
    ).finally(() => {
      if (this.current?.promise === promise) this.current = undefined;
    });
    this.current = { key, controller, promise };
    return promise;
  }

  abort() {
    this.current?.controller.abort();
    this.current = undefined;
  }
}

export function asLeadListingRpcClient(
  client: SupabaseClient
): LeadListingRpcClient {
  return client as unknown as LeadListingRpcClient;
}

export function idsFromLeadListing(snapshot: LeadListingSnapshot): string[] {
  return stringArray(snapshot.rows.map((row) => row.id));
}
