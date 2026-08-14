import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { normalizeSignupFullName } from './signup';

const read = (path: string) =>
  readFileSync(resolve(process.cwd(), path), 'utf8');

describe('signup provisioning invariant', () => {
  it.each(['', '   ', '\t\n'])('rejects a blank required full name', (name) => {
    expect(normalizeSignupFullName(name)).toBeNull();
  });

  it('normalizes the name sent to Auth', () => {
    expect(normalizeSignupFullName('  Rajat Kashyap  ')).toBe('Rajat Kashyap');

    const page = read('src/app/(auth)/signup/page.tsx');
    expect(page).toMatch(/if \(!trimmedFullName\)/);
    expect(page).toMatch(/full_name: trimmedFullName/);
  });

  it('keeps Auth and tenant provisioning in one failure boundary', () => {
    const migration = read(
      'supabase/migrations/20260814164144_make_signup_provisioning_atomic.sql'
    );

    expect(migration).toMatch(
      /v_full_name TEXT := btrim\(COALESCE\(NEW\.raw_user_meta_data->>'full_name', ''\)\)/
    );
    expect(migration).toMatch(
      /IF v_full_name = '' THEN[\s\S]*ERRCODE = '22023'/
    );
    expect(migration).not.toMatch(/EXCEPTION\s+WHEN\s+OTHERS/);
  });
});
