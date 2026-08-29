import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
  EMPTY_MEMBER_FILTERS,
  NO_TRAINER_MEMBER_FILTER,
  UNASSIGNED_MEMBER_FILTER,
} from './filters';
import {
  loadMemberDirectory,
  memberDirectoryRpcArgs,
  memberDirectorySortKey,
  parseMemberDirectoryPage,
  type MemberDirectoryQuery,
} from './member-directory';

const directoryMigration = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/20260828210000_member_customer_directory_page.sql'
  ),
  'utf8'
);
const migration = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/20260829080000_member_directory_assignment_trainer_filters.sql'
  ),
  'utf8'
);
const compatibilityMigration = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/20260829081000_default_member_directory_filter_facets.sql'
  ),
  'utf8'
);
const component = readFileSync(
  resolve(process.cwd(), 'src/components/members/members-table.tsx'),
  'utf8'
);
const search = readFileSync(
  resolve(process.cwd(), 'src/lib/memberships/search.ts'),
  'utf8'
);

const query: MemberDirectoryQuery = {
  today: '2026-08-28',
  search: '042',
  filters: {
    plans: ['11111111-1111-1111-1111-111111111111'],
    statuses: ['active'],
    assignees: [
      '22222222-2222-2222-2222-222222222222',
      UNASSIGNED_MEMBER_FILTER,
    ],
    trainers: [
      '33333333-3333-3333-3333-333333333333',
      NO_TRAINER_MEMBER_FILTER,
    ],
    feeStatus: ['due'],
    churnRisk: ['yes'],
    followUps: ['open'],
  },
  sort: { key: 'fee_amount', dir: 'desc' as const },
  page: 2,
  pageSize: 25,
};

describe('member_customer_directory_page SQL contract', () => {
  it('keeps the directory and RPC on caller privileges with authenticated-only execution', () => {
    expect(directoryMigration).toContain(
      'VIEW public.member_customer_directory\nWITH (security_invoker = true)'
    );
    expect(migration).toContain('SECURITY INVOKER');
    expect(migration).not.toContain('SECURITY DEFINER');
    expect(migration).not.toContain('p_account_id');
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.member_customer_directory_page\([\s\S]*?FROM PUBLIC, anon, service_role;/
    );
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.member_customer_directory_page\([\s\S]*?TO authenticated;/
    );
  });

  it('keeps set-wise source aggregates and one materialized directory for each snapshot', () => {
    expect(directoryMigration).not.toMatch(/\bLATERAL\b/);
    for (const cte of [
      'latest_membership AS',
      'services AS',
      'billing AS',
      'open_follow_ups AS',
    ]) {
      expect(directoryMigration).toContain(cte);
    }
    expect(migration.match(/directory AS MATERIALIZED/g)).toHaveLength(1);
    expect(migration.match(/evaluated AS MATERIALIZED/g)).toHaveLength(1);
    expect(migration).toContain("'rows'");
    expect(migration).toContain("'totalCount'");
    expect(migration).toContain("'quickFilterCounts'");
    expect(migration).toContain("'churnRisk'");
    expect(migration).toContain("'feesDue'");
    expect(migration).toContain("'followUps'");
  });

  it('preserves numeric/non-numeric search and every filter and sort dimension', () => {
    const numericBranch = migration.slice(
      migration.indexOf("v_search ~ '^[0-9]+$'"),
      migration.indexOf("v_search !~ '^[0-9]+$'")
    );
    expect(numericBranch).toContain('directory_row.contact_name ILIKE');
    expect(numericBranch).toContain('directory_row.contact_phone ILIKE');
    expect(numericBranch).toContain('directory_row.member_number::TEXT ILIKE');
    expect(numericBranch).not.toContain('contact_email');
    expect(
      migration.slice(migration.indexOf("v_search !~ '^[0-9]+$'"))
    ).toContain('directory_row.contact_email ILIKE');

    for (const value of [
      'active',
      'expired',
      'frozen',
      'cancelled',
      'trial',
      'service_customer',
      'membership_fee_status',
      'contact_churn_risk',
      'open_follow_up_count',
      'contact_assigned_to',
      "contact ->> 'trainer_id'",
      'assignee_matches',
      'trainer_matches',
    ]) {
      expect(migration).toContain(value);
    }
    for (const sort of [
      'contact_name',
      'member_number',
      'display_expiry',
      'membership_fee_amount',
      'membership_fee_status',
      'membership_start_date',
    ]) {
      expect(migration).toContain(`v_sort_key = '${sort}'`);
    }
  });

  it('rejects invalid page, filter, and sort inputs without weakening an unbounded explicit action', () => {
    expect(migration).toContain("USING ERRCODE = '22004'");
    expect(migration.match(/USING ERRCODE = '22023'/g)?.length).toBeGreaterThan(
      5
    );
    expect(migration).toContain('p_page_size < 1 OR p_page_size > 1000');
    expect(migration).toContain('p_page_size IS NULL AND p_page <> 0');
    expect(migration).toContain('LIMIT p_page_size');
  });
});

describe('All-members RPC client contract', () => {
  it('maps every current UI query input to the single RPC', () => {
    expect(memberDirectoryRpcArgs(query)).toEqual({
      p_today: '2026-08-28',
      p_search: '042',
      p_plan_ids: ['11111111-1111-1111-1111-111111111111'],
      p_statuses: ['active'],
      p_fee_statuses: ['due'],
      p_assignee_ids: ['22222222-2222-2222-2222-222222222222'],
      p_include_unassigned: true,
      p_trainer_ids: ['33333333-3333-3333-3333-333333333333'],
      p_include_no_trainer: true,
      p_churn_risk: ['yes'],
      p_follow_ups: ['open'],
      p_sort_key: 'membership_fee_amount',
      p_sort_direction: 'desc',
      p_page: 2,
      p_page_size: 25,
    });
    expect(memberDirectorySortKey('name')).toBe('contact_name');
    expect(memberDirectorySortKey('end_date')).toBe('display_expiry');
    expect(memberDirectorySortKey('fee_status')).toBe('membership_fee_status');
  });

  it('applies both operational facets to rows, total, and every quick count', () => {
    expect(migration.match(/AND evaluated\.assignee_matches/g)).toHaveLength(5);
    expect(migration.match(/AND evaluated\.trainer_matches/g)).toHaveLength(5);
    expect(migration).toContain('OR directory.contact_assigned_to = ANY');
    expect(migration).toContain("directory.contact ->> 'trainer_id'");
    expect(migration).toContain('v_include_unassigned');
    expect(migration).toContain('v_include_no_trainer');
  });

  it('keeps one backward-compatible identity during the application rollout', () => {
    expect(compatibilityMigration).toContain(
      'p_assignee_ids UUID[] DEFAULT ARRAY[]::UUID[]'
    );
    expect(compatibilityMigration).toContain(
      'p_include_unassigned BOOLEAN DEFAULT FALSE'
    );
    expect(compatibilityMigration).toContain(
      'p_trainer_ids UUID[] DEFAULT ARRAY[]::UUID[]'
    );
    expect(compatibilityMigration).toContain(
      'p_include_no_trainer BOOLEAN DEFAULT FALSE'
    );
    expect(compatibilityMigration).not.toContain('DROP FUNCTION');
  });

  it('normalizes the established row shape and rejects malformed counts', () => {
    const parsed = parseMemberDirectoryPage({
      rows: [
        {
          membership_id: 'membership-1',
          membership_end_date: '2026-09-30',
          service_expiry: null,
          service_count: '2',
          generic_balance: '900.50',
          open_follow_up_count: '1',
        },
      ],
      totalCount: 1,
      quickFilterCounts: { churnRisk: 1, feesDue: 1, followUps: 1 },
    });

    expect(parsed.rows[0]).toMatchObject({
      display_expiry: '2026-09-30',
      service_count: 2,
      generic_balance: 900.5,
      open_follow_up_count: 1,
    });
    expect(parsed.totalCount).toBe(1);
    expect(() =>
      parseMemberDirectoryPage({
        rows: [],
        totalCount: -1,
        quickFilterCounts: { churnRisk: 0, feesDue: 0, followUps: 0 },
      })
    ).toThrow('Invalid member directory total count');
  });

  it('uses one database request and surfaces RPC errors', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        rows: [],
        totalCount: 0,
        quickFilterCounts: { churnRisk: 0, feesDue: 0, followUps: 0 },
      },
      error: null,
    });
    const supabase = { rpc } as unknown as Parameters<
      typeof loadMemberDirectory
    >[0];

    await expect(
      loadMemberDirectory(supabase, {
        ...query,
        filters: EMPTY_MEMBER_FILTERS,
      })
    ).resolves.toMatchObject({ totalCount: 0, rows: [] });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith(
      'member_customer_directory_page',
      expect.objectContaining({ p_search: '042', p_page_size: 25 })
    );

    rpc.mockResolvedValueOnce({ data: null, error: new Error('denied') });
    await expect(
      loadMemberDirectory(supabase, {
        ...query,
        filters: EMPTY_MEMBER_FILTERS,
      })
    ).rejects.toThrow('denied');
  });

  it('prevents regression to directory fan-out or client-side numeric resolution', () => {
    expect(component).not.toMatch(
      /\.from\(['"]member_customer_directory['"]\)/
    );
    expect(component).not.toContain("count: 'exact'");
    expect(component).not.toContain('resolveCustomerSearch');
    expect(search).not.toContain("from('member_customer_directory')");
    expect(component.match(/loadMemberDirectory\(supabase/g)).toHaveLength(3);
  });
});
