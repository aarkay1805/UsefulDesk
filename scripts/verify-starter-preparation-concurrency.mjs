/** Local disposable clone only: real sessions test preparation/capture races. No .env/provider/cloud. */
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createDisposablePostgres } from './lib/disposable-postgres.mjs';

const container = process.argv[2];
const { args, sql: executeSql } = createDisposablePostgres(container, {
  errorMessage: 'Pass an explicit disposable local full-schema container',
  maxBuffer: 32 * 1024 * 1024,
});
const root = fileURLToPath(new URL('../', import.meta.url));
const clone = `subscription_preparation_${randomUUID().replaceAll('-', '')}`;
const sql = (db, input) => executeSql(input, { database: db }).trim();
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
  const restoreArgs = args(clone, 'supabase_admin');
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
        '20261002140000_starter_future_signup_selection.sql',
        '20261002170000_starter_live_customer_renewals.sql',
        '20261003003000_starter_signup_preparation.sql',
      ].map((name) => read(`supabase/migrations/${name}`)),
      read('scripts/verify-starter-live-pilot-opening.sql').replace(
        '-- STARTER_PILOT_CAPABILITY_ACCEPTANCE',
        read('scripts/verify-starter-live-pilot-capabilities.sql')
      ),
      read('scripts/verify-starter-customer-checkout.sql').replace(
        'Synthetic unissued tax note',
        'GST not charged — supplier unregistered.'
      ),
      read('scripts/verify-starter-customer-owner-review.sql'),
      read('scripts/verify-starter-subscription-documents.sql'),
      read('scripts/verify-starter-future-signups.sql'),
      read('scripts/verify-starter-signup-preparation.sql').split(
        'SAVEPOINT prepared_active_trial;'
      )[0],
      'COMMIT;',
    ].join('\n')
  );
  const org = 'b1000000-0000-4000-8000-000000000001';
  const account = 'b2000000-0000-4000-8000-000000000001';
  const request = 'b5000000-0000-4000-8000-000000000001';
  const owner = 'e6000000-0000-4000-8000-000000000001';
  const operator = 'e6000000-0000-4000-8000-000000000002';
  const admin = `SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claims='{"sub":"${operator}","role":"authenticated","aal":"aal2"}';`;
  const service = `SET LOCAL ROLE service_role; SET LOCAL request.jwt.claims='{"role":"service_role"}';`;
  // Supply the same bounded snapshot/evidence to both genuine authenticated sessions.
  const savedInput = sql(
    clone,
    `SELECT jsonb_build_object('snapshot',private.subscription_starter_signup_context('${org}')->>'snapshot_token',
    'evidence',evidence) FROM private.subscription_starter_signup_work WHERE organization_id='${org}';`
  );
  const input = JSON.parse(savedInput);
  const escapedEvidence = JSON.stringify(input.evidence).replaceAll("'", "''");
  const simultaneousSave = `SELECT public.platform_admin_save_starter_signup_work('${org}',2,'${input.snapshot}','${operator}','in_review',
    'Review actual changed facts','${escapedEvidence}'::JSONB);`;
  const saves = await Promise.all([
    session(`BEGIN; ${admin} ${simultaneousSave} SELECT pg_sleep(0.2); COMMIT;`)
      .done,
    session(`BEGIN; ${admin} ${simultaneousSave} COMMIT;`).done,
  ]);
  assert.equal(
    saves.filter((r) => r.code === 0).length,
    1,
    JSON.stringify(saves)
  );
  assert.match(saves.find((r) => r.code !== 0).error, /Preparation changed/);
  assert.equal(
    sql(
      clone,
      `SELECT revision FROM private.subscription_starter_signup_work WHERE organization_id='${org}';`
    ),
    '3'
  );
  console.log(
    'PASS: concurrent draft saves retain one reviewed revision and reject a stale writer'
  );
  // Inverse ordering: billing owns the org while the actual authenticated
  // invoice upsert owns account/legal tuples and waits for the org.
  const organizationFirst =
    session(`BEGIN; SELECT 1 FROM public.organizations WHERE id='${org}' FOR UPDATE;
    SELECT 'LOCKED'; SELECT pg_sleep(0.8); SELECT private.subscription_lock_starter_preparation_sources('${org}'); COMMIT;`);
  await organizationFirst.ready;
  const sourceSecond =
    session(`BEGIN; SET LOCAL application_name='preparation_inverse_writer';
    SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claims='{"sub":"${owner}","role":"authenticated"}';
    SET LOCAL request.headers='{"x-usefuldesk-account-id":"${account}"}';
    SELECT public.save_invoice_profile('${account}','Synthetic brand','Synthetic actual legal name','Synthetic street',NULL,'Synthetic city','Synthetic state','100001','IN','+919000000001','synthetic@example.invalid'); COMMIT;`);
  let waiting = false;
  for (let attempt = 0; attempt < 10; attempt++) {
    waiting =
      sql(
        clone,
        "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND application_name='preparation_inverse_writer' AND wait_event_type='Lock');"
      ) === 't';
    if (waiting) break;
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  if (!waiting)
    throw new Error(
      `Actual invoice upsert did not wait: ${JSON.stringify(await Promise.all([organizationFirst.done, sourceSecond.done]))}`
    );
  const inverse = await Promise.all([
    organizationFirst.done,
    sourceSecond.done,
  ]);
  assert.equal(inverse[1].code, 0, JSON.stringify(inverse));
  assert.notEqual(inverse[0].code, 0, JSON.stringify(inverse));
  assert.match(
    inverse[0].error,
    /Prepared facts are being edited. Refresh and try again./
  );
  sql(
    clone,
    `BEGIN; SELECT private.subscription_lock_starter_preparation_sources('${org}'); COMMIT;`
  );
  console.log(
    'PASS: authenticated invoice upsert and billing retry finish without a tuple/organization deadlock'
  );
  const freezes = await Promise.all([
    session(
      `BEGIN; ${admin} SELECT public.platform_admin_freeze_starter_signup_preparation('${org}',3,TRUE); SELECT pg_sleep(0.2); COMMIT;`
    ).done,
    session(
      `BEGIN; ${admin} SELECT public.platform_admin_freeze_starter_signup_preparation('${org}',3,TRUE); COMMIT;`
    ).done,
  ]);
  assert.ok(
    freezes.every((r) => r.code === 0),
    JSON.stringify(freezes)
  );
  assert.equal(
    JSON.parse(freezes[0].output.split('\n')[0]).preparation_id,
    JSON.parse(freezes[1].output.split('\n')[0]).preparation_id
  );
  assert.equal(
    sql(
      clone,
      `SELECT count(*)=1 AND bool_and(NOT opening_enabled) FROM private.subscription_live_customer_preparations WHERE organization_id='${org}';`
    ),
    't'
  );
  console.log(
    'PASS: concurrent freezes produce one exact offer and one closed preparation'
  );
  const captureFixture = read('scripts/verify-starter-signup-preparation.sql')
    .split('-- PREPARATION_CAPTURE_ACCEPTANCE')[0]
    .replaceAll(
      'b1000000-0000-4000-8000-000000000001',
      'b1000000-0000-4000-8000-000000000002'
    )
    .replaceAll(
      'b2000000-0000-4000-8000-000000000001',
      'b2000000-0000-4000-8000-000000000002'
    )
    .replaceAll(
      'b3000000-0000-4000-8000-000000000001',
      'b3000000-0000-4000-8000-000000000002'
    )
    .replaceAll(
      'b5000000-0000-4000-8000-000000000001',
      'b5000000-0000-4000-8000-000000000002'
    )
    .replaceAll(
      'b7000000-0000-4000-8000-000000000001',
      'b7000000-0000-4000-8000-000000000002'
    )
    .replaceAll(
      'b8000000-0000-4000-8000-000000000001',
      'b8000000-0000-4000-8000-000000000002'
    );
  sql(
    clone,
    `BEGIN;
    UPDATE private.subscription_starter_signup_policies SET enabled=false;
    CREATE FUNCTION pg_temp.assert_true(v BOOLEAN,m TEXT) RETURNS VOID LANGUAGE plpgsql AS $$BEGIN IF v IS DISTINCT FROM TRUE THEN RAISE EXCEPTION '%',m; END IF; END;$$;
    CREATE FUNCTION pg_temp.expect_error(q TEXT,c TEXT) RETURNS VOID LANGUAGE plpgsql AS $$BEGIN EXECUTE q; RAISE EXCEPTION 'Expected error %',c; EXCEPTION WHEN OTHERS THEN IF SQLSTATE<>c THEN RAISE; END IF; END;$$;
    ${captureFixture} COMMIT;`
  );
  const captureOrg = org.replace(/1$/, '2');
  const captureAccount = account.replace(/1$/, '2');
  const captureRequest = request.replace(/1$/, '2');
  sql(
    clone,
    `BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claims='{"sub":"${owner}","role":"authenticated"}';
    SELECT public.subscription_acknowledge_live_starter_reminders('${captureRequest}');
    RESET ROLE; ${service}
    SELECT public.subscription_claim_live_order('${captureRequest}','${captureOrg}','${owner}','acc_TCJwBqanN9LTrK');
    SELECT public.subscription_bind_live_order('${captureRequest}','order_PreparationRace','acc_TCJwBqanN9LTrK','${captureOrg}');
    COMMIT;`
  );
  const capturedAt = sql(clone, 'SELECT clock_timestamp();');
  sql(
    clone,
    `BEGIN; ${service} SELECT public.subscription_record_live_webhook_event('acc_TCJwBqanN9LTrK','${captureOrg}',
    'evt_PreparationRace','payment.captured','order_PreparationRace','pay_PreparationRace',NULL,repeat('b',64),'${capturedAt}'); COMMIT;`
  );
  const capture = `SELECT public.subscription_commit_live_initial_payment('${captureRequest}','order_PreparationRace','pay_PreparationRace',
    'acc_TCJwBqanN9LTrK',79900,'INR','${capturedAt}');`;
  const buyerChange =
    session(`BEGIN; UPDATE public.invoice_profiles SET city='Concurrent changed city' WHERE account_id='${captureAccount}';
    SELECT 'LOCKED'; SELECT pg_sleep(0.7); COMMIT;`);
  await buyerChange.ready;
  const raced = session(
    `BEGIN; SET LOCAL lock_timeout='5s'; ${service} ${capture} COMMIT;`
  );
  assert.equal((await buyerChange.done).code, 0);
  const racedResult = await raced.done;
  assert.ok(
    racedResult.code !== 0 ||
      JSON.parse(racedResult.output.split('\n')[0]).status ===
        'review_required',
    'Concurrent changed buyer was granted verified paid access'
  );
  const retry = JSON.parse(
    sql(clone, `BEGIN; ${service} ${capture} COMMIT;`).split('\n')[0]
  );
  assert.equal(retry.status, 'review_required');
  assert.equal(
    sql(
      clone,
      `SELECT NOT EXISTS(SELECT 1 FROM private.subscription_live_grants WHERE organization_id='${captureOrg}')
    AND NOT EXISTS(SELECT 1 FROM private.subscription_live_payments WHERE organization_id='${captureOrg}' AND state='verified');`
    ),
    't'
  );
  assert.equal(
    sql(
      clone,
      `SELECT count(*) FROM private.subscription_live_webhook_events WHERE request_id='${captureRequest}';`
    ),
    '1'
  );
  console.log(
    'PASS: concurrent buyer edits preserve durable signed intake and hold capture without granting paid access'
  );
  // Actual document issuance uses the existing org-then-profile lock order.
  let documentFixture = read('scripts/verify-starter-signup-preparation.sql')
    .split("UPDATE public.invoice_profiles SET city='Changed after payment'")[0]
    .replace(
      'Synthetic customer tax treatment',
      'GST not charged — supplier unregistered.'
    );
  for (let prefix = 1; prefix <= 9; prefix++)
    documentFixture = documentFixture.replaceAll(
      `b${prefix}000000-0000-4000-8000-000000000001`,
      `b${prefix}000000-0000-4000-8000-000000000003`
    );
  sql(
    clone,
    `BEGIN; UPDATE private.subscription_starter_signup_policies SET enabled=false;
    CREATE FUNCTION pg_temp.assert_true(v BOOLEAN,m TEXT) RETURNS VOID LANGUAGE plpgsql AS $$BEGIN IF v IS DISTINCT FROM TRUE THEN RAISE EXCEPTION '%',m; END IF; END;$$;
    CREATE FUNCTION pg_temp.expect_error(q TEXT,c TEXT) RETURNS VOID LANGUAGE plpgsql AS $$BEGIN EXECUTE q; RAISE EXCEPTION 'Expected error %',c; EXCEPTION WHEN OTHERS THEN IF SQLSTATE<>c THEN RAISE; END IF; END;$$;
    ${documentFixture} COMMIT;`
  );
  const documentOrg = org.replace(/1$/, '3');
  const documentAccount = account.replace(/1$/, '3');
  const documentRequest = request.replace(/1$/, '3');
  const issuer = JSON.stringify({
    name: 'UsefulMade',
    email: 'contact@usefulmade.com',
    address: 'Synthetic supplier address',
    review_reference: 'synthetic reviewed supplier',
  });
  const documentSnapshot = sql(
    clone,
    `BEGIN; ${service} SELECT public.subscription_preview_live_document_issue('${documentRequest}','${issuer}'::JSONB); COMMIT;`
  );
  const issue = `SELECT public.subscription_issue_live_document_pair('${documentRequest}','${documentSnapshot.replaceAll("'", "''")}'::JSONB,
    encode(convert_to('%PDF-1.4'||repeat('x',600)||'%%EOF','UTF8'),'base64'),
    encode(convert_to('%PDF-1.4'||repeat('y',600)||'%%EOF','UTF8'),'base64'),'${operator}','synthetic inverse-order documents');`;
  const issuanceFirst =
    session(`BEGIN; SELECT 1 FROM public.organizations WHERE id='${documentOrg}' FOR NO KEY UPDATE;
    SELECT 'LOCKED'; SELECT pg_sleep(0.7); ${service} ${issue} COMMIT;`);
  await issuanceFirst.ready;
  const profileSecond = session(
    `BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claims='{"sub":"${owner}","role":"authenticated"}';
    SET LOCAL request.headers='{"x-usefuldesk-account-id":"${documentAccount}"}';
    SELECT public.save_invoice_profile('${documentAccount}','Synthetic brand','Synthetic actual legal name','Synthetic street',NULL,'Synthetic city','Synthetic state','100001','IN','+919000000001','synthetic@example.invalid'); COMMIT;`
  );
  const documentResults = await Promise.all([
    issuanceFirst.done,
    profileSecond.done,
  ]);
  assert.ok(
    documentResults.every((r) => r.code === 0),
    JSON.stringify(documentResults)
  );
  assert.equal(
    sql(
      clone,
      `SELECT count(*) FROM private.subscription_live_document_issues WHERE request_id='${documentRequest}';`
    ),
    '1'
  );
  console.log(
    'PASS: genuine document issuance and inverse-order buyer edit finish without deadlock or duplicate issuance'
  );
} finally {
  if (created) sql('postgres', `DROP DATABASE ${clone} WITH (FORCE);`);
}
assert.equal(sql('postgres', absent), 't');
console.log(
  'PASS: disposable clone removed; source database remains unchanged'
);
