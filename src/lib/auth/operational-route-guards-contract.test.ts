import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const route = (path: string) =>
  readFileSync(resolve(process.cwd(), `src/app/api/${path}/route.ts`), 'utf8');

function count(source: string, pattern: RegExp) {
  return Array.from(source.matchAll(pattern)).length;
}

describe('operational route authorization contract', () => {
  it.each([
    ['automations', 2],
    ['automations/[id]', 3],
    ['automations/[id]/duplicate', 1],
    ['automations/engine', 1],
  ])('guards every %s handler with operational access', (path, expected) => {
    expect(count(route(path), /await requireOperationalAccess\(\)/g)).toBe(
      expected
    );
  });

  it.each([
    ['flows', 1],
    ['flows/[id]', 2],
    ['flows/[id]/activate', 1],
  ])(
    'guards every service-role mutation in %s with operational access',
    (path, expected) => {
      expect(count(route(path), /await requireOperationalAccess\(\)/g)).toBe(
        expected
      );
    }
  );

  it('scopes service-role automation and flow parent queries to the current tenant', () => {
    for (const path of [
      'automations/[id]',
      'automations/[id]/duplicate',
      'flows/[id]',
      'flows/[id]/activate',
    ]) {
      expect(route(path)).toContain(".eq('account_id', ctx.accountId)");
    }

    expect(route('automations/[id]')).not.toContain(".eq('user_id', user.id)");
    expect(route('automations/[id]/duplicate')).not.toContain(
      ".eq('user_id', user.id)"
    );
  });

  it.each([
    ['automations', 1],
    ['automations/[id]', 2],
    ['automations/[id]/duplicate', 1],
    ['flows', 1],
    ['flows/[id]', 2],
    ['flows/[id]/activate', 1],
  ])(
    'requires same-origin requests for every %s mutation',
    (path, expected) => {
      expect(count(route(path), /requireSameOriginRequest\(request\)/g)).toBe(
        expected
      );
    }
  );

  it('mirrors authored-content rules before service-role definition writes', () => {
    expect(route('automations')).toContain('canEditAuthoredContent');
    expect(route('automations/[id]')).toContain('canEditAuthoredContent');
    expect(route('automations/[id]')).toContain('canDeleteAuthoredContent');
    expect(route('automations/[id]/duplicate')).toContain(
      'canEditAuthoredContent'
    );
    expect(route('flows')).toContain('canEditAuthoredContent');
    expect(route('flows/[id]')).toContain('canEditAuthoredContent');
    expect(route('flows/[id]')).toContain('canDeleteAuthoredContent');
    expect(route('flows/[id]/activate')).toContain('canEditAuthoredContent');
  });

  it.each([
    ['whatsapp/send', 'requireOperationalAccess', 1],
    ['whatsapp/react', 'requireOperationalAccess', 1],
    ['whatsapp/broadcast', 'requireOperationalAccess', 1],
    ['whatsapp/config', 'requireSettingsAccess', 3],
    ['whatsapp/config/register', 'requireSettingsAccess', 1],
    ['whatsapp/config/verify-registration', 'requireSettingsAccess', 1],
    ['whatsapp/embedded-signup', 'requireSettingsAccess', 1],
    ['whatsapp/templates/submit', 'requireSettingsAccess', 1],
    ['whatsapp/templates/sync', 'requireSettingsAccess', 1],
    ['whatsapp/templates/[id]', 'requireSettingsAccess', 2],
    ['meta/leads/connect', 'requireSettingsAccess', 2],
    ['meta/leads/health', 'requireSettingsAccess', 1],
  ])('requires the appropriate capability in %s', (path, guard, expected) => {
    expect(count(route(path), new RegExp(`await ${guard}\\(\\)`, 'g'))).toBe(
      expected
    );
  });

  it.each([
    ['meta/leads/connect', 2],
    ['meta/leads/health', 1],
  ])(
    'requires same-origin requests for Meta mutation route %s',
    (path, expected) => {
      expect(count(route(path), /requireSameOriginRequest\(request\)/g)).toBe(
        expected
      );
    }
  );
});
