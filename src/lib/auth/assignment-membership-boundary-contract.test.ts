import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  join(
    process.cwd(),
    'supabase/migrations/20260813201114_enforce_account_scoped_assignments.sql'
  ),
  'utf8'
);

describe('account-scoped assignment boundary', () => {
  it('rejects assignment targets that are not active branch teammates', () => {
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION private.enforce_account_user_reference()'
    );
    expect(migration).toMatch(
      /private\.user_has_account_membership\(\s*NEW\.account_id,\s*v_user_id,\s*v_min_role\s*\)/
    );

    for (const trigger of [
      'trg_contacts_assignee_membership',
      'trg_conversations_assignee_membership',
      'trg_follow_ups_assignee_membership',
    ]) {
      expect(migration).toContain(`CREATE TRIGGER ${trigger}`);
    }

    expect(migration).toContain(
      "EXECUTE FUNCTION private.enforce_account_user_reference('assigned_to', 'viewer')"
    );
    expect(migration).toContain(
      "EXECUTE FUNCTION private.enforce_account_user_reference('assigned_agent_id', 'viewer')"
    );
  });

  it('requires current branch membership to receive or read notifications', () => {
    expect(migration).toContain(
      'CREATE TRIGGER trg_notifications_recipient_membership'
    );
    expect(migration).toContain(
      "EXECUTE FUNCTION private.enforce_account_user_reference('user_id', 'viewer')"
    );
    expect(migration).toMatch(
      /CREATE POLICY notifications_select[\s\S]*?auth\.uid\(\) = user_id[\s\S]*?public\.has_account_membership\(account_id\)/
    );
    expect(migration).toMatch(
      /CREATE POLICY notifications_update[\s\S]*?USING \([\s\S]*?public\.has_account_membership\(account_id\)[\s\S]*?WITH CHECK \([\s\S]*?public\.has_account_membership\(account_id\)/
    );
  });

  it('cleans assignments and notifications when branch access is removed', () => {
    const removal = migration.slice(
      migration.indexOf(
        'CREATE OR REPLACE FUNCTION public.remove_account_member(p_user_id UUID)'
      ),
      migration.indexOf(
        'ALTER FUNCTION public.remove_account_member(UUID) OWNER TO postgres'
      )
    );

    expect(removal).toContain('UPDATE public.contacts');
    expect(removal).toContain('SET assigned_to = NULL');
    expect(removal).toContain('UPDATE public.conversations');
    expect(removal).toContain('SET assigned_agent_id = NULL');
    expect(removal).toContain('UPDATE public.follow_ups');
    expect(removal).toContain('DELETE FROM public.notifications');
    expect(removal).toContain('DELETE FROM public.account_memberships');
  });

  it('repairs stale rows before enabling the enforcement triggers', () => {
    expect(migration).toMatch(
      /UPDATE public\.contacts AS contact[\s\S]*?NOT private\.user_has_account_membership/
    );
    expect(migration).toMatch(
      /UPDATE public\.conversations AS conversation[\s\S]*?NOT private\.user_has_account_membership/
    );
    expect(migration).toMatch(
      /UPDATE public\.follow_ups AS follow_up[\s\S]*?NOT private\.user_has_account_membership/
    );
    expect(migration).toMatch(
      /DELETE FROM public\.notifications AS notification[\s\S]*?NOT private\.user_has_account_membership/
    );
  });
});
