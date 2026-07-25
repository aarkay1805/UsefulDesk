import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = (name: string) =>
  readFileSync(
    resolve(process.cwd(), `supabase/migrations/${name}`),
    'utf8'
  );

const guardSql = migration(
  '20260725161912_protect_profile_membership_fields.sql'
);

function functionBody(sql: string, name: string) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return sql.match(
    new RegExp(
      `CREATE OR REPLACE FUNCTION public\\.${escapedName}\\([\\s\\S]*?\\n\\$\\$;`
    )
  )?.[0];
}

describe('profile membership-field isolation contract', () => {
  it('rejects direct authenticated tenant switches and role changes', () => {
    expect(guardSql).toMatch(/SECURITY INVOKER/);
    expect(guardSql).toMatch(/current_user = 'authenticated'/);
    expect(guardSql).toMatch(
      /NEW\.account_id IS DISTINCT FROM OLD\.account_id/
    );
    expect(guardSql).toMatch(
      /NEW\.account_role IS DISTINCT FROM OLD\.account_role/
    );
    expect(guardSql).toMatch(/ERRCODE = '42501'/);
    expect(guardSql).toMatch(
      /BEFORE UPDATE OF account_id, account_role ON public\.profiles/
    );
  });

  it('keeps ordinary self-service profile fields editable', () => {
    const sharingSql = migration('017_account_sharing.sql');
    const profileForm = readFileSync(
      resolve(process.cwd(), 'src/components/settings/profile-form.tsx'),
      'utf8'
    );
    const themeHook = readFileSync(
      resolve(process.cwd(), 'src/hooks/use-theme.tsx'),
      'utf8'
    );

    expect(sharingSql).toMatch(
      /CREATE POLICY profiles_update ON profiles FOR UPDATE[\s\S]*?WITH CHECK \(auth\.uid\(\) = user_id\);/
    );
    expect(profileForm).toMatch(
      /\.update\(\{\s*full_name: trimmedName,\s*avatar_url: nextAvatarUrl,\s*\}\)/
    );
    expect(themeHook).toMatch(
      /patch: \{ appearance_theme\?: ThemeId; appearance_mode\?: Mode \}/
    );
    expect(themeHook).not.toMatch(/account_(?:id|role)\s*:/);
  });

  it.each([
    [
      '018_account_member_rpcs.sql',
      'set_member_role',
      /SET account_role = p_new_role/,
    ],
    [
      '018_account_member_rpcs.sql',
      'remove_account_member',
      /SET account_id = v_new_account_id,\s*account_role = 'owner'/,
    ],
    [
      '018_account_member_rpcs.sql',
      'transfer_account_ownership',
      /UPDATE profiles SET account_role = 'owner'/,
    ],
    [
      '049_pending_invite_assignees.sql',
      'redeem_invitation',
      /SET account_id = v_inv\.account_id,\s*account_role = v_inv\.role/,
    ],
  ])(
    'preserves the audited %s membership path',
    (migrationName, rpcName, protectedWrite) => {
      const body = functionBody(migration(migrationName), rpcName);

      expect(body).toBeDefined();
      expect(body).toMatch(/SECURITY DEFINER/);
      expect(body).toMatch(/auth\.uid\(\)/);
      expect(body).toMatch(protectedWrite);
    }
  );

  it('preserves SECURITY DEFINER signup onboarding', () => {
    const body = functionBody(
      migration('055_account_localization.sql'),
      'handle_new_user'
    );

    expect(body).toBeDefined();
    expect(body).toMatch(/SECURITY DEFINER/);
    expect(body).toMatch(
      /INSERT INTO public\.profiles \(user_id, full_name, email, account_id, account_role\)/
    );
  });
});
