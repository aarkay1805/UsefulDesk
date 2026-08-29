import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { memberViewsAffectedByRealtime } from './member-realtime';

const migration = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/20260829050000_consolidate_member_follow_ups.sql'
  ),
  'utf8'
);
const repairMigration = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/20260829051000_repair_member_follow_ups_extrema.sql'
  ),
  'utf8'
);
const table = readFileSync(
  resolve(process.cwd(), 'src/components/members/follow-up-lists.tsx'),
  'utf8'
);
const page = readFileSync(
  resolve(process.cwd(), 'src/app/(dashboard)/members/page.tsx'),
  'utf8'
);
const originalSchema = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/036_follow_ups.sql'),
  'utf8'
);

describe('member_follow_ups_page SQL contract', () => {
  it('runs on caller privileges with an empty path and authenticated-only execution', () => {
    expect(migration).toContain('SECURITY INVOKER');
    expect(migration).toContain("SET search_path = ''");
    expect(migration).not.toContain('SECURITY DEFINER');
    expect(migration).not.toContain('p_account_id');
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.member_follow_ups_page\([\s\S]*?FROM PUBLIC, anon, service_role;/
    );
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.member_follow_ups_page\([\s\S]*?TO authenticated;/
    );
  });

  it('materializes one RLS-visible scope and returns only the bounded rendered contract', () => {
    expect(migration.match(/base_scope AS MATERIALIZED/g)).toHaveLength(1);
    expect(migration.match(/filtered AS MATERIALIZED/g)).toHaveLength(1);
    for (const field of [
      "'rows'",
      "'page'",
      "'totalCount'",
      "'bucketCounts'",
      "'all'",
      "'overdue'",
      "'today'",
      "'upcoming'",
      "'created_by'",
      "'assigned_to'",
    ]) {
      expect(migration).toContain(field);
    }
    expect(migration).toContain('LIMIT p_page_size');
    expect(migration).toContain('OFFSET (SELECT page * p_page_size');
    expect(migration).not.toContain('to_jsonb(');
    expect(migration).not.toContain("'*'");
  });

  it('preserves member search, owner/assignee/reason/due filters, and every sort', () => {
    expect(migration).toContain("v_search ~ '^[0-9]+$'");
    expect(migration).toContain('membership.member_number::TEXT');
    expect(migration).toContain('contact.name ILIKE');
    expect(migration).toContain('contact.phone ILIKE');
    expect(migration).toContain("v_scope = 'team'");
    expect(migration).toContain('follow_up.assigned_to = (SELECT auth.uid())');
    expect(migration).toContain('follow_up.reason = ANY(v_reasons)');
    expect(migration).toContain('follow_up.assigned_to = ANY(v_assignee_ids)');
    expect(migration).toContain('follow_up.assigned_to IS NULL');
    for (const bucket of ['overdue', 'today', 'upcoming']) {
      expect(migration).toContain(`WHEN '${bucket}'`);
    }
    for (const sort of ['customer', 'due_date', 'reason', 'created_at']) {
      expect(migration).toContain(`v_sort_key = '${sort}'`);
    }
  });

  it('rejects unsafe bounds and keeps ordinary list work behind one loader', () => {
    expect(migration).toContain("USING ERRCODE = '22004'");
    expect(migration.match(/USING ERRCODE = '22023'/g)?.length).toBeGreaterThan(
      7
    );
    expect(migration).toContain('p_page_size > 100');
    expect(migration).toContain('pg_catalog.cardinality(v_buckets) > 1');
    expect(table).toContain('loadMemberFollowUps');
    expect(table).not.toContain('countFor(');
    expect(table).not.toContain('select(FOLLOW_UP_SELECT');
    expect(table).not.toContain('select(FOLLOW_UP_ID_SELECT, {');
  });

  it('keeps concrete due dates and publishes follow-up changes for the existing coalesced realtime refresh', () => {
    expect(originalSchema).toMatch(/due_date\s+DATE NOT NULL/);
    expect(migration).toContain(
      'ALTER PUBLICATION supabase_realtime ADD TABLE public.follow_ups'
    );
    expect(memberViewsAffectedByRealtime('follow_ups')).toEqual([
      'followups',
      'all',
    ]);
    expect(page).toContain('for (const table of MEMBER_REALTIME_TABLES)');
    expect(page).toContain('window.setTimeout');
    expect(page).toContain('supabase.removeChannel(channel)');
  });

  it('repairs unqualified SQL extrema forward without editing applied history', () => {
    expect(repairMigration).toContain('pg_catalog.pg_get_functiondef');
    expect(repairMigration).toContain("'pg_catalog.least'");
    expect(repairMigration).toContain("'pg_catalog.greatest'");
    expect(repairMigration).toContain("'least'");
    expect(repairMigration).toContain("'greatest'");
    expect(repairMigration).toContain('REVOKE ALL ON FUNCTION');
    expect(repairMigration).toContain('TO authenticated;');
  });
});
