import { describe, expect, it } from 'vitest';

import {
  ApprovedTemplateCategoryChangeError,
  editCategoryForMeta,
  resolveSubmittedTemplateCategory,
  shouldDeleteTemplateFromMeta,
} from './template-lifecycle-policy';

describe('resolveSubmittedTemplateCategory', () => {
  it('persists Meta reclassification instead of the requested category', () => {
    expect(resolveSubmittedTemplateCategory('Utility', 'MARKETING')).toEqual({
      category: 'Marketing',
      categoryChanged: true,
      warning:
        'Meta returned Marketing for the requested Utility template. The template remains not ready for any UsefulDesk feature that requires Utility; sync after review before sending.',
    });
  });

  it('uses the requested category only when Meta omits category', () => {
    expect(resolveSubmittedTemplateCategory('Utility', undefined)).toEqual({
      category: 'Utility',
      categoryChanged: false,
      warning: null,
    });
  });

  it('does not invent a local value for an unknown provider category', () => {
    expect(() =>
      resolveSubmittedTemplateCategory('Utility', 'FUTURE_CATEGORY')
    ).toThrow('Meta returned unsupported template category FUTURE_CATEGORY.');
  });
});

describe('editCategoryForMeta', () => {
  it('omits category for an Approved component edit', () => {
    expect(editCategoryForMeta('APPROVED', 'Utility', 'Utility')).toBe(
      undefined
    );
  });

  it('rejects an Approved category change before a provider mutation', () => {
    expect(() =>
      editCategoryForMeta('APPROVED', 'Utility', 'Marketing')
    ).toThrow(ApprovedTemplateCategoryChangeError);
    try {
      editCategoryForMeta('APPROVED', 'Utility', 'Marketing');
    } catch (error) {
      expect(error).toMatchObject({ code: 'approved_category_immutable' });
    }
  });

  it('includes the requested category for a Rejected or Paused template', () => {
    expect(editCategoryForMeta('REJECTED', 'Utility', 'Marketing')).toBe(
      'MARKETING'
    );
    expect(editCategoryForMeta('PAUSED', 'Marketing', 'Utility')).toBe(
      'UTILITY'
    );
  });
});

describe('shouldDeleteTemplateFromMeta', () => {
  it('skips Meta for a template already proven missing from the provider', () => {
    expect(
      shouldDeleteTemplateFromMeta(
        {
          metaTemplateId: 'meta-1',
          providerMissingSince: '2026-08-22T00:00:00.000Z',
        },
        false
      )
    ).toBe(false);
  });

  it('calls Meta only for a current provider row outside dry-run mode', () => {
    expect(
      shouldDeleteTemplateFromMeta(
        { metaTemplateId: 'meta-1', providerMissingSince: null },
        false
      )
    ).toBe(true);
    expect(
      shouldDeleteTemplateFromMeta(
        { metaTemplateId: 'meta-1', providerMissingSince: null },
        true
      )
    ).toBe(false);
    expect(
      shouldDeleteTemplateFromMeta(
        { metaTemplateId: null, providerMissingSince: null },
        false
      )
    ).toBe(false);
  });
});
