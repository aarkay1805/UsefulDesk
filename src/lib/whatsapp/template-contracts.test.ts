import { describe, expect, it } from 'vitest';

import { buildMetaTemplatePayload } from './template-components';
import {
  FEATURE_TEMPLATE_CONTRACTS,
  TEMPLATE_CONTRACTS,
  getTemplateContract,
  getTemplateContractById,
} from './template-contracts';

const marketingFooter = 'Tap Unsubscribe to stop promotional messages.';

const expected = [
  {
    id: 'membership_renewal',
    name: 'gym_membership_renewal',
    title: 'Membership renewal',
    category: 'Marketing',
    galleryGroup: 'feature',
    consentScope: 'whatsapp_marketing',
    wired: true,
    parameterLabels: [
      'Member name',
      'Plan name',
      'Membership end date',
      'Current renewal price',
    ],
    samples: ['Rahul', 'Quarterly', '20 Sep 2026', '₹3,999'],
    body: 'Hi {{1}}, your {{2}} membership ends on {{3}}. Renewing at the current price of {{4}} will continue your membership. Use the buttons below to respond.',
    footer: marketingFooter,
    buttons: [
      { type: 'QUICK_REPLY', text: 'Renew membership' },
      { type: 'QUICK_REPLY', text: 'Unsubscribe' },
    ],
  },
  {
    id: 'service_renewal',
    name: 'gym_service_renewal',
    title: 'Service renewal',
    category: 'Marketing',
    galleryGroup: 'feature',
    consentScope: 'whatsapp_marketing',
    wired: true,
    parameterLabels: [
      'Member name',
      'Service name',
      'Service end date',
      'Current renewal price',
    ],
    samples: ['Rahul', 'Personal Training', '20 Sep 2026', '₹4,500'],
    body: 'Hi {{1}}, your {{2}} service ends on {{3}}. Renewing at the current price of {{4}} will continue this service. Use the buttons below to respond.',
    footer: marketingFooter,
    buttons: [
      { type: 'QUICK_REPLY', text: 'Renew service' },
      { type: 'QUICK_REPLY', text: 'Unsubscribe' },
    ],
  },
  {
    id: 'installment_reminder',
    name: 'gym_installment_reminder',
    title: 'Installment reminder',
    category: 'Utility',
    galleryGroup: 'feature',
    consentScope: 'whatsapp_account_updates',
    wired: true,
    parameterLabels: [
      'Member name',
      'Remaining installment amount',
      'Plan name',
      'Installment due date',
    ],
    samples: ['Rahul', '₹1,600', 'Quarterly', '20 Sep 2026'],
    body: 'Hi {{1}}, this is a reminder for your existing {{3}} membership: the remaining installment of {{2}} is due on {{4}}. Reply if you need help with this payment.',
  },
  {
    id: 'payment_link',
    name: 'gym_payment_link',
    title: 'Payment link',
    category: 'Utility',
    galleryGroup: 'feature',
    consentScope: 'whatsapp_account_updates',
    wired: true,
    parameterLabels: [
      'Member name',
      'Outstanding amount',
      'Invoice reference',
      'Complete payment URL',
    ],
    samples: ['Rahul', '₹2,700', 'INV-1024', 'https://rzp.io/rzp/abc123'],
    body: 'Hi {{1}}, your payment of {{2}} for invoice {{3}} is due. Pay securely using this link: {{4}}. Please contact us if you need help.',
  },
  {
    id: 'invoice_document',
    name: 'gym_invoice_document',
    title: 'Invoice document',
    category: 'Utility',
    galleryGroup: 'feature',
    consentScope: 'whatsapp_account_updates',
    wired: true,
    parameterLabels: [
      'Customer name',
      'Invoice number',
      'Invoice total',
      'Business name',
    ],
    samples: ['Asha', 'INV-000042', '₹2,500.00', 'FitZone Gym'],
    body: 'Hi {{1}}, here is invoice {{2}} for {{3}} from {{4}}. Please keep this document for your records and reply if any invoice detail looks incorrect.',
    headerType: 'document',
  },
  {
    id: 'payment_due',
    name: 'gym_payment_due',
    title: 'Payment due',
    category: 'Utility',
    galleryGroup: 'account_update',
    consentScope: 'whatsapp_account_updates',
    wired: false,
    parameterLabels: ['Member name', 'Due amount', 'Plan name'],
    samples: ['Rahul', '₹3,999', 'Quarterly'],
    body: 'Hi {{1}}, a payment of {{2}} for your {{3}} membership is still pending. Please clear it to keep your access active. Reply here for a payment link or any help.',
  },
  {
    id: 'payment_receipt',
    name: 'gym_payment_receipt',
    title: 'Payment receipt',
    category: 'Utility',
    galleryGroup: 'account_update',
    consentScope: 'whatsapp_account_updates',
    wired: false,
    parameterLabels: [
      'Member name',
      'Amount received',
      'Plan name',
      'Active-until date',
    ],
    samples: ['Rahul', '₹3,999', 'Quarterly', '20 Dec 2026'],
    body: 'Hi {{1}}, we received your payment of {{2}} for your existing {{3}} membership. Your membership is active until {{4}}. Reply if any payment detail looks incorrect.',
  },
  {
    id: 'membership_activation',
    name: 'gym_membership_activation',
    title: 'Membership activation',
    category: 'Utility',
    galleryGroup: 'account_update',
    consentScope: 'whatsapp_account_updates',
    wired: false,
    parameterLabels: [
      'Member name',
      'Plan name',
      'Gym name',
      'Start date',
      'End date',
    ],
    samples: [
      'Rahul',
      'Quarterly',
      'FitZone Gym',
      '21 Aug 2026',
      '20 Nov 2026',
    ],
    body: 'Hi {{1}}, your {{2}} membership at {{3}} is active from {{4}} until {{5}}. Reply if any membership detail is incorrect.',
  },
  {
    id: 'win_back',
    name: 'gym_win_back',
    title: 'Win back a lapsed member',
    category: 'Marketing',
    galleryGroup: 'marketing',
    consentScope: 'whatsapp_marketing',
    wired: false,
    parameterLabels: [
      'Member name',
      'Gym name',
      'Previous membership end date',
    ],
    samples: ['Rahul', 'FitZone Gym', '20 Jun 2026'],
    body: 'Hi {{1}}, your membership at {{2}} ended on {{3}}. If you would like to return, use the buttons below and the gym team will help you choose a membership.',
    footer: marketingFooter,
    buttons: [
      { type: 'QUICK_REPLY', text: "I'm interested" },
      { type: 'QUICK_REPLY', text: 'Unsubscribe' },
    ],
  },
  {
    id: 'festival_offer',
    name: 'gym_festival_offer',
    title: 'Festival offer',
    category: 'Marketing',
    galleryGroup: 'marketing',
    consentScope: 'whatsapp_marketing',
    wired: false,
    parameterLabels: [
      'Member name',
      'Festival or campaign',
      'Gym name',
      'Discount',
      'Offer end date',
    ],
    samples: ['Rahul', 'Diwali', 'FitZone Gym', '20%', '10 Nov 2026'],
    body: 'Hi {{1}}, {{2}} offer from {{3}}: {{4}} off annual memberships until {{5}}. Use the buttons below if you would like details.',
    footer: marketingFooter,
    buttons: [
      { type: 'QUICK_REPLY', text: "I'm interested" },
      { type: 'QUICK_REPLY', text: 'Unsubscribe' },
    ],
  },
] as const;

describe('gym WhatsApp template contracts', () => {
  it('defines every exact operational payload and policy classification', () => {
    expect(Object.keys(TEMPLATE_CONTRACTS)).toHaveLength(10);

    for (const wanted of expected) {
      const contract = getTemplateContractById(wanted.id);
      expect(contract).toBeDefined();
      expect(contract).toMatchObject({
        id: wanted.id,
        title: wanted.title,
        category: wanted.category,
        galleryGroup: wanted.galleryGroup,
        consentScope: wanted.consentScope,
        wired: wanted.wired,
        parameterLabels: wanted.parameterLabels,
        payload: {
          name: wanted.name,
          category: wanted.category,
          language: 'en_US',
          body_text: wanted.body,
          sample_values: { body: wanted.samples },
        },
      });
      expect(contract?.payload.footer_text).toBe(
        'footer' in wanted ? wanted.footer : undefined
      );
      expect(contract?.payload.buttons).toEqual(
        'buttons' in wanted ? wanted.buttons : undefined
      );
      expect(contract?.payload.header_type).toBe(
        'headerType' in wanted ? wanted.headerType : undefined
      );
      expect(contract?.purpose.length).toBeGreaterThan(20);
      expect(contract?.trigger.length).toBeGreaterThan(20);
      expect(getTemplateContract(wanted.name)?.id).toBe(wanted.id);
    }
  });

  it('builds the exact Meta payload for membership renewal', () => {
    const contract = getTemplateContractById('membership_renewal');
    expect(contract).toBeDefined();

    expect(buildMetaTemplatePayload(contract!.payload)).toEqual({
      name: 'gym_membership_renewal',
      category: 'MARKETING',
      language: 'en_US',
      components: [
        {
          type: 'BODY',
          text: 'Hi {{1}}, your {{2}} membership ends on {{3}}. Renewing at the current price of {{4}} will continue your membership. Use the buttons below to respond.',
          example: {
            body_text: [['Rahul', 'Quarterly', '20 Sep 2026', '₹3,999']],
          },
        },
        {
          type: 'FOOTER',
          text: 'Tap Unsubscribe to stop promotional messages.',
        },
        {
          type: 'BUTTONS',
          buttons: [
            { type: 'QUICK_REPLY', text: 'Renew membership' },
            { type: 'QUICK_REPLY', text: 'Unsubscribe' },
          ],
        },
      ],
    });
  });

  it('builds the exact Meta payload for service renewal', () => {
    const contract = getTemplateContractById('service_renewal');
    expect(contract).toBeDefined();

    expect(buildMetaTemplatePayload(contract!.payload)).toEqual({
      name: 'gym_service_renewal',
      category: 'MARKETING',
      language: 'en_US',
      components: [
        {
          type: 'BODY',
          text: 'Hi {{1}}, your {{2}} service ends on {{3}}. Renewing at the current price of {{4}} will continue this service. Use the buttons below to respond.',
          example: {
            body_text: [
              ['Rahul', 'Personal Training', '20 Sep 2026', '₹4,500'],
            ],
          },
        },
        {
          type: 'FOOTER',
          text: 'Tap Unsubscribe to stop promotional messages.',
        },
        {
          type: 'BUTTONS',
          buttons: [
            { type: 'QUICK_REPLY', text: 'Renew service' },
            { type: 'QUICK_REPLY', text: 'Unsubscribe' },
          ],
        },
      ],
    });
  });

  it('builds the exact creation payload for the document-header invoice contract without inventing a sample', () => {
    const contract = getTemplateContractById('invoice_document');
    expect(contract).toBeDefined();

    expect(buildMetaTemplatePayload(contract!.payload)).toEqual({
      name: 'gym_invoice_document',
      category: 'UTILITY',
      language: 'en_US',
      components: [
        { type: 'HEADER', format: 'DOCUMENT' },
        {
          type: 'BODY',
          text: 'Hi {{1}}, here is invoice {{2}} for {{3}} from {{4}}. Please keep this document for your records and reply if any invoice detail looks incorrect.',
          example: {
            body_text: [['Asha', 'INV-000042', '₹2,500.00', 'FitZone Gym']],
          },
        },
      ],
    });
  });

  it('identifies only the five templates wired into UsefulDesk features', () => {
    expect(FEATURE_TEMPLATE_CONTRACTS.map((contract) => contract.id)).toEqual([
      'membership_renewal',
      'service_renewal',
      'installment_reminder',
      'payment_link',
      'invoice_document',
    ]);
  });
});
