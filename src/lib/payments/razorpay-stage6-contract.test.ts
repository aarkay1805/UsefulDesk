import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) =>
  readFileSync(resolve(process.cwd(), path), 'utf8');

const migration = read(
  'supabase/migrations/20260811181302_retire_razorpay_manual_keys.sql'
);
const credentials = read('src/lib/payments/credentials.ts');
const razorpay = read('src/lib/payments/razorpay.ts');
const config = read('src/lib/payments/razorpay-config.ts');
const connectionRoute = read(
  'src/app/api/payments/razorpay/connection/route.ts'
);
const settings = read('src/components/settings/razorpay-settings-card.tsx');

describe('Razorpay Stage 6 retirement contract', () => {
  it('makes every credential row OAuth/storage-v1/application-canonical', () => {
    expect(migration).toMatch(/CHECK \(authentication_mode = 'oauth'\)/);
    expect(migration).toMatch(/CHECK \(secret_storage_version = 1\)/);
    expect(migration).toMatch(
      /CHECK \(canonical_webhook_ingress = 'application'\)/
    );
    expect(migration).toMatch(
      /razorpay_key_id IS NULL[\s\S]*razorpay_key_secret IS NULL[\s\S]*razorpay_webhook_secret IS NULL/
    );
  });

  it('retains only OAuth Bearer authentication in application code', () => {
    expect(razorpay).toMatch(/Authorization: authHeader\(creds\)/);
    expect(razorpay).toMatch(/Bearer \$\{auth\.accessToken\}/);
    expect(razorpay).not.toMatch(/Basic |api_key|keySecret/);
    expect(credentials).not.toMatch(
      /manualRollback|saveManualRazorpayCredentials|allowVersionZero/
    );
    expect(config).not.toMatch(/RAZORPAY_MANUAL_ROLLBACK_ENABLED/);
  });

  it('removes manual and legacy operator surfaces', () => {
    expect(connectionRoute).not.toMatch(/export async function POST/);
    expect(settings).not.toMatch(
      /Manual rollback|Key secret|Legacy webhook URL/
    );
    for (const path of [
      'scripts/backfill-razorpay-payment-secrets.mjs',
      'src/app/api/payments/razorpay/webhook/[accountId]/route.ts',
      'src/app/api/payments/razorpay/webhook/legacy-secret/route.ts',
      'src/app/api/payments/razorpay/webhook/cutover/route.ts',
    ]) {
      expect(existsSync(resolve(process.cwd(), path))).toBe(false);
    }
  });
});
