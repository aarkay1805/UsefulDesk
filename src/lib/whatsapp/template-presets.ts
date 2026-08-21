import type { TemplateButton } from '@/types';
import {
  TEMPLATE_CONTRACTS,
  type TemplateConsentScope,
  type TemplateGalleryGroup,
} from './template-contracts';

export interface TemplatePreset {
  id: string;
  title: string;
  blurb: string;
  category: 'Utility' | 'Marketing';
  note: string;
  pinned: boolean;
  galleryGroup: TemplateGalleryGroup;
  consentScope: TemplateConsentScope;
  trigger: string;
  parameterLabels: string[];
  wired: boolean;
  fields: {
    name: string;
    category: 'Utility' | 'Marketing';
    header_format: 'none' | 'text';
    header_content?: string;
    header_sample?: string;
    body_text: string;
    body_samples: string[];
    footer_text?: string;
    buttons?: TemplateButton[];
  };
}

export const TEMPLATE_PRESETS: TemplatePreset[] = Object.values(
  TEMPLATE_CONTRACTS
).map((contract) => ({
  id: contract.id,
  title: contract.title,
  blurb: contract.blurb,
  category: contract.category,
  note: `${contract.purpose} Requires recorded ${
    contract.consentScope === 'whatsapp_marketing'
      ? 'Marketing'
      : 'account-update'
  } WhatsApp opt-in. Submission starts Meta review; approval and recipient delivery are not guaranteed.`,
  pinned: contract.wired,
  galleryGroup: contract.galleryGroup,
  consentScope: contract.consentScope,
  trigger: contract.trigger,
  parameterLabels: contract.parameterLabels,
  wired: contract.wired,
  fields: {
    name: contract.payload.name,
    category: contract.category,
    header_format: contract.payload.header_type === 'text' ? 'text' : 'none',
    header_content: contract.payload.header_content,
    header_sample: contract.payload.sample_values?.header?.[0],
    body_text: contract.payload.body_text,
    body_samples: contract.payload.sample_values?.body ?? [],
    footer_text: contract.payload.footer_text,
    buttons: contract.payload.buttons,
  },
}));
