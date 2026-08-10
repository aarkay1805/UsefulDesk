import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const migration = fs.readFileSync(
  path.join(
    process.cwd(),
    'supabase/migrations/20260810160000_razorpay_live_application_ingress.sql'
  ),
  'utf8'
);

describe('Razorpay Live application ingress schema contract', () => {
  it('keeps activation audit and mutation service-only', () => {
    expect(migration).toContain(
      'ALTER TABLE public.razorpay_live_webhook_activations ENABLE ROW LEVEL SECURITY'
    );
    expect(migration).toMatch(
      /REVOKE ALL ON public\.razorpay_live_webhook_activations\s+FROM PUBLIC, anon, authenticated/
    );
    expect(migration).toMatch(
      /activate_razorpay_live_application_webhook[\s\S]+SECURITY INVOKER/
    );
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.activate_razorpay_live_application_webhook\([\s\S]+FROM PUBLIC, anon, authenticated/
    );
  });

  it('requires exact Live OAuth readiness and no legacy material', () => {
    expect(migration).toContain("v_credentials.provider_mode <> 'live'");
    expect(migration).toContain("v_credentials.authentication_mode <> 'oauth'");
    expect(migration).toContain("v_credentials.connection_status <> 'ready'");
    expect(migration).toContain(
      'v_credentials.razorpay_account_id <> p_external_account_id'
    );
    expect(migration).toContain('v_credentials.secret_storage_version <> 1');
    expect(migration).toContain(
      'v_credentials.razorpay_key_secret IS NOT NULL'
    );
    expect(migration).toContain(
      'v_credentials.razorpay_webhook_secret IS NOT NULL'
    );
  });

  it('locks, switches, and audits in one transaction', () => {
    expect(migration).toMatch(
      /FROM public\.account_payment_credentials[\s\S]+FOR UPDATE/
    );
    expect(migration).toMatch(
      /UPDATE public\.account_payment_credentials[\s\S]+SET canonical_webhook_ingress = 'application'[\s\S]+INSERT INTO public\.razorpay_live_webhook_activations/
    );
    expect(migration).toContain("'outcome', 'duplicate'");
  });
});
