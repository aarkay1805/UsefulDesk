// Explicit disposable-local acceptance; never connects through the app's .env.
// Keeps synthetic fixture rows as evidence and restores the original gate value.
import { spawn, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';

const container = process.argv[2];
if (
  !/^supabase_db_usefuldesk-subscription-test\.[A-Za-z0-9]+$/.test(
    container ?? ''
  )
) {
  throw new Error('Pass the exact disposable subscription Test container name');
}
const args = [
  'exec',
  '-i',
  container,
  'psql',
  '-U',
  'postgres',
  '-d',
  'postgres',
  '-v',
  'ON_ERROR_STOP=1',
  '-Atq',
];
const sql = (input) =>
  execFileSync('docker', args, {
    input,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
const concurrentSql = (input) =>
  new Promise((resolve) => {
    const child = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let error = '';
    child.stdout.resume();
    child.stderr.on('data', (chunk) => {
      error += chunk;
    });
    child.on('error', (cause) => resolve({ code: -1, error: cause.message }));
    child.on('close', (code) => resolve({ code, error }));
    child.stdin.end(input);
  });
const originalGate = sql(
  'SELECT enabled FROM private.subscription_billing_settings WHERE singleton;'
);
assert.ok(['t', 'f'].includes(originalGate));
sql(
  'UPDATE private.subscription_billing_settings SET enabled=true WHERE singleton;'
);
try {
  for (const actions of [
    ['create', 'create'],
    ['create', 'restore'],
    ['restore', 'restore'],
  ]) {
    const org = randomUUID(),
      owner = randomUUID();
    const branches = Array.from({ length: 6 }, () => randomUUID());
    sql(`INSERT INTO auth.users(id,instance_id,aud,role,email,email_confirmed_at)
      VALUES('${owner}','00000000-0000-0000-0000-000000000000','authenticated','authenticated','${owner}@example.invalid',now());
      INSERT INTO public.organizations(id,name) VALUES('${org}','Disposable concurrency ${actions.join('/')}');
      INSERT INTO public.organization_memberships(organization_id,user_id,role) VALUES('${org}','${owner}','owner');
      INSERT INTO private.organization_product_access(organization_id,mode,trial_started_at,trial_ends_at)
        VALUES('${org}','trial',now()-interval '1 day',now()+interval '13 days');
      ${branches
        .map(
          (
            id,
            i
          ) => `INSERT INTO public.accounts(id,name,organization_id,branch_status) VALUES('${id}','Branch ${i}','${org}','${i < 4 ? 'active' : 'archived'}');
        INSERT INTO public.account_memberships(account_id,user_id,role) VALUES('${id}','${owner}','owner');`
        )
        .join('\n')}`);
    const results = await Promise.all(
      actions.map((action, i) =>
        concurrentSql(`BEGIN;
      SET LOCAL lock_timeout='5s';
      ${
        action === 'create'
          ? `INSERT INTO public.accounts(name,organization_id) VALUES('Concurrent insert','${org}');`
          : `SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claims='{"sub":"${owner}","role":"authenticated"}'; SELECT public.restore_branch('${branches[4 + i]}');`
      }
      SELECT pg_sleep(0.5); COMMIT;`)
      )
    );
    assert.equal(
      results.filter((r) => r.code === 0).length,
      1,
      JSON.stringify(results)
    );
    assert.match(
      results.find((r) => r.code !== 0).error,
      /Active branch allowance is full/
    );
    assert.equal(
      sql(
        `SELECT count(*) FROM public.accounts WHERE organization_id='${org}' AND branch_status='active';`
      ),
      '5'
    );
    console.log(`PASS: ${actions.join('/')} shares one remaining trial slot`);
  }
} finally {
  sql(
    `UPDATE private.subscription_billing_settings SET enabled=${originalGate === 't'} WHERE singleton;`
  );
}
