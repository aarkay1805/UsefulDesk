/** Local disposable clone only: real sessions test issuance races. No .env/provider/cloud. */
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const container = process.argv[2];
if (
  !/^supabase_db_usefuldesk-subscription-full-[a-z0-9]+$/.test(container ?? '')
)
  throw new Error('Pass an explicit disposable local full-schema container');
const root = fileURLToPath(new URL('../', import.meta.url));
const clone = `subscription_documents_${randomUUID().replaceAll('-', '')}`;
const args = (db) => [
  'exec',
  '-i',
  container,
  'psql',
  '-X',
  '-U',
  'postgres',
  '-d',
  db,
  '-Atq',
  '-v',
  'ON_ERROR_STOP=1',
];
const sql = (db, input) =>
  execFileSync('docker', args(db), {
    input,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  }).trim();
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
      resolve({ code, output: output.trim(), error });
    });
  });
  child.stdin.end(input);
  return { ready, done };
}
const read = (path) => readFileSync(`${root}/${path}`, 'utf8');
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
  const restoreArgs = args(clone);
  restoreArgs[restoreArgs.indexOf('postgres')] = 'supabase_admin';
  execFileSync('docker', restoreArgs, {
    input: dump,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  const migrations = readdirSync(`${root}/supabase/migrations`)
    .filter((name) => /^\d+_subscription_live_.*\.sql$/.test(name))
    .sort();
  sql(
    clone,
    [
      'BEGIN;',
      'SET LOCAL client_min_messages=warning;',
      ...migrations.map((name) => read(`supabase/migrations/${name}`)),
      ...[
        '20260930164040_starter_live_pilot_opening_preparation.sql',
        '20261002080000_starter_customer_checkout_scope.sql',
        '20261002111500_starter_customer_owner_review.sql',
        '20261002124500_starter_subscription_documents.sql',
        '20261002132000_starter_live_capability_activation.sql',
      ].map((name) => read(`supabase/migrations/${name}`)),
      read('scripts/verify-starter-live-pilot-opening.sql').replace(
        '-- STARTER_PILOT_CAPABILITY_ACCEPTANCE',
        read('scripts/verify-starter-live-pilot-capabilities.sql')
      ),
      read('scripts/verify-starter-customer-checkout.sql').replace(
        'Synthetic unissued tax note',
        'GST not charged — supplier unregistered.'
      ),
      read('scripts/verify-starter-subscription-documents.sql').split(
        'CREATE TEMP TABLE document_preservation'
      )[0],
      'COMMIT;',
    ].join('\n')
  );
  const service = `SET LOCAL ROLE service_role; SET LOCAL request.jwt.claims='{"role":"service_role"}';`;
  const request = 'e5000000-0000-4000-8000-000000000001';
  const org = 'e1000000-0000-4000-8000-000000000001';
  const issuer =
    '{"name":"UsefulMade","address":"Synthetic supplier address","email":"contact@usefulmade.com","review_reference":"synthetic-supplier-review"}';
  const snapshot = sql(
    clone,
    `BEGIN; ${service} SELECT public.subscription_preview_live_document_issue('${request}','${issuer}'::JSONB); COMMIT;`
  );
  const issue = `SELECT public.subscription_issue_live_document_pair('${request}','${snapshot.replaceAll("'", "''")}'::JSONB,
    encode(convert_to('%PDF-1.4'||repeat('x',600)||'%%EOF','UTF8'),'base64'),
    encode(convert_to('%PDF-1.4'||repeat('y',600)||'%%EOF','UTF8'),'base64'),
    'e6000000-0000-4000-8000-000000000002','synthetic-concurrent-review');`;
  // platform_admin_update_access writes access without the financial org lock.
  const change = session(
    `BEGIN; UPDATE private.organization_product_access SET suspended_at=clock_timestamp() WHERE organization_id='${org}'; SELECT 'LOCKED'; SELECT pg_sleep(1); COMMIT;`
  );
  await change.ready;
  const raced = session(
    `BEGIN; SET LOCAL lock_timeout='5s'; ${service} ${issue} COMMIT;`
  );
  assert.equal((await change.done).code, 0);
  const result = await raced.done;
  assert.notEqual(
    result.code,
    0,
    'Issuance accepted stale paid access during concurrent suspension'
  );
  assert.match(
    result.error,
    /Verified customer sale, paid access and exact document review required/
  );
  assert.equal(
    sql(
      clone,
      'SELECT count(*) FROM private.subscription_live_document_issues;'
    ),
    '0'
  );
  console.log(
    'PASS: concurrent access suspension prevents stale paid-access issuance; no number consumed'
  );
  sql(
    clone,
    `UPDATE private.organization_product_access SET suspended_at=NULL WHERE organization_id='${org}';`
  );
  const duplicates = await Promise.all([
    session(`BEGIN; ${service} ${issue} SELECT pg_sleep(0.3); COMMIT;`).done,
    session(`BEGIN; ${service} ${issue} COMMIT;`).done,
  ]);
  assert.ok(
    duplicates.every((r) => r.code === 0),
    JSON.stringify(duplicates)
  );
  assert.deepEqual(
    duplicates.map((r) => JSON.parse(r.output.split('\n')[0]).status).sort(),
    ['already_issued', 'issued']
  );
  assert.equal(
    sql(
      clone,
      'SELECT count(*)=1 AND min(sequence_number)=1 FROM private.subscription_live_document_issues;'
    ),
    't'
  );
  console.log(
    'PASS: concurrent exact retries issue one immutable pair with one sequential number'
  );
  // Both real sessions must count the other's committed active branch. The
  // settings row lock also serializes a create with capability activation.
  const account = 'e2000000-0000-4000-8000-000000000001';
  sql(
    clone,
    `UPDATE private.subscription_billing_settings SET capabilities_enabled=true WHERE singleton;
    UPDATE public.accounts SET branch_status='archived' WHERE organization_id='${org}';`
  );
  const makeBranch = (
    id
  ) => `INSERT INTO public.accounts(id,name,organization_id,owner_user_id,legal_entity_id)
    SELECT '${id}','Synthetic capacity race',organization_id,owner_user_id,legal_entity_id
    FROM public.accounts WHERE id='${account}';`;
  const firstBranch =
    session(`BEGIN; ${makeBranch('e2999999-0000-4000-8000-000000000002')}
    SELECT 'LOCKED'; SELECT pg_sleep(1); COMMIT;`);
  await firstBranch.ready;
  const secondBranch = session(`BEGIN; SET LOCAL lock_timeout='5s';
    ${makeBranch('e2999999-0000-4000-8000-000000000003')} COMMIT;`);
  const firstBranchResult = await firstBranch.done;
  assert.equal(firstBranchResult.code, 0, firstBranchResult.error);
  const rejectedBranch = await secondBranch.done;
  assert.notEqual(rejectedBranch.code, 0);
  assert.match(rejectedBranch.error, /Active branch allowance is full/);
  assert.equal(
    sql(
      clone,
      `SELECT count(*) FROM public.accounts WHERE organization_id='${org}' AND branch_status='active';`
    ),
    '1'
  );
  console.log(
    'PASS: concurrent Starter creates retain exactly one active branch with Test billing closed'
  );
  assert.equal(sql('postgres', absent), 't');
} finally {
  if (created) {
    sql('postgres', `DROP DATABASE ${clone} WITH (FORCE);`);
    assert.equal(
      sql(
        'postgres',
        `SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname='${clone}');`
      ),
      'f'
    );
    console.log('PASS: generated local clone removed; source unchanged');
  }
}
