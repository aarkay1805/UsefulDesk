import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Text contract for the migration that made Enquiries by stage's read
// authenticated-only. 047 revoked EXECUTE only from PUBLIC, and CREATE OR
// REPLACE keeps a function's grants, so anon and service_role kept EXECUTE
// through the body migration; enquiry-definition-rpc.test.ts still pins the
// statements that migration repeated from 047. No database is reachable from
// unit tests, so the applied ACL was checked on Production.
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

const GRANTS = '20260927150000_lead_funnel_stats_authenticated_only.sql';
const AUTHENTICATED_ONLY = [
  'REVOKE ALL ON FUNCTION public.lead_funnel_stats() FROM PUBLIC, anon, service_role',
  'GRANT EXECUTE ON FUNCTION public.lead_funnel_stats() TO authenticated',
];

const touching = migrations.filter((name) =>
  code(name).includes('public.lead_funnel_stats(')
);

// Read once while the file loads, like the other source scans, so a busy
// parallel run cannot time the scan out.
const SRC = join(process.cwd(), 'src');
const sources = readdirSync(SRC, { recursive: true, encoding: 'utf8' })
  .filter((path) => /\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path))
  .map((path) => ({ path, text: readFileSync(join(SRC, path), 'utf8') }));

function filesNaming(name: string): string[] {
  return sources
    .filter(({ text }) => text.includes(name))
    .map(({ path }) => path)
    .sort();
}

describe('lead_funnel_stats grants contract', () => {
  it('changes only the grants, to the same authenticated-only pair as the Leads listing', () => {
    expect(statements(GRANTS)).toEqual(AUTHENTICATED_ONLY);
  });

  it('keeps the latest migration that touches the function authenticated-only', () => {
    // A later migration that re-creates or re-grants the function must restate
    // the pair; a DROP and CREATE would otherwise bring back the defaults.
    const latest = touching.at(-1);
    expect(latest && latest >= GRANTS).toBe(true);
    expect(statements(latest!)).toEqual(
      expect.arrayContaining(AUTHENTICATED_ONLY)
    );
  });

  it('never grants the function to anyone but authenticated', () => {
    const grantees = touching.flatMap((name) =>
      Array.from(
        code(name).matchAll(
          /GRANT\s+\w+\s+ON\s+FUNCTION\s+public\.lead_funnel_stats\(\)\s+TO\s+([^;]+);/gi
        ),
        ([, roles]) => roles.trim()
      )
    );
    expect(grantees.length).toBeGreaterThan(0);
    expect(new Set(grantees)).toEqual(new Set(['authenticated']));
  });

  it('leaves its one caller on the signed-in browser client', () => {
    // service_role lost EXECUTE, so an admin client calling it would now fail
    // with 42501 instead of counting every branch's enquiries together.
    expect(filesNaming('lead_funnel_stats')).toEqual([
      'lib/reports/enquiry-stages.ts',
    ]);
    expect(filesNaming('loadEnquiryStages')).toEqual([
      'components/reports/enquiry-stages-card.tsx',
      'lib/reports/enquiry-stages.ts',
    ]);
    const card = sources.find(
      ({ path }) => path === 'components/reports/enquiry-stages-card.tsx'
    )!.text;
    expect(card).toContain(
      "import { createClient } from '@/lib/supabase/client';"
    );
    expect(card).toContain('loadEnquiryStages(createClient())');
  });
});
