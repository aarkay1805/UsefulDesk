import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const connectRoute = readFileSync(
  'src/app/api/payments/razorpay/oauth/connect/route.ts',
  'utf8'
);
const callbackRoute = readFileSync(
  'src/app/api/payments/razorpay/oauth/callback/route.ts',
  'utf8'
);
const recovery = readFileSync(
  'src/lib/payments/razorpay-disconnect-recovery.ts',
  'utf8'
);

describe('Razorpay Live rollout route contract', () => {
  it('checks server-owned account eligibility before creating OAuth state', () => {
    expect(connectRoute).toContain(
      'await loadRazorpayLiveRolloutAuthorization(admin, ctx.accountId)'
    );
    expect(
      connectRoute.indexOf('loadRazorpayLiveRolloutAuthorization')
    ).toBeLessThan(connectRoute.indexOf(".from('razorpay_oauth_states')"));
  });

  it('claims the returned merchant before persisting its OAuth grant', () => {
    expect(callbackRoute).toMatch(
      /loadRazorpayLiveRolloutAuthorization\(\s*admin,\s*accountId\s*\)/
    );
    expect(callbackRoute).toContain('claimRazorpayLiveRolloutMerchant(');
    expect(
      callbackRoute.lastIndexOf('assertRazorpayApplicationWebhookConfigured()')
    ).toBeLessThan(
      callbackRoute.lastIndexOf('claimRazorpayLiveRolloutMerchant(')
    );
    expect(
      callbackRoute.lastIndexOf('claimRazorpayLiveRolloutMerchant(')
    ).toBeLessThan(callbackRoute.lastIndexOf('beginRazorpayOAuthConnection('));
  });

  it('requires the stored recovery merchant to match its rollout binding', () => {
    expect(recovery).toMatch(
      /loadRazorpayLiveRolloutAuthorization\(\s*input\.admin,\s*input\.accountId\s*\)/
    );
    expect(recovery).toMatch(
      /authorizeRazorpayLiveRolloutMerchant\(\s*data\.razorpay_account_id,\s*rollout\s*\)/
    );
  });
});
