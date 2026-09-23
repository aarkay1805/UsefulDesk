import { describe, expect, it } from 'vitest';

import { extractVariableIndices } from './template-validators';
import {
  TEMPLATE_PRESETS,
  presetWithLegalBusinessName,
} from './template-presets';

describe('gym template preset projection', () => {
  it('offers the complete supported library without unsupported booking or legacy renewal presets', () => {
    expect(TEMPLATE_PRESETS.map((preset) => preset.fields.name)).toEqual([
      'gym_membership_renewal',
      'gym_service_renewal',
      'gym_membership_post_expiry',
      'gym_service_post_expiry',
      'gym_session_pack_low',
      'gym_session_pack_used',
      'gym_membership_return_reminder',
      'gym_membership_win_back',
      'gym_service_win_back',
      'gym_installment_reminder',
      'gym_invoice_due',
      'gym_invoice_overdue',
      'gym_payment_promise_upcoming',
      'gym_payment_promise_missed',
      'gym_payment_confirmation',
      'gym_payment_membership_renewal_confirmation',
      'gym_autopay_retry_update',
      'gym_autopay_payment_help',
      'gym_payment_link',
      'gym_invoice_document',
      'gym_festival_offer',
    ]);

    expect(
      TEMPLATE_PRESETS.some((preset) =>
        [
          'gym_membership_expiry_notice',
          'gym_renewal_reminder',
          'gym_service_renewal_reminder',
          'gym_welcome_member',
          'gym_class_booking',
        ].includes(preset.fields.name)
      )
    ).toBe(false);
  });

  it('projects the invoice contract as a document header with no creation-time media sample', () => {
    const preset = TEMPLATE_PRESETS.find(
      (candidate) => candidate.fields.name === 'gym_invoice_document'
    );

    expect(preset?.fields).toMatchObject({
      header_format: 'document',
      header_sample: undefined,
    });
    expect(preset?.fields).not.toHaveProperty('header_media_url');
  });

  it('projects every body parameter into one ordered sample value', () => {
    for (const preset of TEMPLATE_PRESETS) {
      expect(extractVariableIndices(preset.fields.body_text)).toEqual(
        preset.fields.body_samples.map((_, index) => index + 1)
      );
    }
  });

  it('uses the legal name in every built-in sample without changing the registry', () => {
    for (const preset of TEMPLATE_PRESETS) {
      const index = preset.parameterLabels.indexOf('Legal business name');
      expect(index).toBeGreaterThanOrEqual(0);
      const projected = presetWithLegalBusinessName(
        preset,
        'Rajat Fitness Private Limited'
      );
      expect(projected.fields.body_samples[index]).toBe(
        'Rajat Fitness Private Limited'
      );
    }
  });
});
