/** Rollback-only Live boundary acceptance on the existing disposable full schema.
 * No provider calls, installed migrations, .env loading, or Production target.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const container = process.argv[2];
if (
  !container ||
  !/^supabase_db_usefuldesk-subscription-full-[a-z0-9]+$/.test(container)
) {
  throw new Error(
    'Pass an explicit disposable subscription-full database container'
  );
}
const root = fileURLToPath(new URL('../', import.meta.url));
function sql(input) {
  return execFileSync(
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
      '-Atq',
      '-v',
      'ON_ERROR_STOP=1',
    ],
    { input, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }
  );
}
const before = sql(
  "SELECT to_regclass('private.subscription_live_settings') IS NULL;"
).trim();
if (before !== 't')
  throw new Error('Expected no installed Live billing schema');
const migrations = readdirSync(`${root}/supabase/migrations`)
  .filter((name) => /^\d+_subscription_live_.*\.sql$/.test(name))
  .sort();
const checks = [
  'verify-subscription-live-full.sql',
  'verify-subscription-live-renewals.sql',
  'verify-subscription-live-complimentary.sql',
];
const input = [
  'BEGIN;',
  ...migrations.map((name) =>
    readFileSync(`${root}/supabase/migrations/${name}`, 'utf8')
  ),
  // Replay the additive evidence source before fixtures to check idempotency.
  readFileSync(
    `${root}/supabase/migrations/20261002023000_subscription_live_delivery_receipts.sql`,
    'utf8'
  ),
  ...checks.flatMap((name) => [
    'SAVEPOINT acceptance_fixture;',
    readFileSync(`${root}/scripts/${name}`, 'utf8'),
    ...(name === 'verify-subscription-live-full.sql'
      ? [
          readFileSync(
            `${root}/scripts/verify-subscription-live-delivery-receipts.sql`,
            'utf8'
          ),
        ]
      : []),
    'ROLLBACK TO acceptance_fixture;',
    'RELEASE acceptance_fixture;',
  ]),
  'ROLLBACK;',
].join('\n');
const output = sql(input);
for (const line of output
  .split('\n')
  .filter((line) => line.startsWith('PASS:')))
  console.log(line);
if (
  sql(
    "SELECT to_regclass('private.subscription_live_settings') IS NULL;"
  ).trim() !== 't'
) {
  throw new Error('Live schema survived rollback');
}
console.log(
  `PASS: ${migrations.length} draft migrations rolled back; no Live schema installed`
);
