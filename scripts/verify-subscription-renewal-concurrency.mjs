// Only the disposable local subscription fixture. No application .env or money.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { createDisposablePostgres } from './lib/disposable-postgres.mjs';

const database = createDisposablePostgres(process.argv[2], {
  kind: 'test',
  errorMessage: 'Pass the disposable subscription Test container',
});
const args = database.args();
const sql = (input) => database.sql(input).trim();
const concurrent = (input) =>
  new Promise((resolve, reject) => {
    const child = spawn('docker', args);
    let output = '';
    let error = '';
    child.stdout.on('data', (data) => {
      output += data;
    });
    child.stderr.on('data', (data) => {
      error += data;
    });
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve(output.trim()) : reject(new Error(error))
    );
    child.stdin.end(input);
  });
const org = randomUUID();
const user = randomUUID();
const branch = randomUUID();
const initial = randomUUID();
const renewal = randomUUID();
const suffix = randomUUID().replaceAll('-', '');
const prior = JSON.parse(
  sql(
    'SELECT row_to_json(s) FROM private.subscription_billing_settings s WHERE singleton;'
  )
);
const owner = `SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claims='{"sub":"${user}","role":"authenticated"}';`;
const service = `SET LOCAL ROLE service_role; SET LOCAL request.jwt.claims='{"role":"service_role"}';`;
try {
  sql(`BEGIN;
    INSERT INTO auth.users(id,instance_id,aud,role,email,email_confirmed_at) VALUES('${user}','00000000-0000-0000-0000-000000000000','authenticated','authenticated','${user}@example.invalid',now());
    INSERT INTO public.organizations(id,name) VALUES('${org}','Synthetic renewal concurrency');
    INSERT INTO public.accounts(id,name,organization_id) VALUES('${branch}','Synthetic branch','${org}');
    INSERT INTO public.organization_memberships(organization_id,user_id,role) VALUES('${org}','${user}','owner');
    INSERT INTO public.account_memberships(account_id,user_id,role) VALUES('${branch}','${user}','owner');
    INSERT INTO private.organization_product_access(organization_id,mode,access_starts_at,access_ends_at) VALUES('${org}','manual',now()-interval '30 days',now()-interval '1 hour');
    INSERT INTO private.organization_subscription_intents(request_id,organization_id,requested_by,billing_account_id,tier,amount_minor,state,provider_order_id,provider_payment_id,requested_at,verified_at)
      VALUES('${initial}','${org}','${user}','${branch}','growth',149900,'verified','order_Initial${suffix}','pay_Initial${suffix}',now()-interval '30 days',now()-interval '30 days');
    INSERT INTO private.organization_subscription_payments(provider_payment_id,provider_order_id,organization_id,intent_id,provider_merchant_id,provider_mode,amount_minor,currency,billing_timezone,verified_at)
      VALUES('pay_Initial${suffix}','order_Initial${suffix}','${org}','${initial}','acc_RenewalRace','test',149900,'INR','UTC',now()-interval '30 days');
    INSERT INTO private.organization_paid_subscription_grants(organization_id,tier,source_intent_id,first_provider_payment_id,period_start,paid_through_end)
      SELECT '${org}','growth','${initial}','pay_Initial${suffix}',access_starts_at,access_ends_at FROM private.organization_product_access WHERE organization_id='${org}';
    UPDATE private.subscription_billing_settings SET enabled=true,test_merchant_account_id='acc_RenewalRace';
    ${owner}
    SELECT public.subscription_create_test_renewal_intent('${org}','${renewal}','${branch}');
    COMMIT;`);
  const claim = `BEGIN; ${service} SELECT public.subscription_claim_test_renewal_order('${renewal}','${org}','${user}','acc_RenewalRace')->>'action'; SELECT pg_sleep(0.2); COMMIT;`;
  assert.deepEqual(
    (await Promise.all([concurrent(claim), concurrent(claim)])).sort(),
    ['create', 'recovery']
  );
  sql(
    `BEGIN; ${service} SELECT public.subscription_bind_test_order('${renewal}','order_Renew${suffix}','acc_RenewalRace'); COMMIT;`
  );
  const commit = `BEGIN; ${service} SELECT public.subscription_commit_test_renewal_payment('${renewal}','order_Renew${suffix}','pay_Renew${suffix}','acc_RenewalRace',149900,'INR',now())->'payment'->>'provider_payment_id'; SELECT pg_sleep(0.2); COMMIT;`;
  const committed = await Promise.all([concurrent(commit), concurrent(commit)]);
  assert(committed.every((value) => value === `pay_Renew${suffix}`));
  assert.equal(
    sql(
      `SELECT count(*) FROM private.organization_subscription_payments WHERE intent_id='${renewal}';`
    ),
    '1'
  );
  assert.equal(
    sql(
      `SELECT count(*) FROM private.product_access_audit WHERE organization_id='${org}';`
    ),
    '1'
  );
  assert.equal(
    sql(
      `SELECT version FROM private.organization_product_access WHERE organization_id='${org}';`
    ),
    '2'
  );
  const receipt = (id) =>
    `BEGIN; ${service} SELECT public.subscription_receive_test_refund_request('${org}','${id}','${user}','acc_RenewalRace',now())->>'request_id'; SELECT pg_sleep(0.2); COMMIT;`;
  const requests = [randomUUID(), randomUUID()];
  const received = await Promise.all(
    requests.map((id) => concurrent(receipt(id)))
  );
  assert.equal(received[0], received[1]);
  assert(requests.includes(received[0]));
  sql(`BEGIN; UPDATE private.subscription_billing_settings SET refunds_enabled=true;
    UPDATE private.organization_subscription_payments SET verified_at=now() WHERE provider_payment_id='pay_Initial${suffix}'; ${service}
    SELECT public.subscription_reserve_test_first_refund('${org}','${received[0]}','${user}','acc_RenewalRace','pay_Initial${suffix}',now()-interval '1 day',
      (SELECT requested_at FROM private.subscription_first_refund_requests WHERE organization_id='${org}')); COMMIT;`);
  const refundClaim = `BEGIN; ${service} SELECT public.subscription_claim_test_refund('${org}','${user}','acc_RenewalRace')->>'action'; SELECT pg_sleep(0.2); COMMIT;`;
  assert.deepEqual(
    (
      await Promise.all([concurrent(refundClaim), concurrent(refundClaim)])
    ).sort(),
    ['create', 'recovery']
  );
  sql(
    `BEGIN; ${service} SELECT public.subscription_observe_test_refund('${received[0]}','acc_RenewalRace','pay_Initial${suffix}','rfnd_${suffix}',149900,'INR','processed'); COMMIT;`
  );
  const refundCommit = `BEGIN; ${service} SELECT public.subscription_commit_test_full_refund('${received[0]}','acc_RenewalRace','pay_Initial${suffix}','rfnd_${suffix}',149900,'INR')->>'confirmed_at'; SELECT pg_sleep(0.2); COMMIT;`;
  const refunds = await Promise.all([
    concurrent(refundCommit),
    concurrent(refundCommit),
  ]);
  assert.equal(refunds[0], refunds[1]);
  assert.equal(
    sql(
      `SELECT count(*) FROM private.product_access_audit WHERE organization_id='${org}' AND action='subscription_full_refund';`
    ),
    '1'
  );
  assert.equal(
    sql(
      `SELECT version FROM private.organization_product_access WHERE organization_id='${org}';`
    ),
    '3'
  );
  console.log(
    'PASS: concurrent renewal order/payment and refund receipt/execution/commit are exactly once'
  );
  console.log(`Retained synthetic organization: ${org}`);
} finally {
  // Preserve the pre-existing gate, including its exact merchant binding.
  const merchant =
    prior.test_merchant_account_id === null
      ? 'NULL'
      : `'${prior.test_merchant_account_id.replaceAll("'", "''")}'`;
  sql(
    `UPDATE private.subscription_billing_settings SET enabled=${prior.enabled ? 'true' : 'false'},refunds_enabled=${prior.refunds_enabled ? 'true' : 'false'},test_merchant_account_id=${merchant} WHERE singleton;`
  );
}
