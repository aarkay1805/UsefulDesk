import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const route = readFileSync(
  'src/app/api/payments/razorpay/oauth/refresh/route.ts',
  'utf8'
);
const settingsCard = readFileSync(
  'src/components/settings/razorpay-settings-card.tsx',
  'utf8'
);

describe('Razorpay OAuth refresh route contract', () => {
  it('keeps stale-readiness recovery pinned and verifies provider readiness', () => {
    expect(route).toContain('requirePaymentGatewayAccess()');
    expect(route).toContain('requireSameOriginRequest(request)');
    expect(route).toContain('assertRazorpayLivePilotAccount(ctx.accountId)');
    expect(route).toContain(
      'assertRazorpayPinnedLivePilotMerchant(scope.externalAccountId)'
    );
    expect(route).toContain('forceRefresh: true');
    expect(route).toContain('allowStaleReadinessForRecovery: true');
    expect(route).toContain('verifyRazorpayOAuthReadiness({');
    expect(route).toContain('finalizeRazorpayOAuthConnection(');
  });

  it('is reachable through the existing Payments settings card', () => {
    expect(settingsCard).toContain(
      "fetch('/api/payments/razorpay/oauth/refresh', {"
    );
    expect(settingsCard).toContain("method: 'POST'");
    expect(settingsCard).toContain('Verify connection');
  });
});
