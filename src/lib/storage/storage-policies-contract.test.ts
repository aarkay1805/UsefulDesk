import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/20260725230417_harden_storage_media_access.sql'
  ),
  'utf8'
);

const avatarUploadFix = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/20260726151441_allow_avatar_upload_metadata_returning.sql'
  ),
  'utf8'
);

function policy(name: string, sql = migration) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return sql.match(
    new RegExp(
      `CREATE POLICY "${escaped}"[\\s\\S]*?(?=\\n(?:DROP|CREATE) POLICY|\\n--|$)`
    )
  )?.[0];
}

describe('storage media policy contract', () => {
  it('keeps delivery buckets public and receipt buckets private', () => {
    expect(migration).toMatch(
      /WHEN id IN \('avatars', 'chat-media', 'flow-media'\) THEN TRUE/
    );
    expect(migration).toMatch(/'payment-receipts',\s*'expense-receipts'/);
  });

  it.each([
    'Avatar object retrieval without listing',
    'Chat media object retrieval without listing',
    'Flow media object retrieval without listing',
    'Account members can read payment receipts',
    'Account members can read expense receipts',
  ])('allows exact-object retrieval but not listing: %s', (name) => {
    const sql = policy(name);

    expect(sql).toBeDefined();
    expect(sql).toContain('storage.allow_any_operation');
    expect(sql).toContain("'object.get_authenticated_info'");
    expect(sql).toContain("'object.get_authenticated'");
    expect(sql).not.toContain("'object.list'");
  });

  it.each([
    ['chat', 'Agents can upload chat media'],
    ['chat', 'Agents can update chat media'],
    ['chat', 'Agents can delete chat media'],
    ['flow', 'Agents can upload flow media'],
    ['flow', 'Agents can update flow media'],
    ['flow', 'Agents can delete flow media'],
  ])(
    'requires authenticated agent capability for %s media writes',
    (_, name) => {
      const sql = policy(name);

      expect(sql).toBeDefined();
      expect(sql).toMatch(/TO authenticated/);
      expect(sql).toMatch(/public\.is_account_member\([\s\S]*?'agent'/);
      expect(sql).toContain('^account-');
    }
  );

  it('keeps avatar writes authenticated and user-folder scoped', () => {
    for (const name of [
      'Users can upload their own avatar',
      'Users can update their own avatar',
      'Users can delete their own avatar',
    ]) {
      const sql = policy(name);
      expect(sql).toBeDefined();
      expect(sql).toMatch(/TO authenticated/);
      expect(sql).toMatch(
        /\(storage\.foldername\(name\)\)\[1\] = \(SELECT auth\.uid\(\)\)::TEXT/
      );
    }

    expect(policy('Users can update their own avatar')).toContain('WITH CHECK');
  });

  it('returns avatar upload metadata without allowing bucket listing', () => {
    const sql = policy(
      'Users can read their own avatar upload metadata',
      avatarUploadFix
    );

    expect(sql).toBeDefined();
    expect(sql).toMatch(/FOR SELECT TO authenticated/);
    expect(sql).toMatch(
      /\(storage\.foldername\(name\)\)\[1\] = \(SELECT auth\.uid\(\)\)::TEXT/
    );
    expect(sql).toContain("'object.upload'");
    expect(sql).toContain("'object.upload_update'");
    expect(sql).not.toContain("'object.list'");
  });

  it('preserves receipt capabilities and persisted-object delete guards', () => {
    expect(policy('Agents can upload payment receipts')).toMatch(
      /TO authenticated[\s\S]*?'agent'/
    );
    expect(policy('Agents can delete staged payment receipts')).toMatch(
      /NOT EXISTS[\s\S]*?FROM public\.payments/
    );
    expect(policy('Admins can upload expense receipts')).toMatch(
      /TO authenticated[\s\S]*?'admin'/
    );
    expect(policy('Admins can delete staged expense receipts')).toMatch(
      /NOT EXISTS[\s\S]*?FROM public\.expenses/
    );
  });
});
