/** Real local sessions in a disposable clone; no env/cloud/provider I/O. */
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createDisposablePostgres } from './lib/disposable-postgres.mjs';
const container = process.argv[2];
const { args, sql: executeSql } = createDisposablePostgres(container, {
  maxBuffer: 32 * 1024 * 1024,
});
const root = fileURLToPath(new URL('../', import.meta.url));
const clone = `subscription_renewals_${randomUUID().replaceAll('-', '')}`;
const sql = (db, input) => executeSql(input, { database: db }).trim();
const read = (path) => readFileSync(`${root}/${path}`, 'utf8');
const absent =
  "SELECT to_regclass('private.subscription_live_settings') IS NULL;";
assert.equal(sql('postgres', absent), 't');
const baseline = sql(
  'postgres',
  'SELECT (SELECT count(*) FROM public.accounts), (SELECT count(*) FROM auth.users), (SELECT count(*) FROM public.payments), (SELECT count(*) FROM public.payment_mandates);'
);
function session(input) {
  const child = spawn('docker', args(clone), {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let output = '',
    error = '',
    signal;
  const ready = new Promise((resolve) => {
    signal = resolve;
  });
  child.stdout.on('data', (data) => {
    output += data;
    if (output.includes('LOCKED')) signal();
  });
  child.stderr.on('data', (data) => {
    error += data;
  });
  const done = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => {
      signal();
      resolve({ code, output, error });
    });
  });
  child.stdin.end(input);
  return { ready, done };
}
const id = (prefix, i) =>
  `${prefix}000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
const owner = 'e6000000-0000-4000-8000-000000000001';
const service = `SET LOCAL ROLE service_role; SET LOCAL request.jwt.claims='{"role":"service_role"}';`;
const authenticated = `SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claims='{"sub":"${owner}","role":"authenticated"}';`;
const quote = (i, req = id('f8', i)) =>
  `SELECT public.subscription_create_live_renewal_quote('${req}','${id('f1', i)}','${id('f2', i)}','${owner}','${id('f3', i)}',79900,'starter','acc_TCJwBqanN9LTrK','${id('f5', i)}');`;
const claim = (i) =>
  `SELECT public.subscription_claim_live_order('${id('f8', i)}','${id('f1', i)}','${owner}','acc_TCJwBqanN9LTrK')->>'action';`;
const cancel = (i) =>
  `SELECT public.subscription_cancel_live_renewal('${id('f1', i)}','${id('f5', i)}');`;
let created = false;
try {
  const dump = execFileSync(
    'docker',
    [
      'exec',
      container,
      'pg_dump',
      '-U',
      'postgres',
      '-d',
      'postgres',
      '--exclude-extension=pg_cron',
      '--exclude-schema=cron',
    ],
    { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }
  );
  sql('postgres', `CREATE DATABASE ${clone};`);
  created = true;
  execFileSync('docker', args(clone, 'supabase_admin'), {
    input: dump,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  const sources = [
    ...readdirSync(`${root}/supabase/migrations`)
      .filter((n) => /^\d+_subscription_live_.*\.sql$/.test(n))
      .sort(),
    '20260930164040_starter_live_pilot_opening_preparation.sql',
    '20261002080000_starter_customer_checkout_scope.sql',
    '20261002111500_starter_customer_owner_review.sql',
    '20261002132000_starter_live_capability_activation.sql',
    '20261002170000_starter_live_customer_renewals.sql',
  ];
  sql(
    clone,
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
      read('scripts/verify-starter-live-renewals.sql').split(
        '-- CUSTOMER_RENEWAL_RACE_SEED'
      )[0],
      'COMMIT;',
    ].join('\n')
  );
  const first = session(
    `BEGIN; ${service} ${quote(1)} SELECT 'LOCKED'; SELECT pg_sleep(1); COMMIT;`
  );
  await first.ready;
  const second = session(
    `BEGIN; SET LOCAL lock_timeout='5s'; ${service} ${quote(1, id('fa', 1))} COMMIT;`
  );
  assert.equal((await first.done).code, 0);
  const overlap = await second.done;
  assert.notEqual(overlap.code, 0);
  assert.match(overlap.error, /Existing renewal needs review/);
  console.log(
    'PASS: overlapping customer quotes serialize to one immutable quote'
  );
  for (const i of [3, 4, 5]) {
    sql(
      clone,
      `BEGIN; ${service} ${quote(i)} RESET ROLE; ${authenticated}
    SELECT public.subscription_acknowledge_live_starter_reminders('${id('f8', i)}'); COMMIT;`
    );
  }
  const order1 = session(
    `BEGIN; ${service} ${claim(3)} SELECT 'LOCKED'; SELECT pg_sleep(1); COMMIT;`
  );
  await order1.ready;
  const order2 = session(
    `BEGIN; SET LOCAL lock_timeout='5s'; ${service} ${claim(3)} COMMIT;`
  );
  const r1 = await order1.done,
    r2 = await order2.done;
  assert.equal(r1.code, 0);
  assert.equal(r2.code, 0);
  assert.match(r1.output, /create/);
  assert.equal(r2.output.trim(), 'recovery');
  console.log(
    'PASS: concurrent customer Checkout claims authorize one POST and one GET recovery'
  );
  const captures = new Map();
  for (const i of [4, 5]) {
    const at = sql(
      clone,
      `BEGIN; ${service} ${claim(i)} SELECT public.subscription_bind_live_order('${id('f8', i)}','order_RaceRenewal${i}','acc_TCJwBqanN9LTrK','${id('f1', i)}'); SELECT clock_timestamp(); COMMIT;`
    )
      .split('\n')
      .at(-1);
    captures.set(i, at);
    sql(
      clone,
      `BEGIN; ${service} SELECT public.subscription_record_live_webhook_event('acc_TCJwBqanN9LTrK','${id('f1', i)}','evt_RaceRenewal${i}','payment.captured','order_RaceRenewal${i}','pay_RaceRenewal${i}',NULL,repeat('b',64),'${at}'); COMMIT;`
    );
  }
  const settle = (i) =>
    `SELECT public.subscription_commit_live_initial_payment('${id('f8', i)}','order_RaceRenewal${i}','pay_RaceRenewal${i}','acc_TCJwBqanN9LTrK',79900,'INR','${captures.get(i)}')->>'status';`;
  const canceller = session(
    `BEGIN; ${authenticated} ${cancel(4)} SELECT 'LOCKED'; SELECT pg_sleep(1); COMMIT;`
  );
  await canceller.ready;
  const held = session(`BEGIN; ${service} ${settle(4)} COMMIT;`);
  assert.equal((await canceller.done).code, 0);
  const h = await held.done;
  assert.equal(h.code, 0);
  assert.equal(h.output.trim(), 'review_required');
  const capture = session(
    `BEGIN; ${service} ${settle(5)} SELECT 'LOCKED'; SELECT pg_sleep(1); COMMIT;`
  );
  await capture.ready;
  const staleCancel = session(`BEGIN; ${authenticated} ${cancel(5)} COMMIT;`);
  assert.equal((await capture.done).code, 0);
  const c = await staleCancel.done;
  assert.notEqual(c.code, 0);
  assert.match(c.error, /Paid term changed/);
  console.log(
    'PASS: both capture/cancellation orderings preserve paid access and exactly-once term history'
  );
  const shutdown =
    session(`BEGIN; SELECT 1 FROM public.organizations WHERE id='${id('f1', 6)}' FOR UPDATE;
  UPDATE private.subscription_live_customer_scopes SET renewals_enabled=false WHERE organization_id='${id('f1', 6)}'; SELECT 'LOCKED'; SELECT pg_sleep(1); COMMIT;`);
  await shutdown.ready;
  const stopped = session(`BEGIN; ${service} ${quote(6)} COMMIT;`);
  assert.equal((await shutdown.done).code, 0);
  const s = await stopped.done;
  assert.notEqual(s.code, 0);
  assert.match(s.error, /Live renewal is disabled/);
  console.log(
    'PASS: quote waiting on the organization lock sees renewal shutdown'
  );
} finally {
  if (created) sql('postgres', `DROP DATABASE ${clone} WITH (FORCE);`);
  assert.equal(sql('postgres', absent), 't');
  assert.equal(
    sql(
      'postgres',
      'SELECT (SELECT count(*) FROM public.accounts), (SELECT count(*) FROM auth.users), (SELECT count(*) FROM public.payments), (SELECT count(*) FROM public.payment_mandates);'
    ),
    baseline
  );
  console.log(
    'PASS: disposable clone removed; source billing schema, tenants and gym payment/mandate counts unchanged'
  );
}
