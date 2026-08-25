import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

const migrations = readdirSync(join(process.cwd(), 'supabase/migrations'))
  .filter((name) => name.endsWith('.sql'))
  .sort()
  .map((name) => ({ name, sql: read(`supabase/migrations/${name}`) }));

const containmentMigration = migrations.find(
  ({ name }) =>
    name === '20260814021023_block_membership_mutations_with_live_mandates.sql'
);
const lifecycleMigration = migrations
  .filter(({ sql }) =>
    sql.includes(
      'CREATE OR REPLACE FUNCTION private.enforce_membership_provider_lifecycle()'
    )
  )
  .at(-1);

const memberDetail = read('src/components/members/member-detail-view.tsx');
const dangerZone = read('src/components/members/member-danger-zone.tsx');

describe('Razorpay membership lifecycle boundary', () => {
  it('blocks client lifecycle changes and deletion while a mandate is blocking', () => {
    expect(lifecycleMigration).toBeDefined();
    expect(lifecycleMigration!.sql).toContain(
      "status IN ('creating', 'pending', 'active', 'paused', 'orphaned')"
    );
    expect(lifecycleMigration!.sql).toMatch(
      /current_user IN \('anon', 'authenticated'\)[\s\S]*auth\.uid\(\)/
    );
    expect(lifecycleMigration!.sql).toMatch(
      /NEW\.plan_id IS DISTINCT FROM OLD\.plan_id[\s\S]*NEW\.collection_mode IS DISTINCT FROM OLD\.collection_mode/
    );
    expect(containmentMigration).toBeDefined();
    expect(containmentMigration!.sql).toContain(
      'BEFORE UPDATE OF plan_id, pricing_option_id, start_date, end_date,'
    );
    expect(containmentMigration!.sql).toContain(
      'BEFORE DELETE ON public.memberships'
    );
  });

  it('prevents provider callbacks from resurrecting incompatible memberships', () => {
    expect(lifecycleMigration).toBeDefined();
    expect(lifecycleMigration!.sql).toMatch(
      /NEW\.collection_mode = 'auto'[\s\S]*NEW\.status <> 'active'[\s\S]*NEW\.is_trial/
    );
    expect(lifecycleMigration!.sql).toMatch(
      /OLD\.status <> 'active'[\s\S]*NEW\.status = 'active'[\s\S]*v_has_blocking_mandate/
    );
  });

  it('turns a charge against an incompatible membership into an exception', () => {
    expect(containmentMigration).toBeDefined();
    expect(containmentMigration!.sql).toContain(
      'CREATE OR REPLACE FUNCTION private.enforce_auto_payment_membership_state()'
    );
    expect(containmentMigration!.sql).toMatch(
      /NEW\.source <> 'auto'[\s\S]*v_membership\.status <> 'active'[\s\S]*v_membership\.is_trial/
    );
    expect(containmentMigration!.sql).toContain(
      'BEFORE INSERT ON public.payments'
    );
  });

  it('guards the known member UI mutation surfaces when a mandate blocks them', () => {
    expect(memberDetail).toContain(
      'const membershipLifecycleBlockReason = mandate'
    );
    expect(memberDetail).toContain(
      'blockedReason={membershipLifecycleBlockReason}'
    );
    expect(memberDetail).toMatch(
      /<MembershipActionsMenu[\s\S]*?lifecycleBlockReason=\{[\s\S]*?membershipLifecycleBlockReason[\s\S]*?\}/
    );
    expect(dangerZone).toContain('blockedReason?: string | null;');
    expect(dangerZone).toContain('disabled={!canDelete || !!blockedReason}');
  });
});
