import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Text contract for the migration that dropped filter_contacts_by_tags, the
// tag filter the Contacts page and then the Leads list called until 088553a5;
// the Leads listing now filters tags in lead_listing_snapshot. 039 revoked
// EXECUTE only from PUBLIC, so anon and service_role kept it until the drop.
// No database is reachable from unit tests, so the drop was checked on
// Production.
const migrationsDir = join(process.cwd(), 'supabase/migrations');
const migrations = readdirSync(migrationsDir)
  .filter((name) => name.endsWith('.sql'))
  .sort();

// Without line comments, so a header that only names the function (a rollback
// note, a caller) never counts as touching it.
function code(name: string): string {
  return readFileSync(join(migrationsDir, name), 'utf8').replace(/--.*$/gm, '');
}

function statements(name: string): string[] {
  return code(name)
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean);
}

const DROP = '20260927160000_drop_filter_contacts_by_tags.sql';
const LAST_SIGNATURE = 'UUID[], TEXT, INTEGER, INTEGER, BOOLEAN';

const touching = migrations.filter((name) =>
  code(name).includes('public.filter_contacts_by_tags(')
);

// The argument types that identify an overload, as Postgres compares them:
// parameter names and defaults do not count, and INT is INTEGER.
function argumentTypes(list: string, named: boolean): string {
  return list
    .split(',')
    .map((argument) => {
      const words = argument.trim().split(/\s+/);
      const type = words.slice(named ? 1 : 0);
      const end = type.findIndex((word) => /^DEFAULT$/i.test(word));
      return type
        .slice(0, end < 0 ? undefined : end)
        .join(' ')
        .toUpperCase()
        .replace(/^INT$/, 'INTEGER');
    })
    .join(', ');
}

function signatures(pattern: RegExp, named: boolean) {
  return touching.flatMap((name) =>
    Array.from(code(name).matchAll(pattern), ([, list]) => ({
      name,
      types: argumentTypes(list, named),
    }))
  );
}

const created = signatures(
  /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.filter_contacts_by_tags\(([^)]*)\)/gi,
  true
);
const dropped = signatures(
  /DROP\s+FUNCTION\s+(?:IF\s+EXISTS\s+)?public\.filter_contacts_by_tags\(([^)]*)\)/gi,
  false
);

// Read once while the file loads, like the other source scans, so a busy
// parallel run cannot time the scan out. The web app, the mobile app, and the
// scripts are everything outside supabase/ that could call it.
const CALLER_ROOTS = ['src', 'apps/mobile/app', 'apps/mobile/src', 'scripts'];
const callers = CALLER_ROOTS.flatMap((root) =>
  readdirSync(join(process.cwd(), root), { recursive: true, encoding: 'utf8' })
    .filter(
      (path) =>
        /\.(tsx?|jsx?|mjs|sql)$/.test(path) && !/\.test\.\w+$/.test(path)
    )
    .filter((path) =>
      readFileSync(join(process.cwd(), root, path), 'utf8').includes(
        'filter_contacts_by_tags'
      )
    )
    .map((path) => join(root, path))
);

describe('filter_contacts_by_tags drop contract', () => {
  it('drops only the last definition, without CASCADE', () => {
    // IF EXISTS silently skips a signature that does not exist, so the DROP
    // must name the one the last CREATE defined.
    expect(created.at(-1)).toEqual({
      name: '039_leads.sql',
      types: LAST_SIGNATURE,
    });
    expect(statements(DROP)).toEqual([
      `DROP FUNCTION IF EXISTS public.filter_contacts_by_tags(${LAST_SIGNATURE})`,
    ]);
  });

  it('leaves no overload behind', () => {
    // 025's four-argument version was dropped by 039, which re-created it
    // with p_exclude_members.
    expect(created.map(({ types }) => types)).toEqual([
      'UUID[], TEXT, INTEGER, INTEGER',
      LAST_SIGNATURE,
    ]);
    const survivors = created.filter(
      (definition) =>
        !dropped.some(
          ({ name, types }) =>
            types === definition.types && name > definition.name
        )
    );
    expect(survivors).toEqual([]);
  });

  it('stays dropped', () => {
    // A later migration that brings it back gets service_role EXECUTE from
    // the schema default, so it must revoke that itself and update this
    // contract.
    expect(touching.at(-1)).toBe(DROP);
  });

  it('leaves no app code calling it', () => {
    expect(callers).toEqual([]);
  });
});
