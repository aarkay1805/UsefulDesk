import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/20260816122505_service_aware_resumable_member_import.sql'
  ),
  'utf8'
);

describe('service-aware resumable member import schema contract', () => {
  it('keeps the customer directory invoker-scoped and anonymous-free', () => {
    expect(sql).toMatch(
      /VIEW public\.member_customer_directory\s+WITH \(security_invoker = true\)/
    );
    expect(sql).toMatch(
      /REVOKE ALL ON public\.member_customer_directory FROM anon/
    );
  });

  it('makes draft rows author-private with indexed ownership and expiry paths', () => {
    expect(sql).toContain(
      'ALTER TABLE public.member_import_drafts ENABLE ROW LEVEL SECURITY'
    );
    expect(
      sql.match(/author_id = \(SELECT auth\.uid\(\)\)/g)?.length
    ).toBeGreaterThanOrEqual(4);
    expect(sql).toContain('idx_member_import_drafts_one_active_author');
    expect(sql).toContain('idx_member_import_drafts_author');
    expect(sql).toContain('idx_member_import_drafts_expiry');
  });

  it('keeps the workbook bucket private and author-path scoped', () => {
    expect(sql).toMatch(
      /'member-import-drafts',\s*'member-import-drafts',\s*FALSE,\s*10485760/
    );
    expect(sql).toContain(
      '(storage.foldername(name))[2] = (SELECT auth.uid())::TEXT'
    );
    expect(sql).not.toMatch(/DELETE\s+FROM\s+storage\.objects/i);
  });

  it('revokes public CAS and cleanup execution and claims cleanup rows safely', () => {
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.save_member_import_draft[\s\S]*FROM PUBLIC, anon/
    );
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.claim_expired_member_import_drafts[\s\S]*FROM PUBLIC, anon, authenticated/
    );
    expect(sql).toContain('FOR UPDATE SKIP LOCKED');
  });
});
