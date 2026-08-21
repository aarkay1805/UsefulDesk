import { describe, expect, it } from 'vitest';
import type { MessageTemplate } from '@/types';
import { TEMPLATE_CONTRACTS } from './template-contracts';
import {
  TemplateSendPolicyError,
  resolveTemplateSendPolicy,
} from './template-send-policy';

function membershipRow(
  overrides: Partial<MessageTemplate> = {}
): MessageTemplate {
  const payload = TEMPLATE_CONTRACTS.membership_renewal.payload;
  return {
    id: 'template-1',
    account_id: 'account-1',
    user_id: 'user-1',
    name: payload.name,
    category: payload.category,
    language: payload.language,
    body_text: payload.body_text,
    footer_text: payload.footer_text,
    buttons: payload.buttons,
    status: 'APPROVED',
    parameter_format: 'POSITIONAL',
    created_at: '2026-08-22T00:00:00.000Z',
    ...overrides,
  };
}

function customRow(
  category: 'Utility' | 'Marketing',
  overrides: Partial<MessageTemplate> = {}
): MessageTemplate {
  return {
    id: 'custom-1',
    account_id: 'account-1',
    user_id: 'user-1',
    name: 'custom_notice',
    category,
    language: 'en_US',
    body_text: 'Hello {{1}}, this is a custom notice.',
    status: 'APPROVED',
    parameter_format: 'POSITIONAL',
    created_at: '2026-08-22T00:00:00.000Z',
    ...overrides,
  };
}

describe('resolveTemplateSendPolicy', () => {
  it('returns the canonical Marketing scope for an exact feature contract', () => {
    const row = membershipRow();
    expect(
      resolveTemplateSendPolicy([row], 'gym_membership_renewal', 'en_US')
    ).toEqual({
      row,
      consentScope: 'whatsapp_marketing',
      recognized: true,
    });
  });

  it('rejects a recognized row with provider or component drift', () => {
    expect(() =>
      resolveTemplateSendPolicy(
        [membershipRow({ category: 'Utility' })],
        'gym_membership_renewal',
        'en_US'
      )
    ).toThrow(TemplateSendPolicyError);
    try {
      resolveTemplateSendPolicy(
        [membershipRow({ body_text: 'Different {{1}} {{2}} {{3}} {{4}}.' })],
        'gym_membership_renewal',
        'en_US'
      );
    } catch (error) {
      expect(error).toMatchObject({ code: 'component_drift' });
    }
  });

  it('derives custom-template consent from the Approved provider category', () => {
    expect(
      resolveTemplateSendPolicy(
        [customRow('Utility')],
        'custom_notice',
        'en_US'
      )
    ).toMatchObject({
      consentScope: 'whatsapp_account_updates',
      recognized: false,
    });
    expect(
      resolveTemplateSendPolicy(
        [customRow('Marketing')],
        'custom_notice',
        'en_US'
      )
    ).toMatchObject({
      consentScope: 'whatsapp_marketing',
      recognized: false,
    });
  });

  it('rejects missing, unapproved, and Authentication custom templates', () => {
    expect(() =>
      resolveTemplateSendPolicy([], 'custom_notice', 'en_US')
    ).toThrowError(/not synced locally/i);
    expect(() =>
      resolveTemplateSendPolicy(
        [customRow('Utility', { status: 'PENDING' })],
        'custom_notice',
        'en_US'
      )
    ).toThrowError(/not Approved/i);
    expect(() =>
      resolveTemplateSendPolicy(
        [
          customRow('Utility', {
            category: 'Authentication',
          }),
        ],
        'custom_notice',
        'en_US'
      )
    ).toThrowError(/Authentication templates are not supported/i);
  });
});
