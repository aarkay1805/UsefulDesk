import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/20260822100000_meta_lead_ads_self_healing.sql'
);
const sql = existsSync(migrationPath)
  ? readFileSync(migrationPath, 'utf8')
  : '';
const indexMigrationPath = resolve(
  process.cwd(),
  'supabase/migrations/20260822100001_index_meta_page_config_user_id.sql'
);
const indexSql = existsSync(indexMigrationPath)
  ? readFileSync(indexMigrationPath, 'utf8')
  : '';

describe('Meta Lead Ads self-healing migration contract', () => {
  it('adds the complete Page health state and preserves integrations after audit-user deletion', () => {
    for (const fragment of [
      'ADD COLUMN IF NOT EXISTS connected_meta_user_id TEXT',
      'ADD COLUMN IF NOT EXISTS credential_generation INTEGER NOT NULL DEFAULT 1',
      'ADD COLUMN IF NOT EXISTS health_checked_at TIMESTAMPTZ',
      'ADD COLUMN IF NOT EXISTS last_healthy_at TIMESTAMPTZ',
      'ADD COLUMN IF NOT EXISTS lead_access_verified_at TIMESTAMPTZ',
      'ADD COLUMN IF NOT EXISTS subscription_verified_at TIMESTAMPTZ',
      'ADD COLUMN IF NOT EXISTS last_repair_at TIMESTAMPTZ',
      'ADD COLUMN IF NOT EXISTS next_health_check_at TIMESTAMPTZ NOT NULL DEFAULT NOW()',
      'ADD COLUMN IF NOT EXISTS consecutive_health_failures INTEGER NOT NULL DEFAULT 0',
      'ADD COLUMN IF NOT EXISTS health_error_code TEXT',
      'ADD COLUMN IF NOT EXISTS health_error_resolution TEXT',
      'ADD COLUMN IF NOT EXISTS health_lease_owner UUID',
      'ADD COLUMN IF NOT EXISTS health_lease_until TIMESTAMPTZ',
      'ADD COLUMN IF NOT EXISTS attention_started_at TIMESTAMPTZ',
      'ADD COLUMN IF NOT EXISTS attention_notified_at TIMESTAMPTZ',
    ]) {
      expect(sql).toContain(fragment);
    }
    expect(sql).toMatch(
      /ALTER COLUMN user_id DROP NOT NULL[\s\S]*FOREIGN KEY \(user_id\)[\s\S]*ON DELETE SET NULL/
    );
    expect(sql).toMatch(
      /CREATE INDEX IF NOT EXISTS idx_meta_page_config_health_due[\s\S]*WHERE status IN \('connected', 'error'\)/
    );
  });

  it('covers the nullable audit-user foreign key for deletion performance', () => {
    expect(indexSql).toContain(
      'CREATE INDEX IF NOT EXISTS idx_meta_page_config_user_id'
    );
    expect(indexSql).toContain('ON public.meta_page_config (user_id)');
  });

  it('claims bounded Page checks with skip-locked owner leases and safe worker fields', () => {
    expect(sql).toMatch(
      /claim_meta_page_health_batch\([\s\S]*p_limit INTEGER[\s\S]*p_lease_seconds INTEGER[\s\S]*p_force_config_id UUID DEFAULT NULL/
    );
    expect(sql).toContain('LEAST(GREATEST(p_limit, 1), 10)');
    expect(sql).toContain('LEAST(GREATEST(p_lease_seconds, 30), 300)');
    expect(sql).toMatch(/FOR UPDATE[\s\S]*SKIP LOCKED/);
    expect(sql).toContain('health_lease_owner = p_health_owner');
    expect(sql).toContain('health_lease_until = v_now + make_interval');
    expect(sql).not.toMatch(
      /RETURNS TABLE\([\s\S]*page_access_token TEXT[\s\S]*account_id[\s\S]*page_id TEXT/
    );
  });

  it('requires exact Page lease owner, account, unexpired lease, and credential generation', () => {
    for (const functionName of [
      'complete_meta_page_health_check',
      'fail_meta_page_health_check',
    ]) {
      const start = sql.indexOf(`FUNCTION public.${functionName}`);
      const end = sql.indexOf('$function$;', start);
      const body = sql.slice(start, end);
      expect(start).toBeGreaterThan(0);
      expect(body).toContain('account_id = p_account_id');
      expect(body).toContain('health_lease_owner = p_health_owner');
      expect(body).toContain('health_lease_until >= v_now');
      expect(body).toContain('credential_generation = p_credential_generation');
    }
  });

  it('opens one owner/admin attention incident after three transients or immediately for human action', () => {
    expect(sql).toContain("'meta_leads_attention'");
    expect(sql).toMatch(
      /attention_started_at = CASE[\s\S]*WHEN v_human_action OR v_failure_count >= 3[\s\S]*THEN COALESCE\(attention_started_at, v_now\)/
    );
    expect(sql).toMatch(
      /attention_notified_at IS NULL[\s\S]*INSERT INTO public\.notifications/
    );
    expect(sql).toMatch(
      /profile\.account_id = p_account_id[\s\S]*profile\.account_role IN \('owner', 'admin'\)/
    );
    expect(sql).toMatch(
      /complete_meta_page_health_check[\s\S]*attention_started_at = NULL[\s\S]*attention_notified_at = NULL/
    );
    expect(sql).not.toMatch(/DELETE FROM public\.notifications/);
  });

  it('owns webhook claims and schedules exact retry backoff', () => {
    expect(sql).toMatch(
      /claim_meta_lead_webhook_event_owned[\s\S]*processing_owner = p_processing_owner/
    );
    expect(sql).toMatch(
      /claim_meta_lead_webhook_recovery_batch[\s\S]*LEAST\(GREATEST\(p_limit, 1\), 25\)[\s\S]*FOR UPDATE[\s\S]*SKIP LOCKED/
    );
    expect(sql).toMatch(
      /complete_meta_lead_webhook_event_owned[\s\S]*processing_owner = p_processing_owner/
    );
    expect(sql).toMatch(
      /fail_meta_lead_webhook_event_owned[\s\S]*WHEN attempt_count <= 1 THEN INTERVAL '1 minute'[\s\S]*WHEN attempt_count = 2 THEN INTERVAL '5 minutes'[\s\S]*WHEN attempt_count = 3 THEN INTERVAL '15 minutes'[\s\S]*WHEN attempt_count = 4 THEN INTERVAL '1 hour'[\s\S]*ELSE INTERVAL '6 hours'/
    );
  });

  it('atomically increments and terminally completes a phone-less owned event', () => {
    expect(sql).toMatch(
      /complete_meta_lead_without_phone_owned[\s\S]*UPDATE public\.meta_page_config[\s\S]*skipped_no_phone = skipped_no_phone \+ 1/
    );
    expect(sql).toMatch(
      /complete_meta_lead_without_phone_owned[\s\S]*processing_owner = p_processing_owner[\s\S]*processed_at IS NULL[\s\S]*UPDATE public\.webhook_events[\s\S]*processing_status = 'processed'/
    );
  });

  it('keeps Page RLS admin-only and makes every worker function service-role-only', () => {
    expect(sql).toMatch(
      /CREATE POLICY meta_page_config_select[\s\S]*is_account_member\(account_id, 'admin'\)/
    );
    expect(sql).toContain(
      "CHECK (type IN ('conversation_assigned','lead_assigned','follow_up_reminder'"
    );

    for (const functionName of [
      'claim_meta_page_health_batch',
      'complete_meta_page_health_check',
      'fail_meta_page_health_check',
      'claim_meta_lead_webhook_event_owned',
      'claim_meta_lead_webhook_recovery_batch',
      'complete_meta_lead_webhook_event_owned',
      'fail_meta_lead_webhook_event_owned',
      'complete_meta_lead_without_phone_owned',
    ]) {
      expect(sql).toMatch(
        new RegExp(
          `REVOKE ALL ON FUNCTION public\\.${functionName}[\\s\\S]*FROM PUBLIC, anon, authenticated;`
        )
      );
      expect(sql).toMatch(
        new RegExp(
          `GRANT EXECUTE ON FUNCTION public\\.${functionName}[\\s\\S]*TO service_role;`
        )
      );
    }
  });
});
