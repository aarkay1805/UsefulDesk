import type { ProductAccessSnapshot } from '../model';
import type { SubscriptionTier } from '@/lib/subscriptions/plans';

/** Fixed counterpart of the three real SQL grant snapshots in the monthly runner. */
export function monthlyGrantSnapshot(
  tier: SubscriptionTier
): ProductAccessSnapshot {
  return {
    allowed: true,
    status: 'active',
    enforcement_enabled: true,
    support_email: null,
    support_whatsapp: null,
    access: {
      organization_id: 'monthly-org',
      mode: 'manual',
      version: 2,
      trial_started_at: null,
      trial_ends_at: null,
      access_starts_at: '2026-10-03T00:00:00Z',
      access_ends_at: '2026-11-03T00:00:00Z',
      suspended_at: null,
    },
    subscription_capabilities:
      tier === 'starter'
        ? ['standard_renewal_reminders']
        : [
            'standard_renewal_reminders',
            'custom_renewal_schedules',
            'bulk_campaigns',
            'configurable_automations',
            'gym_payment_links',
            'gym_autopay',
          ],
  };
}
