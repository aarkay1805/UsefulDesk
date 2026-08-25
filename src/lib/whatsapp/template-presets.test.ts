import { describe, expect, it } from 'vitest';

import { extractVariableIndices } from './template-validators';
import { TEMPLATE_PRESETS } from './template-presets';

describe('gym template preset projection', () => {
  it('offers the complete supported library without unsupported booking or legacy renewal presets', () => {
    expect(TEMPLATE_PRESETS.map((preset) => preset.fields.name)).toEqual([
      'gym_membership_renewal',
      'gym_service_renewal',
      'gym_installment_reminder',
      'gym_payment_link',
      'gym_invoice_document',
      'gym_payment_due',
      'gym_payment_receipt',
      'gym_membership_activation',
      'gym_win_back',
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
});
