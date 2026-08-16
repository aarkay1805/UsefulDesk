import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) =>
  readFileSync(resolve(process.cwd(), path), 'utf8');

const migration = read(
  'supabase/migrations/20260816120001_fix_change_plan_collection.sql'
);
const acceptance = read('supabase/tests/change_plan_collection_acceptance.sql');
const validator = migration.slice(
  migration.indexOf(
    'CREATE OR REPLACE FUNCTION public.validate_membership_payment()'
  ),
  migration.indexOf(
    'ALTER FUNCTION public.validate_membership_payment() OWNER TO postgres'
  )
);
const membershipLookup = validator.slice(
  validator.indexOf('IF NEW.invoice_id IS NULL THEN'),
  validator.indexOf('ELSE', validator.indexOf('IF NEW.invoice_id IS NULL THEN'))
);
const invoiceLookup = validator.slice(
  validator.indexOf(
    'ELSE',
    validator.indexOf('IF NEW.invoice_id IS NULL THEN')
  ),
  validator.indexOf("IF NEW.source = 'payment_link' THEN")
);

describe('change-plan collection database contract', () => {
  it('serializes membership payments on the period without requiring invoice UPDATE RLS', () => {
    expect(membershipLookup).toMatch(
      /FROM public\.membership_periods[\s\S]*FOR UPDATE;/
    );
    expect(membershipLookup).toMatch(
      /SELECT invoice\.\* INTO v_invoice[\s\S]*WHERE line\.id = v_period\.invoice_line_id;[\s\S]*IF NOT FOUND THEN/
    );
    expect(membershipLookup).not.toContain('FOR UPDATE OF invoice');
  });

  it('keeps generic invoice collection locked and the validator invoker-scoped', () => {
    expect(invoiceLookup).toMatch(
      /FROM public\.invoices[\s\S]*WHERE id = NEW\.invoice_id[\s\S]*FOR UPDATE;/
    );
    expect(validator).toContain('SECURITY INVOKER');
    expect(migration).not.toMatch(
      /CREATE POLICY[\s\S]*invoices[\s\S]*FOR UPDATE/i
    );
    expect(migration).not.toContain(
      'ALTER FUNCTION public.change_membership_plan'
    );
  });

  it('covers a non-zero first collection in rollback-scoped acceptance', () => {
    expect(acceptance).toContain('public.change_membership_plan(');
    expect(acceptance).toMatch(
      /public\.change_membership_plan\([\s\S]*1200,[\s\n ]*1200,[\s\n ]*'cash'/
    );
    expect(acceptance).toContain('ROLLBACK;');
  });
});
