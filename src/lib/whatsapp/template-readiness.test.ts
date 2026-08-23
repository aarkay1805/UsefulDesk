import { describe, expect, it } from 'vitest';

import type { MessageTemplate } from '@/types';
import { TEMPLATE_CONTRACTS } from './template-contracts';
import {
  evaluateTemplateReadiness,
  requireTemplateReady,
  TemplateNotReadyError,
} from './template-readiness';

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
    sample_values: payload.sample_values,
    status: 'APPROVED',
    parameter_format: 'POSITIONAL',
    created_at: '2026-08-22T00:00:00.000Z',
    ...overrides,
  };
}

describe('evaluateTemplateReadiness', () => {
  it('returns the exact Approved provider row when every contract field matches', () => {
    const row = membershipRow();
    expect(
      evaluateTemplateReadiness([row], 'membership_renewal', 'en_US')
    ).toEqual({ ready: true, code: 'ready', row });
  });

  it('accepts equivalent synced button objects regardless of JSON key order', () => {
    const row = membershipRow({
      buttons: [
        { text: 'Renew membership', type: 'QUICK_REPLY' },
        { text: 'Unsubscribe', type: 'QUICK_REPLY' },
      ],
    });

    expect(
      evaluateTemplateReadiness([row], 'membership_renewal', 'en_US')
    ).toEqual({ ready: true, code: 'ready', row });
  });

  it('distinguishes missing and provider review states', () => {
    expect(
      evaluateTemplateReadiness([], 'membership_renewal', 'en_US')
    ).toMatchObject({ ready: false, code: 'missing' });

    for (const [status, code] of [
      ['PENDING', 'pending'],
      ['REJECTED', 'rejected'],
      ['PAUSED', 'paused'],
      ['DISABLED', 'disabled'],
    ] as const) {
      expect(
        evaluateTemplateReadiness(
          [membershipRow({ status })],
          'membership_renewal',
          'en_US'
        )
      ).toMatchObject({ ready: false, code });
    }
  });

  it('rejects an Approved renewal row that Meta classified as Utility', () => {
    expect(
      evaluateTemplateReadiness(
        [membershipRow({ category: 'Utility' })],
        'membership_renewal',
        'en_US'
      )
    ).toMatchObject({ ready: false, code: 'wrong_category' });
  });

  it('requires the synced positional parameter format', () => {
    expect(
      evaluateTemplateReadiness(
        [membershipRow({ parameter_format: 'NAMED' })],
        'membership_renewal',
        'en_US'
      )
    ).toMatchObject({ ready: false, code: 'wrong_parameter_format' });
    expect(
      evaluateTemplateReadiness(
        [membershipRow({ parameter_format: undefined })],
        'membership_renewal',
        'en_US'
      )
    ).toMatchObject({ ready: false, code: 'wrong_parameter_format' });
  });

  it('reports parameter drift before general component drift', () => {
    expect(
      evaluateTemplateReadiness(
        [membershipRow({ body_text: 'Hi {{1}}, ends {{3}}.' })],
        'membership_renewal',
        'en_US'
      )
    ).toMatchObject({ ready: false, code: 'parameter_drift' });
  });

  it('rejects exact body, footer, header, and button drift', () => {
    for (const row of [
      membershipRow({ body_text: 'Different {{1}} {{2}} {{3}} {{4}}.' }),
      membershipRow({ footer_text: 'Different footer' }),
      membershipRow({ header_type: 'text', header_content: 'Promotion' }),
      membershipRow({
        buttons: [
          { type: 'QUICK_REPLY', text: 'Unsubscribe' },
          { type: 'QUICK_REPLY', text: 'Renew membership' },
        ],
      }),
    ]) {
      expect(
        evaluateTemplateReadiness([row], 'membership_renewal', 'en_US')
      ).toMatchObject({ ready: false, code: 'component_drift' });
    }
  });

  it('blocks a provider-owned component update until full sync completes', () => {
    expect(
      evaluateTemplateReadiness(
        [
          membershipRow({
            provider_components_sync_required_at: '2026-08-22T00:01:00.000Z',
          }),
        ],
        'membership_renewal',
        'en_US'
      )
    ).toMatchObject({ ready: false, code: 'provider_sync_required' });
  });

  it('throws a structured error from the imperative guard', () => {
    expect(() =>
      requireTemplateReady([], 'membership_renewal', 'en_US')
    ).toThrow(TemplateNotReadyError);
    try {
      requireTemplateReady([], 'membership_renewal', 'en_US');
    } catch (error) {
      expect(error).toMatchObject({ code: 'missing' });
    }
  });
});
