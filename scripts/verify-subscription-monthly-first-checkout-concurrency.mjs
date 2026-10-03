/** Independent, bounded local PostgreSQL sessions. Synthetic evidence; no provider I/O. */
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createDisposablePostgres } from './lib/disposable-postgres.mjs';
const container = process.argv[2];
const { args, sql: execute } = createDisposablePostgres(container, {
  maxBuffer: 64 * 1024 * 1024,
});
assert.ok(
  process.argv.length === 3 ||
    (process.argv.length === 4 && process.argv[3] === '--without-monthly'),
  'Only --without-monthly is supported'
);
const omitMonthly = process.argv[3] === '--without-monthly';
const root = fileURLToPath(new URL('../', import.meta.url));
const read = (path) => readFileSync(`${root}/${path}`, 'utf8');
const clone = `subscription_monthly_${randomUUID().replaceAll('-', '')}`;
const sql = (input, db = clone) => execute(input, { database: db }).trim();
const monthly = read(
  'supabase/migrations/20261003010000_subscription_monthly_first_checkout.sql'
);
const absent =
  "SELECT to_regclass('private.subscription_live_settings') IS NULL AND to_regclass('private.subscription_monthly_catalog') IS NULL;";
// Whole-row source data fingerprints cover every non-system application table,
// including gym payment, mandate and document rows, settings, roles and Auth.
const fingerprint = `CREATE TEMP TABLE fixture_fingerprint(name TEXT, hash TEXT);
DO $$ DECLARE r RECORD; BEGIN FOR r IN SELECT schemaname,tablename FROM pg_tables WHERE schemaname IN ('public','private','auth') ORDER BY 1,2 LOOP
 EXECUTE format('INSERT INTO fixture_fingerprint SELECT %L,md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::TEXT)::TEXT,''[]'')) FROM %I.%I t',r.schemaname||'.'||r.tablename,r.schemaname,r.tablename);
END LOOP; END $$;
SELECT name||':'||hash FROM fixture_fingerprint ORDER BY name;`;
assert.equal(
  sql(absent, 'postgres'),
  't',
  'Expected full baseline without Live/monthly schema'
);
const before = sql(fingerprint, 'postgres');
const owner = 'e6000000-0000-4000-8000-000000000001';
const operator = 'e6000000-0000-4000-8000-000000000002';
const merchant = 'acc_TCJwBqanN9LTrK';
const service = `SET LOCAL ROLE service_role; SET LOCAL request.jwt.claims='{"role":"service_role"}';`;
const auth = (who = owner, aal = false) =>
  `SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claims='{"sub":"${who}","role":"authenticated"${aal ? ',"aal":"aal2"' : ''}}';`;
const txn = (role, body) => `BEGIN; ${role} ${body} COMMIT;`;
const active = new Set();
let serial = 0;
function session(input, hold = false) {
  const name = `monthly_race_${++serial}`;
  const child = spawn('docker', args(clone), {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  active.add(child);
  let output = '',
    error = '',
    finished = false,
    signal;
  const ready = new Promise((resolve) => {
    signal = resolve;
  });
  const timer = setTimeout(() => child.kill('SIGTERM'), 15000);
  const done = new Promise((resolve) => {
    child.stdout.on('data', (data) => {
      output += data;
      if (output.includes('LOCKED')) signal();
    });
    child.stderr.on('data', (data) => {
      error += data;
    });
    child.on('error', (cause) => {
      error += cause.message;
    });
    child.on('close', (code) => {
      finished = true;
      clearTimeout(timer);
      active.delete(child);
      signal();
      resolve({ code, output: output.trim(), error });
    });
  });
  child.stdin.write(
    `\\set VERBOSITY verbose\nSET statement_timeout='8s'; SET lock_timeout='5s'; SET idle_in_transaction_session_timeout='10s'; SET application_name='${name}';\n${input}\n`
  );
  if (hold) child.stdin.write("SELECT 'LOCKED';\n");
  else child.stdin.end();
  return {
    ready,
    done,
    name,
    get finished() {
      return finished;
    },
    release: (end = 'COMMIT;') => child.stdin.end(`${end}\n`),
  };
}
const ok = (r) => {
  assert.equal(r.code, 0, JSON.stringify(r));
  return r;
};
const retry = (r) => {
  assert.notEqual(r.code, 0, JSON.stringify(r));
  assert.match(r.error, /40001/, JSON.stringify(r));
};
async function overlap(first, second, { end = 'COMMIT;', afterWait } = {}) {
  const a = session(first, true);
  await a.ready;
  assert.ok(
    !a.finished,
    JSON.stringify(await (a.finished ? a.done : Promise.resolve({})))
  );
  const b = session(second);
  let blocked = false;
  try {
    for (let i = 0; i < 80 && !b.finished; i++) {
      blocked =
        sql(
          `SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND application_name='${b.name}' AND wait_event_type='Lock');`
        ) === 't';
      if (blocked) break;
      await new Promise((resolve) => setTimeout(resolve, 15));
    }
    assert.ok(
      blocked || b.finished,
      'Contender neither completed nor demonstrably waited'
    );
    if (afterWait) await afterWait(blocked);
  } finally {
    a.release(end);
  }
  return [await a.done, await b.done, blocked];
}
const result = (r) => JSON.parse(ok(r).output.split('\n')[0]);
let created = false,
  fixtureSerial = 0,
  orderCreates = 0,
  refundCreates = 0;
const mockCreates = new Set();
function mockCreate(kind, request) {
  assert.equal(
    mockCreates.has(`${kind}:${request}`),
    false,
    'A request authorized a second provider create'
  );
  mockCreates.add(`${kind}:${request}`);
  if (kind === 'order') orderCreates++;
  else refundCreates++;
}
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
function seed(tier = 'ultimate') {
  const n = ++fixtureSerial;
  const remap = (s) =>
    s.replace(
      /c([1279])000000/g,
      (_, p) => `c${p}${String(n).padStart(6, '0')}`
    );
  const org = remap('c1000000-0000-4000-8000-000000000001');
  const account = remap('c2000000-0000-4000-8000-000000000001');
  const request = remap('c9000000-0000-4000-8000-000000000001');
  const prefix = `monthly_fixture_${n}_`;
  let fixture = remap(read('scripts/verify-subscription-monthly-seed.sql'))
    .replaceAll('FROM signup_evidence', 'FROM private.monthly_fixture_evidence')
    .replaceAll('CREATE TEMP TABLE', 'CREATE TABLE')
    .replace(
      'INSERT INTO public.invoice_profiles',
      `INSERT INTO public.account_memberships(account_id,user_id,role) SELECT id,'${owner}','owner' FROM public.accounts WHERE organization_id='${org}';\nINSERT INTO public.invoice_profiles`
    )
    .replace(/pg_temp\.monthly_/g, `private.${prefix}`)
    .replace(
      /\bmonthly_(input|selected|alternatives)\b/g,
      `private.${prefix}$1`
    )
    .replace(
      "WHERE tier='growth'",
      `WHERE tier='${tier}' AND organization_id='${org}'`
    );
  // Fixed local fixture only: single-branch tiers are already archived before review.
  if (tier !== 'ultimate')
    fixture = fixture.replace(
      'CREATE TABLE private.',
      `UPDATE public.accounts SET branch_status='archived',archived_at=clock_timestamp() WHERE organization_id='${org}' AND id<>'${account}';\nCREATE TABLE private.`
    );
  sql(`BEGIN; ${fixture}
 REVOKE ALL ON FUNCTION private.${prefix}approve(),private.${prefix}open(),private.${prefix}quote(UUID) FROM PUBLIC,anon,authenticated,service_role;
 GRANT EXECUTE ON FUNCTION private.${prefix}approve() TO authenticated;
 GRANT EXECUTE ON FUNCTION private.${prefix}open(),private.${prefix}quote(UUID) TO service_role;
 COMMIT;`);
  const f = {
    n,
    org,
    account,
    request,
    prefix,
    tier,
    amount: tier === 'starter' ? 79900 : tier === 'growth' ? 149900 : 399900,
  };
  f.approve = `SELECT private.${prefix}approve();`;
  f.quote = (req = request) => `SELECT private.${prefix}quote('${req}');`;
  f.claim = `SELECT public.subscription_claim_live_order('${request}','${org}','${owner}','${merchant}');`;
  return f;
}
function open(f, quoteNow = true) {
  sql(txn(auth(), f.approve));
  sql(
    txn(
      auth(operator, true),
      `SELECT public.platform_admin_authorize_monthly_opening(offer_set_id,public.platform_admin_monthly_offer_context(organization_id,billing_account_id)->>'snapshot_token','synthetic concurrency opening',TRUE) FROM private.${f.prefix}selected;`
    )
  );
  sql(
    txn(
      service,
      `SELECT private.${f.prefix}open(); ${quoteNow ? f.quote() : ''}`
    )
  );
  if (f.tier === 'starter')
    sql(
      txn(
        auth(),
        `SELECT public.subscription_acknowledge_live_starter_reminders('${f.request}');`
      )
    );
}
function bound(f) {
  const c = JSON.parse(sql(txn(service, f.claim)));
  if (c.action === 'create') mockCreate('order', f.request);
  assert.ok(['create', 'recovery'].includes(c.action));
  f.order = `order_MonthlyRace${f.n}`;
  f.payment = `pay_MonthlyRace${f.n}`;
  sql(
    txn(
      service,
      `SELECT public.subscription_bind_live_order('${f.request}','${f.order}','${merchant}','${f.org}');`
    )
  );
  f.at = sql('SELECT clock_timestamp();');
  sql(
    txn(
      service,
      `SELECT public.subscription_record_live_webhook_event('${merchant}','${f.org}','evt_MonthlyRace${f.n}','payment.captured','${f.order}','${f.payment}',NULL,repeat('b',64),'${f.at}');`
    )
  );
  f.capture = `SELECT public.subscription_commit_live_initial_payment('${f.request}','${f.order}','${f.payment}','${merchant}',${f.amount},'INR','${f.at}');`;
}
function assertHold(f) {
  assert.equal(
    JSON.parse(sql(txn(service, f.capture))).status,
    'review_required'
  );
  assert.equal(
    sql(
      `SELECT NOT EXISTS(SELECT 1 FROM private.subscription_live_grants WHERE organization_id='${f.org}') AND EXISTS(SELECT 1 FROM private.subscription_live_recovery_exceptions WHERE item_id='${f.request}' AND status='waiting_owner' AND owner_reference<>'' AND next_action<>'');`
    ),
    't'
  );
}
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
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
  );
  sql(`CREATE DATABASE ${clone};`, 'postgres');
  created = true;
  execFileSync('docker', args(clone, 'supabase_admin'), {
    input: dump,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  sql(
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
      'RESET ROLE; CREATE TABLE private.monthly_fixture_evidence AS SELECT * FROM signup_evidence; REVOKE ALL ON private.monthly_fixture_evidence FROM PUBLIC,anon,authenticated,service_role;',
      omitMonthly ? '' : monthly,
      'COMMIT;',
    ].join('\n')
  );
  // Same complete original baseline in RED/GREEN. Target the missing INSERT
  // source serialization guard, not the absence of monthly tables/functions.
  assert.equal(
    sql('SELECT count(*)>0 FROM private.subscription_live_document_issues;'),
    't'
  );
  const guardOrg = 'cf000000-0000-4000-8000-000000000001';
  const guardAccount = 'cf000000-0000-4000-8000-000000000002';
  sql(
    `INSERT INTO public.organizations(id,name) VALUES('${guardOrg}','Synthetic guard negative control'); INSERT INTO public.legal_entities(id,organization_id,name) VALUES('${guardOrg}','${guardOrg}','Guard entity'); INSERT INTO public.accounts(id,name,organization_id,owner_user_id,legal_entity_id) VALUES('${guardAccount}','Guard account','${guardOrg}','${owner}','${guardOrg}');`
  );
  const guard = await overlap(
    `BEGIN; SELECT 1 FROM public.organizations WHERE id='${guardOrg}' FOR UPDATE;`,
    txn(
      '',
      `INSERT INTO public.membership_plans(account_id,name,price,duration_days) VALUES('${guardAccount}','Concurrent unreviewed source',1000,30);`
    )
  );
  ok(guard[0]);
  assert.notEqual(
    guard[1].code,
    0,
    'MISSING MONTHLY GUARD: concurrent source INSERT succeeded while owner review held organization lock (original baseline and documents exist)'
  );
  retry(guard[1]);
  console.log(
    'PASS: source INSERT guard rejects unreviewed concurrent source facts (negative control targets this exact invariant)'
  );
  assert.equal(omitMonthly, false, 'Negative control unexpectedly passed');
  // Owner selection and quote canonical identity: NOWAIT conflicts are explicitly
  // retried only after the first committed transaction, never provider POST retries.
  const selection = seed('growth');
  const alternate = JSON.parse(
    sql(
      `SELECT to_jsonb(o) FROM private.subscription_monthly_offers o WHERE organization_id='${selection.org}' AND tier='starter';`
    )
  );
  const alternateApproval = `SELECT public.subscription_approve_monthly_review('${alternate.offer_set_id}','${alternate.monthly_offer_id}',79900,TRUE);`;
  let pair = await overlap(
    `BEGIN; ${auth()} ${selection.approve}`,
    txn(auth(), alternateApproval)
  );
  ok(pair[0]);
  retry(pair[1]);
  const alternateRetry = await session(txn(auth(), alternateApproval)).done;
  assert.notEqual(alternateRetry.code, 0);
  assert.match(alternateRetry.error, /selected|review|frozen/i);
  const selected = JSON.parse(sql(txn(auth(), selection.approve)));
  assert.equal(
    sql(
      `SELECT count(*) FROM private.subscription_live_customer_preparations WHERE organization_id='${selection.org}';`
    ),
    '1'
  );
  assert.ok(selected);
  open(selection, false);
  const otherRequest = selection.request.replace(/1$/, '2');
  pair = await overlap(
    `BEGIN; ${service} ${selection.quote()}`,
    txn(service, selection.quote(otherRequest))
  );
  ok(pair[0]);
  retry(pair[1]);
  const otherRetry = await session(txn(service, selection.quote(otherRequest)))
    .done;
  assert.notEqual(otherRetry.code, 0);
  assert.match(otherRetry.error, /Existing monthly quote/);
  assert.equal(
    JSON.parse(sql(txn(service, selection.quote()))).request_id,
    selection.request
  );
  pair = await overlap(
    `BEGIN; ${service} ${selection.claim}`,
    txn(service, selection.claim)
  );
  assert.equal(result(pair[0]).action, 'create');
  mockCreate('order', selection.request);
  retry(pair[1]);
  assert.equal(
    JSON.parse(sql(txn(service, selection.claim))).action,
    'recovery'
  );
  assert.equal(
    sql(
      `SELECT count(*) FROM private.subscription_live_orders WHERE organization_id='${selection.org}';`
    ),
    '1'
  );
  console.log(
    'PASS: overlapping selection/quote/claim freeze one offer/request; exactly one mock create, retry is GET recovery'
  );
  // A real wait on the quote row crosses its original 1800-second boundary.
  const expiry = seed();
  open(expiry);
  sql(`BEGIN; ALTER TABLE private.subscription_live_quotes DISABLE TRIGGER subscription_freeze_live_quote_economics;
 ALTER TABLE private.subscription_live_quotes DISABLE TRIGGER subscription_monthly_closed_attachment;
 UPDATE private.subscription_live_quotes SET owner_reviewed_at=now()-interval '1798 seconds',expires_at=now()+interval '2 seconds' WHERE request_id='${expiry.request}';
 ALTER TABLE private.subscription_live_quotes ENABLE TRIGGER subscription_freeze_live_quote_economics;
 ALTER TABLE private.subscription_live_quotes ENABLE TRIGGER subscription_monthly_closed_attachment; COMMIT;`);
  pair = await overlap(
    `BEGIN; SELECT 1 FROM private.subscription_live_quotes WHERE request_id='${expiry.request}' FOR UPDATE;`,
    txn(service, expiry.claim),
    {
      afterWait: async (blocked) => {
        assert.equal(blocked, true);
        await new Promise((resolve) => setTimeout(resolve, 2300));
      },
    }
  );
  ok(pair[0]);
  assert.notEqual(pair[1].code, 0);
  assert.match(pair[1].error, /expired/);
  assert.equal(
    sql(
      `SELECT count(*) FROM private.subscription_live_orders WHERE request_id='${expiry.request}';`
    ),
    '0'
  );
  console.log(
    'PASS: real quote-row lock wait crosses compressed 1800-second boundary; no order/create authorized'
  );
  // Closing initiation and capability readiness races: retry after closure refuses.
  for (const kind of ['capability', 'opening', 'owner', 'access', 'archive']) {
    const f = seed();
    open(f);
    const mutation = {
      capability:
        'UPDATE private.subscription_billing_settings SET capabilities_enabled=false WHERE singleton;',
      opening: `UPDATE private.subscription_live_customer_preparations SET opening_enabled=false WHERE organization_id='${f.org}';`,
      owner: `DELETE FROM public.organization_memberships WHERE organization_id='${f.org}' AND user_id='${owner}';`,
      access: `UPDATE private.organization_product_access SET version=version+1 WHERE organization_id='${f.org}';`,
      archive: `UPDATE public.accounts SET branch_status='archived',archived_at=clock_timestamp() WHERE id='${f.account.replace(/1$/, '5')}';`,
    }[kind];
    pair = await overlap(
      `BEGIN; SELECT 1 FROM public.organizations WHERE id='${f.org}' FOR UPDATE; ${mutation}`,
      txn(service, f.claim)
    );
    ok(pair[0]);
    retry(pair[1]);
    const refused = await session(txn(service, f.claim)).done;
    assert.notEqual(refused.code, 0);
    assert.match(refused.error, /changed|review|disabled/);
    assert.equal(
      sql(
        `SELECT count(*) FROM private.subscription_live_orders WHERE request_id='${f.request}';`
      ),
      '0'
    );
    if (kind === 'capability')
      sql(
        'UPDATE private.subscription_billing_settings SET capabilities_enabled=true WHERE singleton;'
      );
  }
  console.log(
    'PASS: capability/opening/owner/access/archive races revoke new payable claims'
  );
  const gateRace = seed();
  open(gateRace);
  pair = await overlap(
    `BEGIN; ${service} ${gateRace.claim}`,
    txn(
      '',
      'UPDATE private.subscription_billing_settings SET capabilities_enabled=false WHERE singleton;'
    )
  );
  assert.equal(result(pair[0]).action, 'create');
  mockCreate('order', gateRace.request);
  ok(pair[1]);
  assert.equal(pair[2], true);
  const contained = await session(txn(service, gateRace.claim)).done;
  assert.notEqual(contained.code, 0);
  assert.match(contained.error, /changed/);
  sql(
    txn(
      service,
      `SELECT public.subscription_bind_live_order('${gateRace.request}','order_GateClosedRace','${merchant}','${gateRace.org}');`
    )
  );
  assert.equal(
    JSON.parse(
      sql(
        txn(
          service,
          `SELECT public.subscription_resolve_live_scope('${merchant}','${gateRace.request}',NULL);`
        )
      )
    ).monthly_offer_id,
    sql(
      `SELECT monthly_offer_id FROM private.subscription_live_quotes WHERE request_id='${gateRace.request}';`
    )
  );
  assert.ok(
    JSON.parse(
      sql(
        txn(
          service,
          `SELECT public.subscription_list_live_recovery_scopes('${merchant}');`
        )
      )
    ).includes(gateRace.org)
  );
  sql(
    'UPDATE private.subscription_billing_settings SET capabilities_enabled=true WHERE singleton;'
  );
  console.log(
    'PASS: gate closure waiting behind claim revokes final payable retry while durable binding/identity/GET recovery remain'
  );

  // Changes versus signed capture: changed sources produce durable owned holds;
  // initiation-only closure still settles a prior genuine obligation.
  for (const kind of [
    'owner',
    'access',
    'archive',
    'capability',
    'opening',
    'buyer',
  ]) {
    const f = seed();
    open(f);
    bound(f);
    // Synthetic local product gate permits the real authenticated settings writer
    // on this expired-trial fixture; billing/capability gates remain enforced.
    const productGate = sql(
      'SELECT enforcement_enabled FROM private.product_access_settings WHERE singleton;'
    );
    if (kind === 'buyer')
      sql(
        'UPDATE private.product_access_settings SET enforcement_enabled=false WHERE singleton;'
      );
    const buyer = `${auth()} SET LOCAL request.headers='{"x-usefuldesk-account-id":"${f.account}"}'; SELECT public.save_invoice_profile('${f.account}','Synthetic monthly brand','Synthetic monthly buyer','Synthetic street',NULL,'Changed concurrent city','Synthetic state','100001','IN','+919000000001','synthetic@example.invalid');`;
    const mutation = {
      owner: `DELETE FROM public.organization_memberships WHERE organization_id='${f.org}';`,
      access: `UPDATE private.organization_product_access SET version=version+1 WHERE organization_id='${f.org}';`,
      archive: `UPDATE public.accounts SET branch_status='archived',archived_at=clock_timestamp() WHERE id='${f.account.replace(/1$/, '5')}';`,
      capability:
        'UPDATE private.subscription_billing_settings SET capabilities_enabled=false WHERE singleton;',
      opening: `UPDATE private.subscription_live_customer_preparations SET opening_enabled=false WHERE organization_id='${f.org}';`,
      buyer,
    }[kind];
    pair = await overlap(
      `BEGIN; SELECT 1 FROM public.organizations WHERE id='${f.org}' FOR UPDATE; ${mutation}`,
      txn(service, f.capture)
    );
    ok(pair[0]);
    assert.equal(pair[2], true);
    assert.equal(
      result(pair[1]).status,
      kind === 'opening' ? 'verified' : 'review_required'
    );
    if (kind !== 'opening') assertHold(f);
    if (kind === 'buyer')
      sql(
        `UPDATE private.product_access_settings SET enforcement_enabled=${productGate === 't'} WHERE singleton;`
      );
    if (kind === 'capability')
      sql(
        'UPDATE private.subscription_billing_settings SET capabilities_enabled=true WHERE singleton;'
      );
  }
  console.log(
    'PASS: blocking capture sees committed owner/access/roster/capability/buyer changes; owned holds, initiation-only closure settles'
  );

  // Inverse tuple/organization ordering uses the actual authenticated invoice
  // upsert. Its tuple locks must yield a retryable conflict, never a deadlock.
  for (const boundary of ['capture', 'document']) {
    const f = seed('growth');
    open(f);
    bound(f);
    if (boundary === 'document') sql(txn(service, f.capture));
    const gate = sql(
      'SELECT enforcement_enabled FROM private.product_access_settings WHERE singleton;'
    );
    if (boundary === 'capture')
      sql(
        'UPDATE private.product_access_settings SET enforcement_enabled=false WHERE singleton;'
      );
    const issuer =
      '{"name":"UsefulMade","address":"Synthetic supplier address","email":"contact@usefulmade.com","review_reference":"synthetic inverse race"}';
    const snapshot =
      boundary === 'document'
        ? sql(
            txn(
              service,
              `SELECT public.subscription_preview_live_document_issue('${f.request}','${issuer}');`
            )
          )
        : null;
    const issue = `SELECT public.subscription_issue_live_document_pair('${f.request}','${snapshot?.replaceAll("'", "''")}',encode(convert_to('%PDF-1.4'||repeat('x',600)||'%%EOF','UTF8'),'base64'),encode(convert_to('%PDF-1.4'||repeat('y',600)||'%%EOF','UTF8'),'base64'),'${operator}','synthetic inverse race');`;
    const change = `SET LOCAL request.headers='{"x-usefuldesk-account-id":"${f.account}"}'; SELECT public.save_invoice_profile('${f.account}','Synthetic monthly brand','Synthetic monthly buyer','Synthetic street',NULL,'Inverse concurrent city','Synthetic state','100001','IN','+919000000001','synthetic@example.invalid');`;
    pair = await overlap(
      `BEGIN; SELECT 1 FROM public.organizations WHERE id='${f.org}' FOR UPDATE;`,
      txn(auth(), change),
      {
        end: `${service} ${boundary === 'capture' ? f.capture : issue} COMMIT;`,
      }
    );
    assert.equal(
      pair.filter((r) => typeof r === 'object' && r.code === 0).length,
      1,
      JSON.stringify(pair)
    );
    if (pair[0].code !== 0) {
      retry(pair[0]);
      ok(pair[1]);
      if (boundary === 'capture') assertHold(f);
      else {
        const refused = await session(txn(service, issue)).done;
        assert.notEqual(refused.code, 0);
        assert.match(refused.error, /changed|review|source|eligible/i);
        assert.equal(
          sql(
            `SELECT count(*) FROM private.subscription_live_document_issues WHERE request_id='${f.request}';`
          ),
          '0'
        );
      }
    } else {
      ok(pair[0]);
      retry(pair[1]);
      const frozen = sql(
        `SELECT to_jsonb(g) FROM private.subscription_live_grants g WHERE organization_id='${f.org}';`
      );
      sql(txn(auth(), change));
      assert.equal(
        sql(
          `SELECT to_jsonb(g) FROM private.subscription_live_grants g WHERE organization_id='${f.org}';`
        ),
        frozen
      );
      if (boundary === 'document')
        assert.equal(
          JSON.parse(sql(txn(service, issue))).status,
          'already_issued'
        );
    }
    sql(
      `UPDATE private.product_access_settings SET enforcement_enabled=${gate === 't'} WHERE singleton;`
    );
  }
  console.log(
    'PASS: actual authenticated buyer upsert versus capture/document inverse lock ordering returns retryable conflict; no silent grant/issue'
  );
  // A new/restored branch after frozen review must invalidate initiation and
  // signed settlement. Product access alone is disabled here to permit a real
  // owner restore in an expired trial; the subscription capacity gate stays on.
  for (const boundary of ['claim', 'capture'])
    for (const change of ['create', 'restore']) {
      const f = seed('growth');
      open(f);
      if (boundary === 'capture') bound(f);
      const gate = sql(
        'SELECT enforcement_enabled FROM private.product_access_settings WHERE singleton;'
      );
      sql(
        'UPDATE private.product_access_settings SET enforcement_enabled=false WHERE singleton;'
      );
      const mutation =
        change === 'restore'
          ? `${auth()} SELECT public.restore_branch('${f.account.replace(/1$/, '2')}');`
          : `INSERT INTO public.accounts(name,organization_id,owner_user_id,legal_entity_id) SELECT 'Concurrent created branch','${f.org}','${owner}',legal_entity_id FROM public.accounts WHERE id='${f.account}';`;
      pair = await overlap(
        `BEGIN; SELECT 1 FROM public.organizations WHERE id='${f.org}' FOR UPDATE; ${mutation}`,
        txn(service, boundary === 'capture' ? f.capture : f.claim)
      );
      ok(pair[0]);
      if (boundary === 'capture') {
        assert.equal(result(pair[1]).status, 'review_required');
        assertHold(f);
      } else {
        retry(pair[1]);
        const refused = await session(txn(service, f.claim)).done;
        assert.notEqual(refused.code, 0);
        assert.match(refused.error, /changed/);
      }
      sql(
        `UPDATE private.product_access_settings SET enforcement_enabled=${gate === 't'} WHERE singleton;`
      );
    }
  console.log(
    'PASS: create/restore versus claim/capture cannot grant an unreviewed Growth roster'
  );
  // Exact captures, documents and refunds for every fixed catalog identity.
  for (const tier of ['starter', 'growth', 'ultimate']) {
    const f = seed(tier);
    open(f);
    bound(f);
    const initialVersion = Number(
      sql(
        `SELECT version FROM private.organization_product_access WHERE organization_id='${f.org}';`
      )
    );
    pair = await overlap(
      `BEGIN; ${service} ${f.capture}`,
      txn(service, f.capture)
    );
    assert.equal(
      Number(
        sql(
          `SELECT version FROM private.organization_product_access WHERE organization_id='${f.org}';`
        )
      ),
      initialVersion + 1
    );
    assert.equal(result(pair[0]).status, 'verified');
    assert.equal(result(pair[1]).status, 'verified');
    assert.equal(pair[2], true);
    assert.equal(
      sql(
        `SELECT (SELECT count(*) FROM private.subscription_live_payments WHERE request_id='${f.request}')=1 AND (SELECT count(*) FROM private.subscription_live_terms WHERE request_id='${f.request}')=1 AND (SELECT count(*) FROM private.subscription_live_grants WHERE organization_id='${f.org}')=1;`
      ),
      't'
    );
    const issuer =
      '{"name":"UsefulMade","address":"Synthetic supplier address","email":"contact@usefulmade.com","review_reference":"synthetic race review"}';
    const snapshot = sql(
      txn(
        service,
        `SELECT public.subscription_preview_live_document_issue('${f.request}','${issuer}');`
      )
    );
    const issue = (snap = snapshot) =>
      `SELECT public.subscription_issue_live_document_pair('${f.request}','${snap.replaceAll("'", "''")}',encode(convert_to('%PDF-1.4'||repeat('x',600)||'%%EOF','UTF8'),'base64'),encode(convert_to('%PDF-1.4'||repeat('y',600)||'%%EOF','UTF8'),'base64'),'${operator}','synthetic race issuance');`;
    pair = await overlap(`BEGIN; ${service} ${issue()}`, txn(service, issue()));
    assert.equal(result(pair[0]).status, 'issued');
    assert.equal(result(pair[1]).status, 'already_issued');
    assert.equal(pair[2], true);
    const frozen = sql(
      `SELECT to_jsonb(d) FROM private.subscription_live_document_issues d WHERE request_id='${f.request}';`
    );
    const otherPayment = `pay_MonthlyConflict${f.n}`;
    sql(
      txn(
        service,
        `SELECT public.subscription_record_live_webhook_event('${merchant}','${f.org}','evt_MonthlyConflict${f.n}','payment.captured','${f.order}','${otherPayment}',NULL,repeat('c',64),'${f.at}');`
      )
    );
    const conflictingCapture = f.capture.replaceAll(f.payment, otherPayment);
    pair = await overlap(
      `BEGIN; ${service} ${f.capture}`,
      txn(service, conflictingCapture)
    );
    assert.equal(result(pair[0]).status, 'verified');
    assert.equal(result(pair[1]).reason, 'monthly_capture_conflict');
    assert.equal(
      sql(
        `SELECT provider_payment_id FROM private.subscription_live_payments WHERE request_id='${f.request}';`
      ),
      f.payment
    );

    pair = await overlap(
      `BEGIN; ${service} ${issue()}`,
      txn(
        service,
        issue(JSON.stringify({ ...JSON.parse(snapshot), tier: 'other' }))
      )
    );
    ok(pair[0]);
    assert.notEqual(pair[1].code, 0);
    assert.match(pair[1].error, /changed|conflict|already/i);
    const refund = `ce${String(f.n).padStart(6, '0')}-0000-4000-8000-000000000001`;
    sql(`INSERT INTO private.subscription_live_refund_reviews(refund_request_id,organization_id,requested_by,provider_payment_id,merchant_id,amount_minor,approved_policy_reference,request_received_at,request_evidence_reference,owner_reviewed_at)
 SELECT '${refund}',q.organization_id,q.requested_by,'${f.payment}',q.merchant_id,q.amount_minor,a.refund_policy_reference,clock_timestamp(),'synthetic concurrent refund',clock_timestamp() FROM private.subscription_live_quotes q JOIN private.subscription_live_offer_approvals a ON a.approval_id=q.offer_approval_id WHERE q.request_id='${f.request}';
 UPDATE private.subscription_live_customer_scopes SET refunds_enabled=true WHERE organization_id='${f.org}';`);
    const claim = `SELECT public.subscription_claim_live_refund('${refund}','${f.org}','${owner}','${merchant}');`;
    pair = await overlap(`BEGIN; ${service} ${claim}`, txn(service, claim));
    assert.equal(result(pair[0]).action, 'create');
    mockCreate('refund', refund);
    assert.equal(result(pair[1]).action, 'recovery');
    const observe = `SELECT public.subscription_observe_live_refund('${refund}','${f.payment}','rfnd_Race${f.n}','${merchant}',${f.amount},'INR','processed');`;
    sql(txn(service, observe));
    const commit = `SELECT public.subscription_commit_live_full_refund('${refund}','${f.payment}','rfnd_Race${f.n}','${merchant}',${f.amount},'INR');`;
    const version = Number(
      sql(
        `SELECT version FROM private.organization_product_access WHERE organization_id='${f.org}';`
      )
    );
    pair = await overlap(`BEGIN; ${service} ${commit}`, txn(service, commit));
    ok(pair[0]);
    ok(pair[1]);
    assert.equal(pair[2], true);
    assert.equal(
      Number(
        sql(
          `SELECT version FROM private.organization_product_access WHERE organization_id='${f.org}';`
        )
      ),
      version + 1
    );
    pair = await overlap(
      `BEGIN; ${service} ${commit}`,
      txn(service, commit.replace(`${f.amount},'INR'`, `${f.amount - 1},'INR'`))
    );
    ok(pair[0]);
    assert.notEqual(pair[1].code, 0);
    assert.match(pair[1].error, /identity|match|refund|amount/i);
    sql(
      `UPDATE private.subscription_live_customer_scopes SET quotes_enabled=false,orders_enabled=false,refunds_enabled=false WHERE organization_id='${f.org}';`
    );
    const access = sql(
      `SELECT to_jsonb(a) FROM private.organization_product_access a WHERE organization_id='${f.org}';`
    );
    assert.equal(JSON.parse(sql(txn(service, f.capture))).status, 'verified');
    assert.equal(
      JSON.parse(sql(txn(service, issue()))).status,
      'already_issued'
    );
    assert.equal(
      sql(
        `SELECT to_jsonb(d) FROM private.subscription_live_document_issues d WHERE request_id='${f.request}';`
      ),
      frozen
    );
    assert.equal(
      sql(
        `SELECT to_jsonb(a) FROM private.organization_product_access a WHERE organization_id='${f.org}';`
      ),
      access
    );
    console.log(
      `PASS: ${tier} concurrent identical capture/document/refund commit once; exact bytes/access survive contained retries`
    );
  }

  const capacity = seed();
  open(capacity);
  bound(capacity);
  sql(txn(service, capacity.capture));
  const sixth = capacity.account.replace(/1$/, '6');
  sql(
    `INSERT INTO public.accounts(id,name,organization_id,owner_user_id,legal_entity_id,branch_status,archived_at) SELECT '${sixth}','Synthetic sixth','${capacity.org}','${owner}',legal_entity_id,'archived',clock_timestamp() FROM public.accounts WHERE id='${capacity.account}'; INSERT INTO public.account_memberships(account_id,user_id,role) VALUES('${sixth}','${owner}','owner');`
  );
  pair = await overlap(
    `BEGIN; ${service} ${capacity.capture}`,
    txn(auth(), `SELECT public.restore_branch('${sixth}');`)
  );
  ok(pair[0]);
  assert.notEqual(pair[1].code, 0);
  assert.match(pair[1].error, /Active branch allowance is full/);
  assert.equal(
    sql(
      `SELECT count(*) FROM public.accounts WHERE organization_id='${capacity.org}' AND branch_status='active';`
    ),
    '5'
  );
  console.log(
    'PASS: Ultimate capture replay versus owner restoration refuses sixth active branch with capability gate enabled'
  );
  // Reapply after committed races, with all opening switches closed. Full rows
  // (not counts) and false gates must survive; no authority is re-created.
  sql(
    'UPDATE private.subscription_live_customer_preparations SET opening_enabled=false; UPDATE private.subscription_live_customer_scopes SET quotes_enabled=false,orders_enabled=false,refunds_enabled=false;'
  );
  const replayFingerprint = `CREATE TEMP TABLE replay_fingerprint(name TEXT,hash TEXT); DO $$ DECLARE r RECORD; BEGIN FOR r IN SELECT tablename FROM pg_tables WHERE schemaname='private' AND (tablename LIKE 'subscription_live_%' OR tablename LIKE 'subscription_monthly_%') LOOP EXECUTE format('INSERT INTO replay_fingerprint SELECT %L,md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::TEXT)::TEXT,''[]'')) FROM private.%I t',r.tablename,r.tablename); END LOOP; END $$; SELECT name||':'||hash FROM replay_fingerprint ORDER BY name;`;
  const replayBefore = sql(replayFingerprint);
  sql(monthly);
  assert.equal(sql(replayFingerprint), replayBefore);
  assert.equal(
    sql(
      'SELECT NOT EXISTS(SELECT 1 FROM private.subscription_live_customer_preparations WHERE opening_enabled) AND NOT EXISTS(SELECT 1 FROM private.subscription_live_customer_scopes WHERE quotes_enabled OR orders_enabled OR refunds_enabled);'
    ),
    't'
  );
  console.log(
    'PASS: populated closed migration replay preserves every monthly/Live authority and financial row byte-for-byte'
  );
  console.log(
    `PASS: deterministic mock counters order create=${orderCreates}, refund create=${refundCreates}; no provider network`
  );
} finally {
  for (const child of active) child.kill('SIGTERM');
  try {
    if (created) sql(`DROP DATABASE ${clone} WITH (FORCE);`, 'postgres');
  } finally {
    assert.equal(sql(absent, 'postgres'), 't');
    assert.equal(
      sql(fingerprint, 'postgres'),
      before,
      'Source whole-row fingerprints changed'
    );
    assert.equal(
      sql(
        `SELECT count(*) FROM pg_database WHERE datname='${clone}';`,
        'postgres'
      ),
      '0'
    );
    console.log(
      'PASS: clone dropped; all source public/private/auth whole-row fingerprints and schema absence unchanged'
    );
  }
}
