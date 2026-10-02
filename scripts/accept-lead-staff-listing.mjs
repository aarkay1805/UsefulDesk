/** Explicit disposable local container only; no env or cloud connections. */
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const container = process.argv[2];
if (!/^usefuldesk-lead-workflow-test(?:-[a-z0-9]+)?$/.test(container ?? '')) {
  throw new Error(
    'Pass an explicit disposable usefuldesk-lead-workflow-test container'
  );
}
const read = (path) => readFileSync(join(root, path), 'utf8');
const extract = (source, functionName) => {
  const start = source.indexOf(
    `CREATE OR REPLACE FUNCTION public.${functionName}(`
  );
  const end = source.indexOf('\n$$;', start);
  if (start < 0 || end < 0) throw new Error(`Missing ${functionName}`);
  return source.slice(start, end + 4);
};
const migrations = readdirSync(join(root, 'supabase/migrations'))
  .filter((name) => name.endsWith('.sql'))
  .sort();
const listingMigration = process.argv.includes('--baseline')
  ? '20260927130000_enquiry_reads_exclude_service_customers.sql'
  : migrations
      .filter((name) =>
        read(`supabase/migrations/${name}`).includes(
          'CREATE OR REPLACE FUNCTION public.lead_listing_snapshot('
        )
      )
      .at(-1);
const roster = extract(
  read(
    'supabase/migrations/20260728162503_organization_account_memberships.sql'
  ),
  'list_account_members'
);
const listing = extract(
  read(`supabase/migrations/${listingMigration}`),
  'lead_listing_snapshot'
);
const sql = [
  'BEGIN;',
  read('supabase/tests/lead_staff_listing_fixture.sql'),
  roster,
  listing,
  read('supabase/tests/lead_staff_listing_acceptance.sql'),
  'ROLLBACK;',
].join('\n');
execFileSync(
  'docker',
  [
    'exec',
    '-i',
    container,
    'psql',
    '-X',
    '-U',
    'postgres',
    '-d',
    'postgres',
    '-v',
    'ON_ERROR_STOP=1',
    '-q',
  ],
  { input: sql, stdio: ['pipe', 'inherit', 'inherit'] }
);
console.log(
  `Lead staff listing acceptance passed (${listingMigration}); fixtures rolled back.`
);
