/** Rollback-only capability checks on an explicitly named disposable database. */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const container = process.argv[2];
if (
  !/^supabase_db_usefuldesk-subscription-full-[a-z0-9]+$/.test(container ?? '')
) {
  throw new Error(
    'Pass an explicit disposable subscription-full database container'
  );
}
const root = fileURLToPath(new URL('../', import.meta.url));
function sql(input) {
  return execFileSync(
    'docker',
    [
      'exec',
      '-i',
      container,
      'psql',
      '-X',
      '-U',
      'postgres',
      '-d',
      'postgres',
      '-Atq',
      '-v',
      'ON_ERROR_STOP=1',
    ],
    { input, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }
  );
}
const baselineQuery = `SELECT row_to_json(s) FROM private.subscription_billing_settings s;
SELECT row_to_json(s) FROM private.product_access_settings s;
SELECT count(*) FROM public.accounts; SELECT count(*) FROM auth.users;`;
const before = sql(baselineQuery);
const fixture = readFileSync(
  `${root}/scripts/verify-subscription-capabilities.sql`,
  'utf8'
).replace(/^\\i (supabase\/migrations\/[\w.-]+\.sql)$/gm, (_line, path) =>
  readFileSync(`${root}/${path}`, 'utf8')
);
sql(fixture);
if (sql(baselineQuery) !== before) {
  throw new Error(
    'Capability fixture changed baseline switches or record counts'
  );
}
console.log(
  'PASS: capability, current Starter transaction hooks, schedule/claim retirement, role isolation and grace checks'
);
console.log(
  'PASS: rollback restored baseline switches and account/user counts'
);
