/** Explicit local-only rollback acceptance; no .env, cloud or provider access. */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createDisposablePostgres } from './lib/disposable-postgres.mjs';

const { sql } = createDisposablePostgres(process.argv[2], {
  errorMessage:
    'Pass an explicit disposable subscription-full local database container',
});
const root = fileURLToPath(new URL('../', import.meta.url));

const absent =
  "SELECT to_regclass('private.subscription_live_settings') IS NULL AND to_regclass('private.subscription_live_pilot_opening_reviews') IS NULL;";
if (sql(absent).trim() !== 't')
  throw new Error(
    'Expected a disposable full schema with no installed Live tables'
  );
const baseline = readdirSync(`${root}/supabase/migrations`)
  .filter((name) => /^\d+_subscription_live_.*\.sql$/.test(name))
  .sort();
const ownerReview = '20261002111500_starter_customer_owner_review.sql';
const customer = '20261002080000_starter_customer_checkout_scope.sql';
const preparation = '20260930164040_starter_live_pilot_opening_preparation.sql';
const acceptance = readFileSync(
  `${root}/scripts/verify-starter-live-pilot-opening.sql`,
  'utf8'
).replace(
  '-- STARTER_PILOT_CAPABILITY_ACCEPTANCE',
  readFileSync(
    `${root}/scripts/verify-starter-live-pilot-capabilities.sql`,
    'utf8'
  )
);
const migration = readFileSync(
  `${root}/supabase/migrations/${preparation}`,
  'utf8'
);
const input = [
  'BEGIN;',
  'SET LOCAL client_min_messages=warning;',
  ...baseline.map((name) =>
    readFileSync(`${root}/supabase/migrations/${name}`, 'utf8')
  ),
  migration,
  migration, // Idempotency: same preparation source twice before fixtures.
  ...(['--customer', '--documents', '--preparation'].includes(process.argv[3])
    ? [
        readFileSync(`${root}/supabase/migrations/${customer}`, 'utf8'),
        readFileSync(`${root}/supabase/migrations/${customer}`, 'utf8'),
        readFileSync(`${root}/supabase/migrations/${ownerReview}`, 'utf8'),
        readFileSync(`${root}/supabase/migrations/${ownerReview}`, 'utf8'),
      ]
    : []),
  ...(['--documents', '--preparation'].includes(process.argv[3])
    ? [
        readFileSync(
          `${root}/supabase/migrations/20261002124500_starter_subscription_documents.sql`,
          'utf8'
        ),
        readFileSync(
          `${root}/supabase/migrations/20261002124500_starter_subscription_documents.sql`,
          'utf8'
        ),
      ]
    : []),
  readFileSync(
    `${root}/supabase/migrations/20261002132000_starter_live_capability_activation.sql`,
    'utf8'
  ),
  readFileSync(
    `${root}/supabase/migrations/20261002132000_starter_live_capability_activation.sql`,
    'utf8'
  ),
  ...(['--documents', '--preparation'].includes(process.argv[3])
    ? [
        readFileSync(
          `${root}/supabase/migrations/20261002140000_starter_future_signup_selection.sql`,
          'utf8'
        ),
        readFileSync(
          `${root}/supabase/migrations/20261002140000_starter_future_signup_selection.sql`,
          'utf8'
        ),
      ]
    : []),
  ...(process.argv[3] === '--preparation'
    ? [
        readFileSync(
          `${root}/supabase/migrations/20261002170000_starter_live_customer_renewals.sql`,
          'utf8'
        ),
        readFileSync(
          `${root}/supabase/migrations/20261003003000_starter_signup_preparation.sql`,
          'utf8'
        ),
        readFileSync(
          `${root}/supabase/migrations/20261003003000_starter_signup_preparation.sql`,
          'utf8'
        ),
      ]
    : []),
  acceptance,
  ...(['--customer', '--documents', '--preparation'].includes(process.argv[3])
    ? [
        readFileSync(
          `${root}/scripts/verify-starter-customer-checkout.sql`,
          'utf8'
        ).replace(
          'Synthetic unissued tax note',
          'GST not charged — supplier unregistered.'
        ),
        readFileSync(
          `${root}/scripts/verify-starter-customer-owner-review.sql`,
          'utf8'
        ),
      ]
    : []),
  ...(['--documents', '--preparation'].includes(process.argv[3])
    ? [
        readFileSync(
          `${root}/scripts/verify-starter-subscription-documents.sql`,
          'utf8'
        ),
        readFileSync(
          `${root}/scripts/verify-starter-future-signups.sql`,
          'utf8'
        ),
      ]
    : []),
  ...(process.argv[3] === '--preparation'
    ? [
        readFileSync(
          `${root}/scripts/verify-starter-signup-preparation.sql`,
          'utf8'
        ),
      ]
    : []),
  'ROLLBACK;',
].join('\n');
const output = sql(input);
for (const line of output
  .split('\n')
  .filter((line) => line.startsWith('PASS:')))
  console.log(line);
if (sql(absent).trim() !== 't')
  throw new Error('Live schema survived rollback');
console.log(
  `PASS: ${baseline.length} Live baseline migrations plus scoped preparation replay rolled back; no Live tables remain`
);
