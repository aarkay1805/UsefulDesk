import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/20260829060000_consolidate_member_attendance.sql'
  ),
  'utf8'
);
const repairMigration = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/20260829061000_avoid_member_attendance_timezone_catalog_scan.sql'
  ),
  'utf8'
);
const rowJsonRepairMigration = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/20260829062000_defer_member_attendance_row_json.sql'
  ),
  'utf8'
);
const component = readFileSync(
  resolve(process.cwd(), 'src/components/members/attendance-view.tsx'),
  'utf8'
);
const page = readFileSync(
  resolve(process.cwd(), 'src/app/(dashboard)/members/page.tsx'),
  'utf8'
);
const attendanceSchema = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/032_attendance.sql'),
  'utf8'
);
const realtimeMigration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/054_realtime_member_tables.sql'),
  'utf8'
);

describe('member_attendance_page SQL contract', () => {
  it('runs on caller privileges with an empty path and authenticated-only execution', () => {
    expect(migration).toContain('SECURITY INVOKER');
    expect(migration).toContain("SET search_path = ''");
    expect(migration).not.toContain('SECURITY DEFINER');
    expect(migration).not.toContain('p_account_id');
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.member_attendance_page\([\s\S]*?FROM PUBLIC, anon, service_role;/
    );
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.member_attendance_page\([\s\S]*?TO authenticated;/
    );
  });

  it('materializes one RLS-visible roster and returns one bounded complete contract', () => {
    expect(migration.match(/base_scope AS MATERIALIZED/g)).toHaveLength(1);
    expect(migration.match(/filtered AS MATERIALIZED/g)).toHaveLength(1);
    for (const field of [
      "'rows'",
      "'page'",
      "'totalCount'",
      "'presentCount'",
      "'absentCount'",
      "'planOptions'",
      "'membership'",
      "'attendance'",
      "'used'",
    ]) {
      expect(migration).toContain(field);
    }
    expect(migration).toContain('LIMIT p_page_size');
    expect(migration).toContain(
      'OFFSET (SELECT page * p_page_size FROM page_info)'
    );
    expect(migration).not.toContain('to_jsonb(');
    expect(migration).not.toContain("'*'");
  });

  it('preserves latest daily state, timezone windows, usage semantics, filters, and sorts', () => {
    expect(migration).toContain('DISTINCT ON (visit.contact_id)');
    expect(migration).toContain('visit.checked_in_at >= p_day_start');
    expect(migration).toContain('visit.checked_in_at < p_day_end');
    expect(migration).toContain('row.usage_start_date IS NOT NULL');
    expect(migration).toContain('AT TIME ZONE p_time_zone');
    expect(migration).toContain("row.plan_type = 'session_pack'");
    for (const interval of ['period', 'month', 'week']) {
      expect(migration).toContain(
        `row.attendance_limit_interval = '${interval}'`
      );
    }
    expect(migration).toContain("p_bucket = 'present'");
    expect(migration).toContain('scope.plan_id = ANY(v_plan_ids)');
    expect(migration).toContain("scope.membership_json->>'member_number'");
    expect(migration).toContain("LIKE v_search_pattern ESCAPE '\\'");
    for (const sort of ['name', 'checked_in_at', 'checked_out_at']) {
      expect(migration).toContain(`v_sort_key = '${sort}'`);
    }
    expect(migration).toContain('NULLS LAST');
  });

  it('rejects unsafe bounds and leaves list work behind one abortable loader', () => {
    expect(migration).toContain("USING ERRCODE = '22004'");
    expect(migration.match(/USING ERRCODE = '22023'/g)?.length).toBeGreaterThan(
      8
    );
    expect(migration).toContain('p_page_size > 100');
    expect(migration).toContain('pg_catalog.pg_timezone_names');
    expect(repairMigration).toContain('pg_catalog.pg_get_functiondef');
    expect(repairMigration).toContain(
      'PERFORM p_today::TIMESTAMP AT TIME ZONE p_time_zone'
    );
    expect(repairMigration).toContain("USING ERRCODE = '22023'");
    expect(
      repairMigration.match(/FROM pg_catalog\.pg_timezone_names/g)
    ).toHaveLength(1);
    expect(repairMigration).toContain(
      'pg_catalog.replace(\n      v_definition,\n      v_slow_validation,\n      v_direct_validation'
    );
    expect(rowJsonRepairMigration).toContain('membership AS membership_record');
    expect(rowJsonRepairMigration).toContain('contact AS contact_record');
    expect(rowJsonRepairMigration).toContain('plan AS plan_record');
    expect(rowJsonRepairMigration).toContain('pg_catalog.pg_get_functiondef');
    expect(rowJsonRepairMigration).toContain("'contact', jsonb_build_object(");
    expect(component).toContain('loadAttendanceSnapshot');
    expect(component).toContain('new AbortController()');
    expect(component).not.toContain("from('memberships')");
    expect(component).not.toContain('fetchUsageCounts');
    expect(component).not.toContain('memberMatchesSearch');
  });

  it('keeps current RLS actions and the existing coalesced realtime refresh', () => {
    expect(attendanceSchema).toContain(
      'CREATE POLICY attendance_select ON attendance FOR SELECT USING (is_account_member(account_id))'
    );
    expect(attendanceSchema).toContain(
      "CREATE POLICY attendance_insert ON attendance FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'))"
    );
    expect(component).toContain(".from('attendance')");
    expect(component).toContain(".is('checked_out_at', null)");
    expect(component).toContain('fetchCheckInUsage');
    expect(realtimeMigration).toContain(
      'ALTER PUBLICATION supabase_realtime ADD TABLE attendance'
    );
    expect(page).toContain("table: 'attendance'");
    expect(page).toContain('window.setTimeout');
    expect(page).toContain('supabase.removeChannel(channel)');
  });
});
