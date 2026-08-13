import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { BRANCH_SETUP_WARNING_CODES } from '@/lib/branches/setup';

const migrationNames = readdirSync(
  join(process.cwd(), 'supabase/migrations')
).filter((name) => name.endsWith('_organization_branch_setup_copy.sql'));

expect(migrationNames).toHaveLength(1);
expect(migrationNames[0]).toMatch(
  /^\d{14}_organization_branch_setup_copy\.sql$/
);

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations', migrationNames[0]),
  'utf8'
);

const activeSourceMigration = readFileSync(
  join(
    process.cwd(),
    'supabase/migrations/20260813154312_allow_active_branch_setup_copy.sql'
  ),
  'utf8'
);

const createFunction = migration.slice(
  migration.indexOf(
    'CREATE OR REPLACE FUNCTION public.create_organization_branch_from_setup'
  ),
  migration.indexOf(
    'ALTER FUNCTION public.create_organization_branch_from_setup'
  )
);

describe('organization branch setup copy database contract', () => {
  it('allows active sources without readiness or review acknowledgements', () => {
    expect(activeSourceMigration).toContain(
      "IF v_copy_source.branch_status <> 'active' THEN"
    );
    expect(activeSourceMigration).toContain(
      "pg_catalog.strpos(v_definition, 'SOURCE_NOT_READY')"
    );
    expect(activeSourceMigration).toContain(
      "pg_catalog.strpos(v_definition, 'SOURCE_NOT_REVIEWED')"
    );
    expect(activeSourceMigration).toContain(
      "RAISE EXCEPTION 'Copy source must be active'"
    );
  });

  it('protects review and lifecycle columns from direct authenticated updates', () => {
    expect(migration).toContain(
      'ADD COLUMN IF NOT EXISTS setup_reviewed_at TIMESTAMPTZ'
    );
    expect(migration).toContain(
      'ADD COLUMN IF NOT EXISTS setup_reviewed_by UUID'
    );
    expect(migration).toContain(
      'REVOKE UPDATE ON TABLE public.accounts FROM authenticated'
    );
    expect(migration).toMatch(
      /GRANT UPDATE \([\s\S]*?onboarding_dismissed_at[\s\S]*?\) ON TABLE public\.accounts TO authenticated;/
    );
    const accountGrant = migration.match(
      /GRANT UPDATE \(([\s\S]*?)\) ON TABLE public\.accounts TO authenticated;/
    )?.[1];
    expect(accountGrant).not.toContain('readiness_state');
    expect(accountGrant).not.toContain('setup_reviewed_at');
    expect(accountGrant).not.toContain('branch_status');
    expect(accountGrant).not.toContain('organization_id');
  });

  it('keeps idempotency state private and deletion-safe', () => {
    expect(migration).toContain(
      'CREATE TABLE IF NOT EXISTS private.branch_creation_requests'
    );
    expect(migration).toContain('PRIMARY KEY (actor_user_id, request_id)');
    expect(migration).toContain(
      'ALTER TABLE private.branch_creation_requests ENABLE ROW LEVEL SECURITY'
    );
    expect(migration).toMatch(
      /REVOKE ALL ON TABLE private\.branch_creation_requests\s+FROM PUBLIC, anon, authenticated, service_role;/
    );
    expect(migration).toContain(
      'CONSTRAINT branch_creation_requests_organization_source_fkey'
    );
    expect(migration).toContain('ON DELETE SET NULL (source_account_id)');
    expect(migration).toContain(
      'CONSTRAINT branch_creation_requests_organization_created_fkey'
    );
    expect(migration).toMatch(
      /created_account_id UUID,[\s\S]*?REFERENCES public\.accounts\(organization_id, id\)\s+ON DELETE CASCADE/
    );
    expect(migration).toContain('idx_accounts_setup_reviewed_by');
    expect(migration).toContain('idx_branch_creation_requests_created_scope');
    expect(migration).toContain('idx_branch_creation_requests_source_scope');
    expect(migration).toContain(
      'idx_branch_creation_requests_legal_entity_scope'
    );
  });

  it('uses a coherent bounded source snapshot and positive copy allowlists', () => {
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION private.branch_setup_source_snapshot'
    );
    expect(migration).toContain('SELECT pg_catalog.jsonb_build_object(');
    expect(createFunction).toContain(
      'v_snapshot := private.branch_setup_source_snapshot'
    );
    expect(createFunction).toContain(
      "RAISE EXCEPTION 'Branch setup snapshot exceeds 8 MiB'"
    );
    expect(createFunction).toContain(
      "RAISE EXCEPTION 'Branch setup copy exceeds 10000 rows'"
    );

    for (const table of [
      'membership_plans',
      'plan_pricing_options',
      'catalog_items',
      'catalog_options',
      'lead_field_options',
      'tags',
      'custom_fields',
      'lead_capture_forms',
      'renewal_reminder_settings',
      'automations',
      'automation_steps',
      'flows',
      'flow_nodes',
    ]) {
      expect(createFunction).toContain(`INSERT INTO public.${table}`);
    }

    for (const forbidden of [
      'contacts',
      'memberships',
      'payments',
      'invoices',
      'trainers',
      'trainer_rates',
      'automation_logs',
      'automation_pending_executions',
      'flow_runs',
      'flow_run_events',
      'account_payment_credentials',
      'whatsapp_config',
    ]) {
      expect(createFunction).not.toContain(`INSERT INTO public.${forbidden}`);
    }
    expect(createFunction).not.toContain('storage.objects');
  });

  it('canonicalizes copied definitions and stores only stable warning metadata', () => {
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION private.canonical_branch_automation_trigger'
    );
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION private.canonical_branch_automation_step'
    );
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION private.canonical_branch_flow_node'
    );
    expect(migration).toContain(
      "RETURN pg_catalog.jsonb_build_object('url', '', 'headers', '{}'::JSONB, 'body_template', '')"
    );
    expect(migration).toContain("'media_url', ''");
    expect(migration).toContain("'filename', ''");
    expect(migration).toContain("'AUTOMATION_WEBHOOK_CLEARED'");
    expect(migration).toContain("'FLOW_MEDIA_CLEARED'");
    expect(migration).toContain(
      'private.compact_branch_setup_warnings(v_warnings)'
    );
    for (const code of BRANCH_SETUP_WARNING_CODES) {
      expect(migration).toContain(`'${code}'`);
    }
  });

  it('preserves the legacy branch RPC and locks caller-facing functions down', () => {
    expect(migration).toMatch(
      /CREATE OR REPLACE FUNCTION public\.create_organization_branch\(\r?\n  p_organization_id UUID,\r?\n  p_legal_entity_id UUID,\r?\n  p_name TEXT\r?\n\) RETURNS UUID/
    );
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION public.preview_organization_branch_setup'
    );
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION public.complete_organization_branch_setup'
    );
    for (const signature of [
      'public.preview_organization_branch_setup(UUID, UUID, TEXT, UUID, TEXT[])',
      'public.create_organization_branch_from_setup(UUID, UUID, UUID, TEXT, TEXT, UUID, TEXT[])',
      'public.complete_organization_branch_setup(UUID, BOOLEAN)',
      'public.create_organization_branch(UUID, UUID, TEXT)',
    ]) {
      expect(migration).toContain(`REVOKE ALL ON FUNCTION ${signature}`);
      expect(migration).toContain(`GRANT EXECUTE ON FUNCTION ${signature}`);
    }
    expect(migration.match(/SET search_path = ''/g)?.length).toBeGreaterThan(
      10
    );
  });

  it('enforces authored parent and child mutation rules through RLS', () => {
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION private.protect_authored_parent_identity'
    );
    expect(migration).toContain('CREATE POLICY automations_update');
    expect(migration).toContain('CREATE POLICY flows_update');
    expect(migration).toContain('CREATE POLICY automation_steps_update');
    expect(migration).toContain('CREATE POLICY flow_nodes_update');
    expect(migration).toMatch(
      /CREATE POLICY automations_update[\s\S]*?user_id = \(SELECT auth\.uid\(\)\)/
    );
    expect(migration).toMatch(
      /CREATE POLICY flows_delete[\s\S]*?OR public\.is_account_member\(account_id, 'admin'\)/
    );
    expect(migration).toContain("pg_catalog.to_jsonb(NEW)->>'automation_id'");
    expect(migration).toContain("pg_catalog.to_jsonb(NEW)->>'flow_id'");
    expect(migration).not.toContain('NEW.automation_id IS DISTINCT FROM');
    expect(migration).not.toContain('NEW.flow_id IS DISTINCT FROM');
  });

  it('revalidates completion and clears review markers on restore', () => {
    expect(migration).toMatch(
      /complete_organization_branch_setup[\s\S]*?JOIN public\.plan_pricing_options[\s\S]*?mp\.is_active/
    );
    expect(migration).toContain("'branch.setup_completed'");
    expect(migration).toMatch(
      /CREATE OR REPLACE FUNCTION public\.restore_branch[\s\S]*?readiness_state = 'attention',[\s\S]*?setup_reviewed_at = NULL,[\s\S]*?setup_reviewed_by = NULL/
    );
    expect(migration).toContain('setup_reviewed_at TIMESTAMPTZ');
    expect(migration).toContain('setup_reviewed_by UUID');
  });
});
