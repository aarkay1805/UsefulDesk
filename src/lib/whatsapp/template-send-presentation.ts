import type { LocaleFormatters } from '@/lib/locale/format';
import { financeInvoiceReference } from '@/lib/finance/invoices';
import type { MemberService, Membership, MessageTemplate } from '@/types';

import {
  getTemplateContract,
  type TemplateContractId,
} from './template-contracts';

export interface TemplateSendPresentation {
  title: string;
  blurb: string | null;
  parameterLabels: string[];
  contextKind: TemplateContractId | 'legacy_membership_renewal' | null;
  legacy: boolean;
}

const LEGACY_PRESENTATIONS: Record<
  string,
  Omit<TemplateSendPresentation, 'legacy'>
> = {
  gym_renewal_reminder: {
    title: 'Legacy membership renewal',
    blurb:
      'Older provider-approved renewal message. It does not satisfy current reminder readiness.',
    parameterLabels: [
      'Member name',
      'Plan name',
      'Membership end date',
      'Renewal fee',
    ],
    contextKind: 'legacy_membership_renewal',
  },
};

function humanizeTemplateName(name: string): string {
  const words = name
    .replace(/^gym_/, '')
    .replaceAll('_', ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return words ? words[0].toUpperCase() + words.slice(1) : 'WhatsApp template';
}

export function getTemplateSendPresentation(
  template: Pick<MessageTemplate, 'name'>,
  bodyVariableCount: number
): TemplateSendPresentation {
  const contract = getTemplateContract(template.name);
  if (contract) {
    return {
      title: contract.title,
      blurb: contract.blurb,
      parameterLabels: contract.parameterLabels,
      contextKind: contract.id,
      legacy: false,
    };
  }

  const legacy = LEGACY_PRESENTATIONS[template.name];
  if (legacy) return { ...legacy, legacy: true };

  return {
    title: humanizeTemplateName(template.name),
    blurb: null,
    parameterLabels: Array.from(
      { length: bodyVariableCount },
      (_, index) => `Message detail ${index + 1}`
    ),
    contextKind: null,
    legacy: false,
  };
}

export function membershipRenewalDefaults(
  membership: Membership,
  contactName: string | null | undefined,
  fmt: Pick<LocaleFormatters, 'date' | 'money'>
): string[] {
  return [
    contactName?.trim() || membership.contact?.name?.trim() || '',
    membership.plan?.name?.trim() || '',
    fmt.date(membership.end_date),
    fmt.money(membership.fee_amount),
  ];
}

export function paymentDueDefaults(
  membership: Membership,
  contactName: string | null | undefined,
  invoice: {
    id: string;
    collectible_balance: number;
    currency?: string | null;
  },
  fmt: Pick<LocaleFormatters, 'money'>
): string[] {
  return [
    contactName?.trim() || membership.contact?.name?.trim() || '',
    fmt.money(
      Number(invoice.collectible_balance),
      invoice.currency ?? undefined
    ),
    membership.plan?.name?.trim() || '',
  ];
}

export function paymentLinkDefaults(
  membership: Membership,
  contactName: string | null | undefined,
  invoice: {
    id: string;
    collectible_balance: number;
    currency?: string | null;
  },
  shortUrl: string | null | undefined,
  fmt: Pick<LocaleFormatters, 'money'>
): string[] {
  return [
    contactName?.trim() || membership.contact?.name?.trim() || '',
    fmt.money(
      Number(invoice.collectible_balance),
      invoice.currency ?? undefined
    ),
    financeInvoiceReference({ id: invoice.id, invoice_number: null }),
    shortUrl?.trim() || '',
  ];
}

export function serviceRenewalDefaults(
  service: Pick<
    MemberService,
    'item_name_snapshot' | 'end_date' | 'current_renewal_price'
  >,
  contactName: string | null | undefined,
  fmt: Pick<LocaleFormatters, 'date' | 'money'>
): string[] {
  return [
    contactName?.trim() || '',
    service.item_name_snapshot.trim(),
    fmt.date(service.end_date),
    service.current_renewal_price == null
      ? ''
      : fmt.money(Number(service.current_renewal_price)),
  ];
}
