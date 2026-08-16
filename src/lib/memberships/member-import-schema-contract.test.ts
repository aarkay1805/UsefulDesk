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
const hardeningSql = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/20260816130000_harden_member_import_grants.sql'
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
    expect(hardeningSql).toContain(
      'REVOKE ALL ON public.member_import_drafts FROM PUBLIC, anon'
    );
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

  it('commits one customer group atomically behind an agent-scoped idempotent RPC', () => {
    expect(sql).toContain(
      'CREATE TABLE IF NOT EXISTS public.member_import_runs'
    );
    expect(sql).toContain(
      'CREATE OR REPLACE FUNCTION public.perform_member_import_group(p_payload JSONB)'
    );
    expect(sql).toMatch(
      /perform_member_import_group\(p_payload JSONB\)[\s\S]*SECURITY DEFINER[\s\S]*public\.is_account_member\(v_account_id, 'agent'\)/
    );
    expect(sql).toContain('UNIQUE (account_id, idempotency_key)');
    expect(sql).toContain('Conflicting member import idempotency key');
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.perform_member_import_group\(JSONB\)[\s\S]*FROM PUBLIC, anon/
    );
    expect(hardeningSql).toContain('idx_member_import_runs_contact_fk');
    expect(hardeningSql).toContain('idx_member_import_runs_membership_fk');
    expect(hardeningSql).toContain('idx_member_import_runs_created_by_fk');
  });

  it('revalidates active account-owned offerings and audits imported sold terms', () => {
    expect(sql).toMatch(
      /plan\.account_id = v_account_id[\s\S]*plan\.is_active/
    );
    expect(sql).toMatch(
      /item\.account_id = v_account_id[\s\S]*item\.kind = 'service'[\s\S]*item\.is_active/
    );
    expect(sql).toContain("'Imported historical sold price'");
    expect(sql).toContain('service_end <= service_start');
    expect(sql).toContain('rate.is_active');
  });

  it('creates row payments against invoices without consuming member credit', () => {
    const transaction = sql.slice(
      sql.indexOf(
        'CREATE OR REPLACE FUNCTION public.perform_member_import_group'
      )
    );
    expect(transaction).toContain('INSERT INTO public.payments');
    expect(transaction).toContain('invoice_id');
    expect(transaction).not.toContain('apply_oldest_member_credit');
    expect(transaction).toContain('Imported historical purchase');
  });
});
