/** Explicit local-only rollback acceptance; no .env, cloud or provider access. */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
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
  .filter(
    (name) =>
      /^\d+_subscription_live_.*\.sql$/.test(name) &&
      !name.includes('subscription_live_recovery_queue')
  )
  .sort();
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
const recovery = readFileSync(
  `${root}/supabase/migrations/20260930180000_subscription_live_recovery_queue.sql`,
  'utf8'
);
const capabilities = readFileSync(
  `${root}/supabase/migrations/20261002132000_starter_live_capability_activation.sql`,
  'utf8'
);
const orderFixture = readFileSync(
  `${root}/scripts/verify-subscription-live-recovery-orders.sql`,
  'utf8'
);
const holdFixture = readFileSync(
  `${root}/scripts/verify-subscription-live-recovery-holds.sql`,
  'utf8'
);
const refundFixture = readFileSync(
  `${root}/scripts/verify-subscription-live-recovery-refunds.sql`,
  'utf8'
);
const captureGuards = readFileSync(
  `${root}/scripts/verify-subscription-live-recovery-capture-guards.sql`,
  'utf8'
);
const recoveryAcceptance = acceptance
  .replace(
    'SAVEPOINT capture_after_shutdown;',
    captureGuards + '\nSAVEPOINT capture_after_shutdown;'
  )
  .replace(
    "SELECT public.subscription_bind_live_order('d9999999-9999-4999-8999-999999999999'",
    orderFixture +
      "\nSELECT public.subscription_bind_live_order('d9999999-9999-4999-8999-999999999999'"
  )
  .replace(
    'ROLLBACK TO capture_after_shutdown;',
    holdFixture + '\nROLLBACK TO capture_after_shutdown;'
  )
  .replace(
    "SELECT public.subscription_observe_live_refund('d6666666-6666-4666-8666-666666666666'",
    refundFixture +
      "\nSELECT public.subscription_observe_live_refund('d6666666-6666-4666-8666-666666666666'"
  );
const migration = readFileSync(
  `${root}/supabase/migrations/${preparation}`,
  'utf8'
);
const fixtureOutput = process.argv[3]?.startsWith('--emit-fixture=')
  ? process.argv[3].slice('--emit-fixture='.length)
  : null;
if (fixtureOutput) {
  if (!fixtureOutput.startsWith('/'))
    throw new Error('Fixture output must be an absolute path');
  const fixture = [
    'BEGIN;',
    'SET LOCAL client_min_messages=warning;',
    recoveryAcceptance,
    'ROLLBACK;',
  ]
    .join('\n')
    .replace(/^\\.*$/gm, '');
  writeFileSync(fixtureOutput, fixture);
  console.log(`Fixture: ${fixtureOutput}`);
  console.log(
    `Fixture SHA256: ${createHash('sha256').update(fixture).digest('hex')}`
  );
  console.log(
    `Recovery migration SHA256: ${createHash('sha256').update(recovery).digest('hex')}`
  );
  process.exit(0);
}
const input = [
  'BEGIN;',
  'SET LOCAL client_min_messages=warning;',
  ...baseline.map((name) =>
    readFileSync(`${root}/supabase/migrations/${name}`, 'utf8')
  ),
  migration,
  migration, // Idempotency: same preparation source twice before fixtures.
  recovery,
  recovery, // Recovery migration replay must preserve grants and reason evidence.
  capabilities,
  capabilities, // Match the current branch-limit fixture and check replay.
  recoveryAcceptance,
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
  `PASS: ${baseline.length} Live baseline migrations plus scoped preparation, recovery and current capability replay rolled back; no Live tables remain`
);
