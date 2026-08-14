import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = (name: string) =>
  readFileSync(resolve(process.cwd(), `supabase/migrations/${name}`), 'utf8');

const hardeningSql = migration(
  '20260814165451_close_profile_insert_authority.sql'
);
const signupSql = migration(
  '20260814164144_make_signup_provisioning_atomic.sql'
);

function functionBody(sql: string, name: string) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return sql.match(
    new RegExp(
      `CREATE OR REPLACE FUNCTION public\\.${escapedName}\\([\\s\\S]*?\\n\\$\\$;`
    )
  )?.[0];
}

describe('profile insert authority boundary', () => {
  it('removes direct profile creation from untrusted Data API roles', () => {
    expect(hardeningSql).toContain(
      'DROP POLICY IF EXISTS profiles_insert ON public.profiles;'
    );
    expect(hardeningSql).toContain(
      'REVOKE INSERT ON TABLE public.profiles FROM PUBLIC, anon, authenticated;'
    );
    expect(hardeningSql).not.toContain('CREATE POLICY profiles_insert');
  });

  it('leaves profile reads and self-service updates unchanged', () => {
    expect(hardeningSql).not.toMatch(
      /DROP POLICY IF EXISTS profiles_(?:select|update)/
    );
    expect(hardeningSql).not.toMatch(/REVOKE (?:SELECT|UPDATE)/);
  });

  it('preserves privileged atomic signup provisioning', () => {
    const body = functionBody(signupSql, 'handle_new_user');

    expect(body).toBeDefined();
    expect(body).toContain('SECURITY DEFINER');
    expect(body).toMatch(
      /INSERT INTO public\.profiles \(user_id, full_name, email, account_id, account_role\)/
    );
    expect(body).toMatch(
      /INSERT INTO public\.account_memberships \(account_id, user_id, role, created_by_user_id\)/
    );
    expect(signupSql).toContain(
      'ALTER FUNCTION public.handle_new_user() OWNER TO postgres;'
    );
    expect(hardeningSql).not.toMatch(/REVOKE INSERT[\s\S]*service_role/);
  });
});
