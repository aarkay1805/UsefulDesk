import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationsDir = join(process.cwd(), 'supabase/migrations');
const migration = readFileSync(
  join(
    migrationsDir,
    '20260826043822_resolve_razorpay_provider_charge_exceptions.sql'
  ),
  'utf8'
);

describe('Razorpay provider charge resolution schema', () => {
  it('keeps apply and ignore service-only and actor-audited', () => {
    expect(migration).toMatch(
      /CREATE OR REPLACE FUNCTION public\.resolve_razorpay_provider_charge_exception/
    );
    expect(migration).toMatch(
      /CREATE OR REPLACE FUNCTION public\.ignore_razorpay_provider_charge_exception/
    );
    expect(migration).toMatch(/resolved_by = p_actor/);
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.resolve_razorpay_provider_charge_exception[\s\S]*FROM PUBLIC, anon, authenticated/
    );
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.ignore_razorpay_provider_charge_exception[\s\S]*FROM PUBLIC, anon, authenticated/
    );
  });

  it('applies only the next preserved charge through the canonical ledger transaction', () => {
    expect(migration).toMatch(
      /reason_code = 'provider_charge_missing_webhook'/
    );
    expect(migration).toMatch(
      /provider_paid_count <> v_mandate\.last_applied_paid_count \+ 1/
    );
    expect(migration).toMatch(/FROM public\.record_gateway_charge/);
    expect(migration).toMatch(/paid_at = v_exception\.gateway_paid_at/);
  });
});
