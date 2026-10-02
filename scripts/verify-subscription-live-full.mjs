/** Rollback-only Live boundary acceptance on the existing disposable full schema.
 * No provider calls, installed migrations, .env loading, or Production target.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createDisposablePostgres } from './lib/disposable-postgres.mjs';

const { sql } = createDisposablePostgres(process.argv[2], {
  errorMessage:
    'Pass an explicit disposable subscription-full database container',
});
const root = fileURLToPath(new URL('../', import.meta.url));

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
