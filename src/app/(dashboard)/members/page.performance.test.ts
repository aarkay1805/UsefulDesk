import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('members initial bundle', () => {
  it('defers inactive views and unopened dialogs', () => {
    const source = readFileSync(resolve(__dirname, 'page.tsx'), 'utf8');

    expect(source).toContain("import dynamic from 'next/dynamic'");
    expect(source).toMatch(/dynamic\(\s*\(\)\s*=>\s*import\(/);
    expect(source).toContain('{formOpen ? (');
    expect(source).toContain('{importOpen ? (');
    expect(source).toContain('{detailOpen ? (');
  });

  it('derives the active listing from router search params before children mount', () => {
    const source = readFileSync(resolve(__dirname, 'page.tsx'), 'utf8');

    expect(source).toContain(
      "import { useSearchParams } from 'next/navigation'"
    );
    expect(source).toContain("const requestedView = searchParams.get('view')");
    expect(source).not.toContain("useState<View>('renewals')");
    expect(source).not.toContain('setView(requested)');
  });

  it('keeps Realtime invalidation dependency-scoped and tenant-filtered', () => {
    const source = readFileSync(resolve(__dirname, 'page.tsx'), 'utf8');

    expect(source).toContain('MEMBER_REALTIME_TABLES,');
    expect(source).toContain('memberViewsAffectedByRealtime,');
    expect(source).toContain(
      'const pendingViews = pendingRealtimeViewsRef.current'
    );
    expect(source).toContain('pendingRealtimeViewsRef.current.delete(view)');
    expect(source).toContain('pendingViews.add(affectedView)');
    expect(source).toContain('changedAccountId !== accountId');
    expect(source).toContain("typeof oldRow.account_id === 'string'");
    expect(source).not.toContain('filter: `account_id=eq.${accountId}`');
    expect(source).toContain('reloadKey={reloadKeys.attendance}');
    expect(source).toContain('reloadKey={detailReloadKey}');
    expect(source).toContain('followUpReloadKey={detailFollowUpReloadKey}');
    expect(source).not.toContain('const [reloadKey, setReloadKey]');
  });

  it('does not couple All-members transfer reads to listing reloads', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/components/members/members-table.tsx'),
      'utf8'
    );

    expect(source).toContain('}, [fetchAssignmentRequests]);');
    expect(source).not.toContain('}, [fetchAssignmentRequests, reloadKey]);');
    expect(source).toContain('reloadKey,\n    assignmentNonce,');
  });

  it('routes follow-up events to the member sheet timeline boundary', () => {
    const detailSource = readFileSync(
      resolve(process.cwd(), 'src/components/members/member-detail-view.tsx'),
      'utf8'
    );
    const notesSource = readFileSync(
      resolve(
        process.cwd(),
        'src/components/contacts/contact-notes-thread.tsx'
      ),
      'utf8'
    );

    expect(detailSource).toContain('reloadKey={followUpReloadKey}');
    expect(notesSource).toContain(
      '}, [active, contactId, fetchNotes, reloadKey]);'
    );
  });

  it('uses only dependency tables already declared in Realtime publications', () => {
    const readMigration = (path: string) =>
      readFileSync(resolve(process.cwd(), path), 'utf8');
    const directPublicationSources = [
      [
        'supabase/migrations/054_realtime_member_tables.sql',
        ['memberships', 'payments', 'attendance'],
      ],
      [
        'supabase/migrations/057_membership_periods.sql',
        ['membership_periods'],
      ],
      [
        'supabase/migrations/20260801160314_products_services_trainer_pricing.sql',
        ['member_services'],
      ],
      [
        'supabase/migrations/20260829032000_publish_finance_allocation_changes.sql',
        ['payment_allocations', 'payment_refund_allocations'],
      ],
      [
        'supabase/migrations/20260829050000_consolidate_member_follow_ups.sql',
        ['follow_ups'],
      ],
    ] as const;

    for (const [path, tables] of directPublicationSources) {
      const migration = readMigration(path);
      for (const table of tables) {
        expect(migration, `${table} publication declaration`).toMatch(
          new RegExp(
            `ALTER PUBLICATION\\s+supabase_realtime\\s+ADD TABLE\\s+(?:public\\.)?${table}`
          )
        );
      }
    }

    const financePublication = readMigration(
      'supabase/migrations/20260829030000_consolidate_finance_overview.sql'
    );
    expect(financePublication).toContain(
      "'ALTER PUBLICATION supabase_realtime ADD TABLE public.%I'"
    );
    for (const table of [
      'contacts',
      'membership_plans',
      'payment_refunds',
      'invoices',
      'invoice_lines',
      'invoice_credit_allocations',
      'invoice_adjustment_allocations',
    ]) {
      expect(financePublication, `${table} publication loop entry`).toMatch(
        new RegExp(`['\"]${table}['\"]`)
      );
    }
  });
});
