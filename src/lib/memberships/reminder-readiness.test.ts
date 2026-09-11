import { describe, expect, it } from 'vitest';

import { diagnoseReminder } from './reminder-readiness';

const readyTemplate = { ready: true as const, code: 'ready' as const };

describe('diagnoseReminder', () => {
  it('keeps an empty eligible cohort healthy rather than reporting an error', () => {
    expect(
      diagnoseReminder({
        kind: 'membership_renewal',
        enabled: true,
        whatsappConnected: true,
        template: readyTemplate,
        dateMatchedCount: 0,
        pendingCount: 0,
        blockedCount: 0,
        deferredCount: 0,
      })
    ).toMatchObject({ state: 'no_eligible', dateMatchedCount: 0 });
  });

  it('returns the exact missing installment-template recovery reason', () => {
    expect(
      diagnoseReminder({
        kind: 'installment_reminder',
        enabled: true,
        whatsappConnected: true,
        template: {
          ready: false,
          code: 'missing',
          message:
            'Create and submit the exact gym_installment_reminder template, then sync after Meta review.',
        },
        dateMatchedCount: 1,
        pendingCount: 1,
        blockedCount: 0,
        deferredCount: 0,
      })
    ).toMatchObject({
      state: 'blocked',
      reason:
        'Create and submit the exact gym_installment_reminder template, then sync after Meta review.',
    });
  });

  it('does not call an enabled schedule ready until WhatsApp is connected', () => {
    expect(
      diagnoseReminder({
        kind: 'service_renewal',
        enabled: true,
        whatsappConnected: false,
        template: readyTemplate,
        dateMatchedCount: 2,
        pendingCount: 2,
        blockedCount: 0,
        deferredCount: 0,
      })
    ).toMatchObject({ state: 'blocked' });
  });

  it('keeps missing-phone and send-window cases out of the sendable count', () => {
    expect(
      diagnoseReminder({
        kind: 'membership_renewal',
        enabled: true,
        whatsappConnected: true,
        template: readyTemplate,
        dateMatchedCount: 2,
        pendingCount: 0,
        blockedCount: 2,
        deferredCount: 0,
      })
    ).toMatchObject({ state: 'blocked', pendingCount: 0, blockedCount: 2 });
    expect(
      diagnoseReminder({
        kind: 'membership_renewal',
        enabled: true,
        whatsappConnected: true,
        template: readyTemplate,
        dateMatchedCount: 1,
        pendingCount: 0,
        blockedCount: 0,
        deferredCount: 1,
      })
    ).toMatchObject({ state: 'deferred', pendingCount: 0, deferredCount: 1 });
  });
});
