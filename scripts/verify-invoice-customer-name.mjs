/** Rollback-only invoice recovery on an explicitly named disposable database. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createDisposablePostgres } from './lib/disposable-postgres.mjs';

const { sql } = createDisposablePostgres(process.argv[2]);
const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const migration = read(
  'supabase/migrations/20261002173354_invoice_document_missing_customer_name.sql'
);
const fixture = read('supabase/tests/invoice_customer_name_recovery.sql');
const baselineQuery = `SELECT count(*) FROM public.invoices;
SELECT count(*) FROM public.invoice_documents;
SELECT count(*) FROM public.accounts; SELECT count(*) FROM auth.users;`;
const before = sql(baselineQuery);
if (process.argv.includes('--baseline')) {
  assert.throws(
    () => sql(`BEGIN;\n${fixture}\nROLLBACK;`),
    /Invoice customer snapshot is incomplete/
  );
  console.log(
    'PASS: original RPC reproduces the failure after saving a member name'
  );
} else {
  // Apply twice to prove replacement/grants are idempotent, within rollback.
  sql(`BEGIN;\n${migration}\n${migration}\n${fixture}\nROLLBACK;`);
  console.log(
    'PASS: missing-name recovery, immutable identity, retries, ready reuse and tenant/grant boundaries'
  );
}
assert.equal(sql(baselineQuery), before);
console.log(
  'PASS: rollback preserved baseline invoice/document/account/user counts'
);
