import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  join(
    process.cwd(),
    'supabase/migrations/20260828230000_cache_selected_account_rls_checks.sql'
  ),
  'utf8'
);
const originalAuthorization = readFileSync(
  join(
    process.cwd(),
    'supabase/migrations/20260728170116_enforce_archived_branch_read_only.sql'
  ),
  'utf8'
);

const optimizedPolicies = [
  ['accounts', 'accounts_select', 'id', null],
  ['contacts', 'contacts_select', 'account_id', null],
  ['memberships', 'memberships_select', 'account_id', null],
  ['membership_plans', 'membership_plans_select', 'account_id', null],
  ['member_services', 'member_services_select', 'account_id', 'authenticated'],
  ['invoices', 'invoices_select', 'account_id', 'authenticated'],
  ['invoice_lines', 'invoice_lines_select', 'account_id', 'authenticated'],
  ['payments', 'payments_select', 'account_id', null],
  [
    'payment_allocations',
    'payment_allocations_select',
    'account_id',
    'authenticated',
  ],
  [
    'invoice_credit_allocations',
    'invoice_credit_allocations_select',
    'account_id',
    'authenticated',
  ],
  ['payment_refunds', 'payment_refunds_select', 'account_id', 'authenticated'],
  [
    'payment_refund_allocations',
    'payment_refund_allocations_select',
    'account_id',
    'authenticated',
  ],
  [
    'invoice_adjustments',
    'invoice_adjustments_select',
    'account_id',
    'authenticated',
  ],
  [
    'invoice_adjustment_allocations',
    'invoice_adjustment_allocations_select',
    'account_id',
    'authenticated',
  ],
  ['follow_ups', 'follow_ups_select', 'account_id', null],
] as const;

describe('selected-account RLS initPlan contract', () => {
  it('resolves selected-account access without accepting current-row input', () => {
    expect(migration).toMatch(
      /CREATE OR REPLACE FUNCTION private\.authorized_selected_account_id\(\s*min_role public\.account_role_enum DEFAULT 'viewer'/
    );
    expect(migration).toContain(
      'v_account_id UUID := private.requested_account_id();'
    );
    expect(migration).toContain('v_user_id UUID := auth.uid();');
    expect(migration).toContain('FROM public.account_memberships AS membership');
    expect(migration).toContain("account.branch_status <> 'archived'");
    expect(migration).toMatch(
      /CASE membership\.role[\s\S]*WHEN 'owner' THEN 4[\s\S]*WHEN 'admin' THEN 3[\s\S]*WHEN 'agent' THEN 2[\s\S]*WHEN 'viewer' THEN 1[\s\S]*CASE min_role[\s\S]*WHEN 'owner' THEN 4[\s\S]*WHEN 'admin' THEN 3[\s\S]*WHEN 'agent' THEN 2[\s\S]*WHEN 'viewer' THEN 1/
    );
  });

  it('pins helper execution context and closes default function access', () => {
    expect(migration).toMatch(
      /LANGUAGE plpgsql\s+STABLE\s+SECURITY DEFINER\s+SET search_path = pg_catalog, public, private/
    );
    expect(migration).toContain(
      'ALTER FUNCTION private.authorized_selected_account_id('
    );
    expect(migration).toContain(') OWNER TO postgres;');
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION private\.authorized_selected_account_id\([\s\S]*?FROM PUBLIC, anon;/
    );
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION private\.authorized_selected_account_id\([\s\S]*?TO authenticated, service_role;/
    );
  });

  it.each(optimizedPolicies)(
    'replaces only %s.%s with an explicit row-to-selected-account comparison',
    (table, policy, tenantColumn, role) => {
      const roleClause = role === null ? '' : ` TO ${role}`;
      const expected = new RegExp(
        `CREATE POLICY ${policy}\\s+ON public\\.${table}\\s+FOR SELECT${roleClause}\\s+USING \\(${tenantColumn} = \\(SELECT private\\.authorized_selected_account_id\\(\\)\\)\\);`
      );
      expect(migration).toMatch(expected);
      expect(migration).toContain(
        `DROP POLICY IF EXISTS ${policy}`
      );
    }
  );

  it('does not change write policies, grants, listing API security, or the existing helper', () => {
    const rowDependentPolicy =
      /USING \(public\.is_account_member\([^)]*account_id/;
    expect('USING (public.is_account_member(account_id))').toMatch(
      rowDependentPolicy
    );
    expect(originalAuthorization).toMatch(/public\.is_account_member\(/);
    expect(migration).not.toMatch(rowDependentPolicy);
    expect(migration).not.toMatch(/FOR (?:INSERT|UPDATE|DELETE|ALL)\b/);
    expect(migration).not.toMatch(/GRANT (?:SELECT|INSERT|UPDATE|DELETE|ALL)\b/);
    expect(migration).not.toContain(
      'CREATE OR REPLACE FUNCTION public.is_account_member('
    );
    expect(migration).not.toContain('member_customer_directory_page');
    expect(migration.match(/CREATE POLICY /g)).toHaveLength(
      optimizedPolicies.length
    );
  });
});
