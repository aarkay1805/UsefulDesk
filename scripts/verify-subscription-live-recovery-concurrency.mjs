/** Explicit local-only proof in an agent-created database clone. The source is
 * read-only; synthetic setup/leases are transient, then the clone is dropped.
 * Never reads .env, contacts a provider, or addresses a cloud database.
 */
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createDisposablePostgres } from './lib/disposable-postgres.mjs';

const container = process.argv[2];
const { args, sql: executeSql } = createDisposablePostgres(container, {
  errorMessage: 'Pass the explicit disposable local full-schema container',
  maxBuffer: 32 * 1024 * 1024,
});
const root = fileURLToPath(new URL('../', import.meta.url));
const clone = `subscription_recovery_${randomUUID().replaceAll('-', '')}`;
const sql = (db, input) => executeSql(input, { database: db }).trim();
const run = (input) =>
  new Promise((resolve, reject) => {
    const child = spawn('docker', args(clone), {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let output = '',
      error = '';
    child.stdout.on('data', (data) => (output += data));
    child.stderr.on('data', (data) => (error += data));
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve(output.trim()) : reject(new Error(error))
    );
    child.stdin.end(input);
  });
const absent =
  "SELECT to_regclass('private.subscription_live_settings') IS NULL;";
assert.equal(sql('postgres', absent), 't');
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
  const restoreArgs = args(clone, 'supabase_admin');
  execFileSync('docker', restoreArgs, {
    input: dump,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  const baseline = readdirSync(`${root}/supabase/migrations`)
    .filter(
      (name) =>
        /^\d+_subscription_live_.*\.sql$/.test(name) &&
        !name.includes('subscription_live_recovery_queue')
    )
    .sort();
  const preparation = readFileSync(
    `${root}/supabase/migrations/20260930164040_starter_live_pilot_opening_preparation.sql`,
    'utf8'
  );
  const recovery = readFileSync(
    `${root}/supabase/migrations/20260930180000_subscription_live_recovery_queue.sql`,
    'utf8'
  );
  const fixture = readFileSync(
    `${root}/scripts/verify-starter-live-pilot-opening.sql`,
    'utf8'
  );
  const prefix = fixture.slice(
    0,
    fixture.indexOf(
      "SELECT public.subscription_bind_live_order('d9999999-9999-4999-8999-999999999999'"
    )
  );
  sql(
    clone,
    [
      'BEGIN;',
      'SET LOCAL client_min_messages=warning;',
      ...baseline.map((name) =>
        readFileSync(`${root}/supabase/migrations/${name}`, 'utf8')
      ),
      preparation,
      recovery,
      prefix,
      'RESET ROLE;',
      'COMMIT;',
    ].join('\n')
  );
  const tokens = [randomUUID(), randomUUID()];
  const results = await Promise.all(
    tokens.map((token) =>
      run(`BEGIN;
    SET LOCAL lock_timeout='5s'; SET LOCAL ROLE service_role;
    SET LOCAL request.jwt.claims='{"role":"service_role"}';
    SELECT jsonb_array_length(public.subscription_claim_live_recovery_items(
      'acc_TCJwBqanN9LTrK','8826d9aa-03f2-4ad7-ae91-0553052131f8',1,'${token}'));
    SELECT pg_sleep(0.3); COMMIT;`)
    )
  );
  assert.deepEqual(results.map((value) => value.split('\n')[0]).sort(), [
    '0',
    '1',
  ]);
  assert.equal(
    sql(
      clone,
      'SELECT attempts=1 AND lease_token IS NOT NULL FROM private.subscription_live_recovery_queue;'
    ),
    't'
  );
  assert.equal(
    sql(clone, 'SELECT count(*) FROM private.subscription_live_payments;'),
    '0'
  );
  assert.equal(
    sql(clone, 'SELECT count(*) FROM private.subscription_live_grants;'),
    '0'
  );
  assert.equal(sql('postgres', absent), 't');
  console.log(
    'PASS: two real concurrent sessions claim one original obligation exactly once; zero money/access facts; shared source unchanged'
  );
} finally {
  if (created) {
    // Only this generated local clone is eligible for destructive cleanup.
    sql('postgres', `DROP DATABASE ${clone} WITH (FORCE);`);
    assert.equal(
      sql(
        'postgres',
        `SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname='${clone}');`
      ),
      'f'
    );
    console.log('PASS: agent-created synthetic local clone removed');
  }
}
