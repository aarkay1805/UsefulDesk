import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) =>
  readFileSync(resolve(process.cwd(), path), 'utf8');

describe('password recovery authorization boundary', () => {
  it('carries verified recovery intent from the callback to a server route', () => {
    const callback = read('src/app/auth/callback/route.ts');
    const updateRoute = 'src/app/(auth)/reset-password/update/route.ts';

    expect(callback).toContain('redirectType');
    expect(callback).toContain('RECOVERY_INTENT_COOKIE');
    expect(existsSync(resolve(process.cwd(), updateRoute))).toBe(true);
  });

  it('never lets the browser update a password directly from reset UI', () => {
    const page = read('src/app/(auth)/reset-password/page.tsx');

    expect(page).not.toMatch(/supabase\.auth\.updateUser/);
    expect(page).toContain("fetch('/reset-password/update'");
  });

  it('keeps invitation continuation constrained across every auth boundary', () => {
    const callback = read('src/app/auth/callback/route.ts');
    const updateRoute = read('src/app/(auth)/reset-password/update/route.ts');
    const proxy = read('src/proxy.ts');

    expect(callback).toContain('invitationTokenFromPath(rawNext)');
    expect(callback).toContain('issueRecoveryIntent');
    expect(updateRoute).toContain('recovery.continueTo');
    expect(proxy).toContain('normalizeInvitationToken');
  });
});
