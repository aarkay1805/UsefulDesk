/** Local disposable rollback acceptance. No env files, provider calls or cloud target. */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createDisposablePostgres } from './lib/disposable-postgres.mjs';
const { sql } = createDisposablePostgres(process.argv[2]);
const root = fileURLToPath(new URL('../', import.meta.url));
const read = (path) => readFileSync(`${root}/${path}`, 'utf8');
const absent =
  "SELECT to_regclass('private.subscription_live_settings') IS NULL;";
if (sql(absent).trim() !== 't')
  throw new Error('Expected no installed Live schema');
const baseline = readdirSync(`${root}/supabase/migrations`)
  .filter((name) => /^\d+_subscription_live_.*\.sql$/.test(name))
  .sort();
const sources = [
  ...baseline,
  '20260930164040_starter_live_pilot_opening_preparation.sql',
  '20261002080000_starter_customer_checkout_scope.sql',
  '20261002111500_starter_customer_owner_review.sql',
  '20261002132000_starter_live_capability_activation.sql',
];
const renewal =
  'supabase/migrations/20261002170000_starter_live_customer_renewals.sql';
const migration = read(renewal);
const output = sql(
  [
    'BEGIN; SET LOCAL client_min_messages=warning;',
    ...sources.map((name) => read(`supabase/migrations/${name}`)),
    migration,
    migration,
    read('scripts/verify-starter-live-pilot-opening.sql').replace(
      '-- STARTER_PILOT_CAPABILITY_ACCEPTANCE',
      read('scripts/verify-starter-live-pilot-capabilities.sql')
    ),
    read('scripts/verify-starter-customer-checkout.sql').replaceAll(
      'Synthetic unissued tax note',
      'GST not charged — supplier unregistered.'
    ),
    read('scripts/verify-starter-live-renewals.sql'),
    'ROLLBACK;',
  ].join('\n')
);
for (const line of output
  .split('\n')
  .filter((line) => line.startsWith('PASS:')))
  console.log(line);
if (sql(absent).trim() !== 't')
  throw new Error('Live schema survived rollback');
console.log(
  'PASS: customer renewal source replay and fixtures rolled back; no Live schema remains'
);
