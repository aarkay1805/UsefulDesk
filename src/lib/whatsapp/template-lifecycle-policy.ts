import type { MessageTemplate } from '@/types';
import type { MetaTemplateSubmitPayload } from './template-components';

type TemplateCategory = MessageTemplate['category'];

const META_TO_LOCAL: Record<string, TemplateCategory> = {
  MARKETING: 'Marketing',
  UTILITY: 'Utility',
  AUTHENTICATION: 'Authentication',
};

const LOCAL_TO_META: Record<
  TemplateCategory,
  MetaTemplateSubmitPayload['category']
> = {
  Marketing: 'MARKETING',
  Utility: 'UTILITY',
  Authentication: 'AUTHENTICATION',
};

export function resolveSubmittedTemplateCategory(
  requested: TemplateCategory,
  returned: string | undefined
): {
  category: TemplateCategory;
  categoryChanged: boolean;
  warning: string | null;
} {
  if (!returned) {
    return { category: requested, categoryChanged: false, warning: null };
  }
  const normalized = returned.toUpperCase();
  const category = META_TO_LOCAL[normalized];
  if (!category) {
    throw new Error(`Meta returned unsupported template category ${returned}.`);
  }
  if (category === requested) {
    return { category, categoryChanged: false, warning: null };
  }
  return {
    category,
    categoryChanged: true,
    warning: `Meta returned ${category} for the requested ${requested} template. The template remains not ready for any UsefulDesk feature that requires ${requested}; sync after review before sending.`,
  };
}

export class ApprovedTemplateCategoryChangeError extends Error {
  readonly code = 'approved_category_immutable';

  constructor(existing: TemplateCategory, requested: TemplateCategory) {
    super(
      `Approved template category cannot be changed from ${existing} to ${requested}. Meta requires a new template submission for a different category.`
    );
    this.name = 'ApprovedTemplateCategoryChangeError';
  }
}

export function editCategoryForMeta(
  status: string,
  existing: TemplateCategory,
  requested: TemplateCategory
): MetaTemplateSubmitPayload['category'] | undefined {
  if (status === 'APPROVED') {
    if (requested !== existing) {
      throw new ApprovedTemplateCategoryChangeError(existing, requested);
    }
    return undefined;
  }
  return LOCAL_TO_META[requested];
}

export function shouldDeleteTemplateFromMeta(
  template: {
    metaTemplateId: string | null;
    providerMissingSince: string | null;
  },
  dryRun: boolean
): boolean {
  return Boolean(
    template.metaTemplateId && !template.providerMissingSince && !dryRun
  );
}
