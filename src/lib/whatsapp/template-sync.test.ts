import { describe, expect, it } from 'vitest';

import {
  buildMissingProviderTemplateUpdate,
  META_TEMPLATE_SYNC_FIELDS,
  buildSyncedTemplateRow,
  findMissingProviderTemplates,
  findUnsafeMissingReconciliationIds,
  normalizeProviderSyncGeneration,
  providerSyncCasFilter,
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
        42,
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
      provider_missing_since: null,
      provider_sync_generation: 42,
      submission_error: null,
      rejection_reason: null,
      updated_at: '2026-08-22T00:00:00.000Z',
    });
  });

  it('builds a provider-generation CAS filter for overlapping syncs', () => {
    expect(providerSyncCasFilter(42)).toBe(
      'provider_sync_generation.is.null,provider_sync_generation.lte.42'
    );
  });

  it('accepts only positive safe provider generations returned by PostgREST', () => {
    expect(normalizeProviderSyncGeneration(42)).toBe(42);
    expect(normalizeProviderSyncGeneration('42')).toBe(42);
    expect(normalizeProviderSyncGeneration(0)).toBeNull();
    expect(normalizeProviderSyncGeneration('not-a-generation')).toBeNull();
    expect(
      normalizeProviderSyncGeneration(Number.MAX_SAFE_INTEGER + 1)
    ).toBeNull();
  });

  it('preserves a provider rejection reason until Meta reports a different status', () => {
    const row = buildSyncedTemplateRow(
      {
        id: 'meta-rejected',
        name: 'rejected_template',
        language: 'en_US',
        status: 'REJECTED',
        category: 'UTILITY',
        components: [{ type: 'BODY', text: 'Account update.' }],
      },
      'account-1',
      'user-1',
      42
    );

    expect(row).not.toHaveProperty('rejection_reason');
    expect(row.submission_error).toBeNull();
    expect(row.provider_missing_since).toBeNull();
  });

  it('finds only provider-backed rows absent from a complete Meta snapshot', () => {
    const local = [
      {
        id: 'local-present',
        name: 'present',
        language: 'en_US',
        meta_template_id: 'meta-present',
        provider_missing_since: null,
      },
      {
        id: 'local-missing',
        name: 'missing',
        language: 'en_US',
        meta_template_id: 'meta-missing',
        provider_missing_since: null,
      },
      {
        id: 'local-already-missing',
        name: 'still_missing',
        language: 'en_US',
        meta_template_id: 'meta-still-missing',
        provider_missing_since: '2026-08-21T00:00:00.000Z',
      },
      {
        id: 'local-draft',
        name: 'draft',
        language: 'en_US',
        meta_template_id: null,
        provider_missing_since: null,
      },
      {
        id: 'local-dry-run',
        name: 'dry_run',
        language: 'en_US',
        meta_template_id: 'dry-run-123',
        provider_missing_since: null,
      },
      {
        id: 'local-rotated-id',
        name: 'rotated',
        language: 'en_US',
        meta_template_id: 'meta-old',
        provider_missing_since: null,
      },
    ];
    const remote = [
      {
        id: 'meta-present',
        name: 'present',
        language: 'en_US',
        status: 'APPROVED',
        category: 'UTILITY',
      },
      {
        id: 'meta-new',
        name: 'rotated',
        language: 'en_US',
        status: 'APPROVED',
        category: 'UTILITY',
      },
    ];

    expect(findMissingProviderTemplates(local, remote, true)).toEqual([
      local[1],
      local[2],
    ]);
    expect(findMissingProviderTemplates(local, remote, false)).toEqual([]);
  });

  it('builds a non-sendable, recoverable state for a missing provider row', () => {
    expect(
      buildMissingProviderTemplateUpdate('2026-08-22T01:02:03.000Z', 42)
    ).toEqual({
      status: 'DISABLED',
      provider_missing_since: '2026-08-22T01:02:03.000Z',
      provider_components_sync_required_at: null,
      quality_score: null,
      submission_error: null,
      rejection_reason: null,
      updated_at: '2026-08-22T01:02:03.000Z',
      provider_sync_generation: 42,
    });
  });

  it('finds reconciliation rows that are neither missing-safe nor superseded', () => {
    expect(
      findUnsafeMissingReconciliationIds(
        [
          {
            id: 'safe-missing',
            status: 'DISABLED',
            provider_missing_since: '2026-08-22T01:03:00.000Z',
            provider_sync_generation: 41,
          },
          {
            id: 'safe-newer-sync',
            status: 'APPROVED',
            provider_missing_since: null,
            provider_sync_generation: 43,
          },
          {
            id: 'unsafe-stale-row',
            status: 'APPROVED',
            provider_missing_since: null,
            provider_sync_generation: 41,
          },
        ],
        42
      )
    ).toEqual(['unsafe-stale-row']);
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
      buildSyncedTemplateRow(base, 'account-1', 'user-1', 42).parameter_format
    ).toBeNull();
    expect(
      buildSyncedTemplateRow(
        { ...base, parameter_format: 'FUTURE_FORMAT' },
        'account-1',
        'user-1',
        42
      ).parameter_format
    ).toBeNull();
  });
});
