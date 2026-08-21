import { describe, expect, it } from 'vitest';

import {
  META_TEMPLATE_SYNC_FIELDS,
  buildSyncedTemplateRow,
} from './template-sync';

describe('Meta template sync contract', () => {
  it('requests parameter_format with the complete provider state', () => {
    expect(META_TEMPLATE_SYNC_FIELDS).toBe(
      'id,name,language,status,category,parameter_format,components,quality_score'
    );
  });

  it('persists positional format and clears provider drift after full reconciliation', () => {
    expect(
      buildSyncedTemplateRow(
        {
          id: 'meta-1',
          name: 'gym_membership_renewal',
          language: 'en_US',
          status: 'APPROVED',
          category: 'MARKETING',
          parameter_format: 'POSITIONAL',
          components: [
            {
              type: 'BODY',
              text: 'Hi {{1}}, renew {{2}} by {{3}} for {{4}}.',
              example: {
                body_text: [['Rahul', 'Quarterly', '20 Sep 2026', '₹3,999']],
              },
            },
            { type: 'FOOTER', text: 'Footer' },
            {
              type: 'BUTTONS',
              buttons: [{ type: 'QUICK_REPLY', text: 'Renew membership' }],
            },
          ],
          quality_score: { score: 'GREEN' },
        },
        'account-1',
        'user-1',
        '2026-08-22T00:00:00.000Z'
      )
    ).toEqual({
      account_id: 'account-1',
      user_id: 'user-1',
      name: 'gym_membership_renewal',
      category: 'Marketing',
      language: 'en_US',
      parameter_format: 'POSITIONAL',
      header_type: null,
      header_content: null,
      header_handle: null,
      body_text: 'Hi {{1}}, renew {{2}} by {{3}} for {{4}}.',
      footer_text: 'Footer',
      buttons: [{ type: 'QUICK_REPLY', text: 'Renew membership' }],
      sample_values: {
        body: ['Rahul', 'Quarterly', '20 Sep 2026', '₹3,999'],
      },
      status: 'APPROVED',
      meta_template_id: 'meta-1',
      quality_score: 'GREEN',
      provider_components_sync_required_at: null,
      updated_at: '2026-08-22T00:00:00.000Z',
    });
  });

  it('leaves an absent or unknown parameter format unsatisfied', () => {
    const base = {
      id: 'meta-2',
      name: 'custom_template',
      language: 'en_US',
      status: 'APPROVED',
      category: 'UTILITY',
      components: [{ type: 'BODY', text: 'Account update.' }],
    };
    expect(
      buildSyncedTemplateRow(base, 'account-1', 'user-1').parameter_format
    ).toBeNull();
    expect(
      buildSyncedTemplateRow(
        { ...base, parameter_format: 'FUTURE_FORMAT' },
        'account-1',
        'user-1'
      ).parameter_format
    ).toBeNull();
  });
});
