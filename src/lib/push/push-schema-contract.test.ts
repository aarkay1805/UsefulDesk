import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/20260903120000_mobile_push_notifications.sql'
);

function migration() {
  return readFileSync(migrationPath, 'utf8');
}

describe('mobile push schema contract', () => {
  it('creates focused installation and delivery tables with bounded states', () => {
    const sql = migration();

    expect(sql).toMatch(
      /CREATE TABLE IF NOT EXISTS public\.push_installations/
    );
    expect(sql).toMatch(/platform IN \('ios', 'android'\)/);
    expect(sql).toMatch(
      /environment IN \('development', 'preview', 'production'\)/
    );
    expect(sql).toMatch(/length\(expo_push_token\) BETWEEN 1 AND 512/);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.push_deliveries/);
    expect(sql).toMatch(
      /state IN \([\s\S]*?'pending'[\s\S]*?'sending'[\s\S]*?'ticketed'[\s\S]*?'delivered'[\s\S]*?'retry'[\s\S]*?'failed'[\s\S]*?'cancelled'[\s\S]*?\)/
    );
    expect(sql).toMatch(/UNIQUE \(message_id, installation_id\)/);
    expect(sql).toMatch(/attempt_count >= 0 AND attempt_count <= 12/);
  });

  it('keeps active tokens unique per environment and indexes due work', () => {
    const sql = migration();

    expect(sql).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS push_installations_active_token_environment_idx[\s\S]*?\(environment, expo_push_token\)[\s\S]*?WHERE revoked_at IS NULL/
    );
    expect(sql).toMatch(
      /CREATE INDEX IF NOT EXISTS push_deliveries_due_idx[\s\S]*?WHERE state IN \('pending', 'retry', 'sending'\)/
    );
    expect(sql).toMatch(
      /CREATE INDEX IF NOT EXISTS push_deliveries_receipt_idx[\s\S]*?WHERE state = 'ticketed'/
    );
  });

  it('qualifies installation conflicts inside the registration function', () => {
    const sql = migration();

    expect(sql).toMatch(
      /UPDATE public\.push_installations AS installation[\s\S]*?installation\.installation_id <> p_installation_id/
    );
    expect(sql).toContain(
      'ON CONFLICT ON CONSTRAINT push_installations_pkey DO UPDATE'
    );
    expect(sql).not.toContain('ON CONFLICT (installation_id) DO UPDATE');
  });

  it('denies browser table access and exposes only service functions', () => {
    const sql = migration();

    for (const table of ['push_installations', 'push_deliveries']) {
      expect(sql).toMatch(
        new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`)
      );
      expect(sql).toMatch(
        new RegExp(
          `REVOKE ALL ON public\\.${table}\\s+FROM PUBLIC, anon, authenticated`
        )
      );
      expect(sql).toMatch(
        new RegExp(
          `GRANT SELECT, INSERT, UPDATE, DELETE ON public\\.${table} TO service_role`
        )
      );
    }

    for (const name of [
      'register_push_installation',
      'revoke_push_installation',
      'enqueue_inbound_push_deliveries',
      'claim_push_deliveries',
      'claim_push_receipts',
      'settle_push_delivery',
    ]) {
      expect(sql).toMatch(
        new RegExp(
          `CREATE OR REPLACE FUNCTION public\\.${name}[\\s\\S]*?SECURITY DEFINER[\\s\\S]*?SET search_path = ''`
        )
      );
      expect(sql).toMatch(
        new RegExp(
          `REVOKE ALL ON FUNCTION public\\.${name}\\([\\s\\S]*?FROM PUBLIC, anon, authenticated;[\\s\\S]*?GRANT EXECUTE ON FUNCTION public\\.${name}\\([\\s\\S]*?TO service_role;`
        )
      );
    }
  });

  it('uses canonical update triggers and validates opaque payload shape', () => {
    const sql = migration();

    expect(sql).toMatch(
      /CREATE TRIGGER set_push_installations_updated_at[\s\S]*?public\.update_updated_at_column\(\)/
    );
    expect(sql).toMatch(
      /CREATE TRIGGER set_push_deliveries_updated_at[\s\S]*?public\.update_updated_at_column\(\)/
    );
    expect(sql).not.toContain('jsonb_object_length');
    expect(sql).toMatch(
      /payload\s*-\s*'version'\s*-\s*'accountId'\s*-\s*'conversationId'\s*-\s*'messageId'\s*-\s*'deliveryId'\s*\)\s*=\s*'\{\}'::jsonb/
    );
    expect(sql).toMatch(/payload->>'version' = '1'/);
    expect(sql).toMatch(/payload \?& ARRAY\[/);
    expect(sql).toMatch(
      /CREATE TRIGGER enforce_push_delivery_tenancy[\s\S]*?private\.enforce_push_delivery_tenancy\(\)/
    );
  });
});
