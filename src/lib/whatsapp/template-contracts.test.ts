import { describe, expect, it } from 'vitest';

import { buildMetaTemplatePayload } from './template-components';
import {
  FEATURE_TEMPLATE_CONTRACTS,
  TEMPLATE_CONTRACTS,
  getTemplateContract,
  getTemplateContractById,
} from './template-contracts';

const expectedContracts = [
  ['membership_renewal', 'gym_membership_renewal', 'Marketing'],
  ['service_renewal', 'gym_service_renewal', 'Marketing'],
  ['membership_post_expiry', 'gym_membership_post_expiry', 'Marketing'],
  ['service_post_expiry', 'gym_service_post_expiry', 'Marketing'],
  ['session_pack_low', 'gym_session_pack_low', 'Marketing'],
  ['session_pack_exhausted', 'gym_session_pack_used', 'Marketing'],
  ['freeze_return', 'gym_membership_return_reminder', 'Utility'],
  ['membership_win_back', 'gym_membership_win_back', 'Marketing'],
  ['service_win_back', 'gym_service_win_back', 'Marketing'],
  ['installment_reminder', 'gym_installment_reminder', 'Utility'],
  ['invoice_due', 'gym_invoice_due', 'Utility'],
  ['invoice_overdue', 'gym_invoice_overdue', 'Utility'],
  ['payment_promise_upcoming', 'gym_payment_promise_upcoming', 'Utility'],
  ['payment_promise_missed', 'gym_payment_promise_missed', 'Utility'],
  ['payment_confirmation', 'gym_payment_confirmation', 'Utility'],
  [
    'payment_membership_renewal_confirmation',
    'gym_payment_membership_renewal_confirmation',
    'Utility',
  ],
  ['autopay_recovery_pending', 'gym_autopay_retry_update', 'Utility'],
  ['autopay_recovery_terminal', 'gym_autopay_payment_help', 'Utility'],
  ['payment_link', 'gym_payment_link', 'Utility'],
  ['invoice_document', 'gym_invoice_document', 'Utility'],
  ['festival_offer', 'gym_festival_offer', 'Marketing'],
] as const;

describe('gym WhatsApp template contracts', () => {
  it('defines the direct-cutover operational library without retired duplicates', () => {
    expect(Object.keys(TEMPLATE_CONTRACTS)).toHaveLength(
      expectedContracts.length
    );
    for (const [id, name, category] of expectedContracts) {
      const contract = getTemplateContractById(id);
      expect(contract).toMatchObject({
        id,
        category,
        payload: { name, category, language: 'en_US' },
      });
      expect(contract?.purpose.length).toBeGreaterThan(20);
      expect(contract?.trigger.length).toBeGreaterThan(20);
      expect(getTemplateContract(name)?.id).toBe(id);
    }

    for (const retired of [
      'gym_payment_due',
      'gym_payment_receipt',
      'gym_membership_activation',
      'gym_win_back',
      'gym_payment_promise_reminder',
    ]) {
      expect(getTemplateContract(retired)).toBeUndefined();
    }
  });

  it('keeps every feature message attributable to the legal business', () => {
    for (const contract of FEATURE_TEMPLATE_CONTRACTS) {
      expect(contract.parameterLabels.at(-1)).toBe('Legal business name');
      expect(contract.payload.sample_values?.body?.at(-1)).toBe(
        'FitZone Wellness Private Limited'
      );
      expect(contract.payload.body_text).toContain(
        `{{${contract.parameterLabels.length}}}`
      );
      expect(contract.payload.body_text).not.toContain('undefined');
    }
  });

  it('uses truthful renewal copy and the approved help-me-renew reply', () => {
    for (const id of [
      'membership_renewal',
      'service_renewal',
      'membership_post_expiry',
      'service_post_expiry',
      'membership_win_back',
      'service_win_back',
    ] as const) {
      const contract = TEMPLATE_CONTRACTS[id];
      expect(contract.category).toBe('Marketing');
      expect(contract.payload.buttons).toEqual([
        { type: 'QUICK_REPLY', text: 'Help me renew' },
      ]);
      expect(JSON.stringify(contract.payload)).not.toMatch(/unsubscribe/i);
    }
  });

  it('splits upcoming and missed payment promises into distinct exact contracts', () => {
    expect(TEMPLATE_CONTRACTS.payment_promise_upcoming.payload.body_text).toBe(
      'Hi {{1}}, this is a reminder that you planned to pay {{3}} for invoice {{2}} on {{4}}. Reply if you need help. This message is from {{5}}.'
    );
    expect(TEMPLATE_CONTRACTS.payment_promise_missed.payload.body_text).toBe(
      'Hi {{1}}, the planned payment date of {{4}} for {{3}} on invoice {{2}} has passed, and the balance remains unpaid. Reply if you need help. This message is from {{5}}.'
    );
  });

  it('separates a generic receipt from membership-renewal confirmation', () => {
    expect(TEMPLATE_CONTRACTS.payment_confirmation.parameterLabels).toEqual([
      'Customer name',
      'Amount received',
      'Invoice reference',
      'Legal business name',
    ]);
    expect(
      TEMPLATE_CONTRACTS.payment_membership_renewal_confirmation.parameterLabels
    ).toEqual([
      'Customer name',
      'Amount received',
      'Invoice reference',
      'Membership end date',
      'Legal business name',
    ]);
    expect(
      TEMPLATE_CONTRACTS.payment_confirmation.payload.body_text
    ).not.toMatch(/\{\{4\}\}\s+Reply/);
  });

  it('builds a dynamic Razorpay URL button instead of exposing the raw URL', () => {
    const contract = TEMPLATE_CONTRACTS.payment_link;
    expect(contract.parameterLabels).toEqual([
      'Member name',
      'Outstanding amount',
      'Invoice reference',
      'Payment link expiry',
      'Legal business name',
    ]);
    expect(contract.payload.body_text).not.toMatch(/https?:\/\//);
    expect(buildMetaTemplatePayload(contract.payload)).toMatchObject({
      category: 'UTILITY',
      components: [
        { type: 'BODY' },
        {
          type: 'BUTTONS',
          buttons: [
            {
              type: 'URL',
              text: 'Pay invoice',
              url: 'https://rzp.io/{{1}}',
              example: ['i/abc123'],
            },
          ],
        },
      ],
    });
  });
});
