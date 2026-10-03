/** Explicit local full-schema rollback checks; no env files, cloud or provider I/O. */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createDisposablePostgres } from './lib/disposable-postgres.mjs';
const { sql } = createDisposablePostgres(process.argv[2], { kind: 'full' });
const root = fileURLToPath(new URL('../', import.meta.url));
const read = (path) => readFileSync(`${root}/${path}`, 'utf8');
const absent = `SELECT to_regclass('private.subscription_live_settings') IS NULL
 AND to_regclass('private.subscription_monthly_catalog') IS NULL
 AND to_regclass('private.subscription_monthly_offer_sets') IS NULL
 AND to_regclass('private.subscription_monthly_offers') IS NULL;`;
if (sql(absent).trim() !== 't')
  throw new Error('Expected no installed Live/monthly schema');
const baselineQuery = `SELECT row_to_json(s) FROM private.subscription_billing_settings s;
 SELECT row_to_json(s) FROM private.product_access_settings s;
 SELECT count(*) FROM public.accounts; SELECT count(*) FROM auth.users;
 SELECT md5(coalesce(jsonb_agg(to_jsonb(a) ORDER BY id)::TEXT,'')) FROM public.accounts a;
 SELECT md5(coalesce(jsonb_agg(to_jsonb(x) ORDER BY organization_id)::TEXT,'')) FROM private.organization_product_access x;`;
const before = sql(baselineQuery);
const sources = [
  ...readdirSync(`${root}/supabase/migrations`)
    .filter((n) => /^\d+_subscription_live_.*\.sql$/.test(n))
    .sort(),
  '20260930164040_starter_live_pilot_opening_preparation.sql',
  '20261002080000_starter_customer_checkout_scope.sql',
  '20261002111500_starter_customer_owner_review.sql',
  '20261002124500_starter_subscription_documents.sql',
  '20261002132000_starter_live_capability_activation.sql',
  '20261002140000_starter_future_signup_selection.sql',
  '20261002170000_starter_live_customer_renewals.sql',
  '20261003003000_starter_signup_preparation.sql',
];
const monthlyPath =
  'supabase/migrations/20261003010000_subscription_monthly_first_checkout.sql';
const monthly = read(monthlyPath);
const legacyTables = [
  'subscription_live_offer_approvals',
  'subscription_live_customer_preparations',
  'subscription_live_customer_reviews',
  'subscription_live_quotes',
  'subscription_live_orders',
  'subscription_live_payments',
  'subscription_live_refunds',
  'subscription_live_grants',
  'subscription_live_terms',
  'subscription_live_customer_scopes',
  'subscription_live_settings',
  'subscription_starter_signup_selections',
  'subscription_starter_signup_work',
];
const legacySnapshot = legacyTables
  .map(
    (t) => `CREATE TEMP TABLE before_${t} AS SELECT
 coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::TEXT),'[]'::JSONB) rows FROM private.${t} r;`
  )
  .join('\n');
const legacyCompare = legacyTables
  .map(
    (
      t
    ) => `SELECT pg_temp.assert_true((SELECT rows FROM before_${t}) IS NOT DISTINCT FROM
 (SELECT coalesce(jsonb_agg(to_jsonb(r)-ARRAY['offer_contract_version','catalog_version','monthly_offer_id'] ORDER BY
 (to_jsonb(r)-ARRAY['offer_contract_version','catalog_version','monthly_offer_id'])::TEXT),'[]'::JSONB) FROM private.${t} r),
 'Legacy ${t} fingerprint changed');`
  )
  .join('\n');
const checks = read('scripts/verify-subscription-monthly-first-checkout.sql');
const output = sql(
  [
    'BEGIN; SET LOCAL client_min_messages=warning;',
    ...sources.map((n) => read(`supabase/migrations/${n}`)),
    read('scripts/verify-starter-live-pilot-opening.sql').replace(
      '-- STARTER_PILOT_CAPABILITY_ACCEPTANCE',
      read('scripts/verify-starter-live-pilot-capabilities.sql')
    ),
    read('scripts/verify-starter-customer-checkout.sql').replaceAll(
      'Synthetic unissued tax note',
      'GST not charged — supplier unregistered.'
    ),
    read('scripts/verify-starter-customer-owner-review.sql'),
    read('scripts/verify-starter-subscription-documents.sql'),
    read('scripts/verify-starter-future-signups.sql'),
    read('scripts/verify-starter-signup-preparation.sql'),
    "RESET ROLE; SET LOCAL request.jwt.claims='{}';",
    legacySnapshot,
    monthly,
    checks,
    read('scripts/verify-subscription-monthly-preparation.sql'),
    legacyCompare,
    monthly,
    checks,
    read('scripts/verify-subscription-monthly-preparation.sql'),
    legacyCompare,
    "SELECT 'PASS: both migration applications preserved every legacy column';",
    'ROLLBACK;',
  ].join('\n')
);
for (const line of output.split('\n').filter((l) => l.startsWith('PASS:')))
  console.log(line);
if (sql(absent).trim() !== 't')
  throw new Error('Live/monthly schema survived rollback');
if (sql(baselineQuery) !== before)
  throw new Error('Rollback changed baseline settings/counts/fingerprints');
console.log(
  'PASS: rollback restored baseline settings/counts/fingerprints; no Live/monthly schema installed'
);
