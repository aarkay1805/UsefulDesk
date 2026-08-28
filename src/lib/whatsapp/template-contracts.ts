import type { TemplatePayload } from './template-validators';

export type TemplateContractId =
  | 'membership_renewal'
  | 'service_renewal'
  | 'installment_reminder'
  | 'payment_link'
  | 'invoice_document'
  | 'payment_due'
  | 'payment_receipt'
  | 'membership_activation'
  | 'win_back'
  | 'festival_offer';

export type TemplateConsentScope =
  'whatsapp_account_updates' | 'whatsapp_marketing';

export type TemplateGalleryGroup = 'feature' | 'account_update' | 'marketing';

export interface TemplateContract {
  id: TemplateContractId;
  title: string;
  blurb: string;
  purpose: string;
  trigger: string;
  category: 'Utility' | 'Marketing';
  galleryGroup: TemplateGalleryGroup;
  consentScope: TemplateConsentScope;
  wired: boolean;
  parameterLabels: string[];
  payload: TemplatePayload;
}

const MARKETING_FOOTER = 'Tap Unsubscribe to stop promotional messages.';
const INTERESTED_BUTTONS = [
  { type: 'QUICK_REPLY' as const, text: "I'm interested" },
  { type: 'QUICK_REPLY' as const, text: 'Unsubscribe' },
];

export const TEMPLATE_CONTRACTS: Record<TemplateContractId, TemplateContract> =
  {
    membership_renewal: {
      id: 'membership_renewal',
      title: 'Membership renewal',
      blurb: 'Invite an existing member to continue an ending membership.',
      purpose:
        'Promotes the future purchase of a renewed gym membership for an existing member.',
      trigger:
        'You tap Remind on a member, or the membership-renewal reminder runs for an ending membership.',
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
      payload: {
        name: 'gym_membership_renewal',
        category: 'Marketing',
        language: 'en_US',
        body_text:
          'Hi {{1}}, your {{2}} membership ends on {{3}}. Renewing at the current price of {{4}} will continue your membership. Use the buttons below to respond.',
        sample_values: {
          body: ['Rahul', 'Quarterly', '20 Sep 2026', '₹3,999'],
        },
        footer_text: MARKETING_FOOTER,
        buttons: [
          { type: 'QUICK_REPLY', text: 'Renew membership' },
          { type: 'QUICK_REPLY', text: 'Unsubscribe' },
        ],
      },
    },
    service_renewal: {
      id: 'service_renewal',
      title: 'Service renewal',
      blurb: 'Invite a member to continue an ending paid gym service.',
      purpose:
        'Promotes the future purchase of a renewed paid service for an existing member.',
      trigger:
        'You tap Remind on a service, or the service-renewal reminder runs for an ending service.',
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
      payload: {
        name: 'gym_service_renewal',
        category: 'Marketing',
        language: 'en_US',
        body_text:
          'Hi {{1}}, your {{2}} service ends on {{3}}. Renewing at the current price of {{4}} will continue this service. Use the buttons below to respond.',
        sample_values: {
          body: ['Rahul', 'Personal Training', '20 Sep 2026', '₹4,500'],
        },
        footer_text: MARKETING_FOOTER,
        buttons: [
          { type: 'QUICK_REPLY', text: 'Renew service' },
          { type: 'QUICK_REPLY', text: 'Unsubscribe' },
        ],
      },
    },
    installment_reminder: {
      id: 'installment_reminder',
      title: 'Installment reminder',
      blurb: 'Remind a member about an existing joining-payment installment.',
      purpose:
        'Updates a member about an amount and due date from an existing membership transaction.',
      trigger:
        "An installment reminder runs 7, 3, 1, and 0 days before the due date, in your gym's timezone.",
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
      payload: {
        name: 'gym_installment_reminder',
        category: 'Utility',
        language: 'en_US',
        body_text:
          'Hi {{1}}, this is a reminder for your existing {{3}} membership: the remaining installment of {{2}} is due on {{4}}. Reply if you need help with this payment.',
        sample_values: {
          body: ['Rahul', '₹1,600', 'Quarterly', '20 Sep 2026'],
        },
      },
    },
    payment_link: {
      id: 'payment_link',
      title: 'Payment link',
      blurb: 'Send a secure link for an existing open gym invoice.',
      purpose:
        'Requests payment for a specific existing invoice and carries its complete provider payment URL.',
      trigger:
        'You tap Send payment link on an open invoice that can still be collected.',
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
      payload: {
        name: 'gym_payment_link',
        category: 'Utility',
        language: 'en_US',
        body_text:
          'Hi {{1}}, your payment of {{2}} for invoice {{3}} is due. Pay securely using this link: {{4}}. Please contact us if you need help.',
        sample_values: {
          body: ['Rahul', '₹2,700', 'INV-1024', 'https://rzp.io/rzp/abc123'],
        },
      },
    },
    invoice_document: {
      id: 'invoice_document',
      title: 'Invoice document',
      blurb: 'Send the immutable PDF for an existing gym invoice.',
      purpose:
        'Delivers the stable non-tax document for a specific existing invoice.',
      trigger: 'You tap Send on WhatsApp from a saved invoice.',
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
      payload: {
        name: 'gym_invoice_document',
        category: 'Utility',
        language: 'en_US',
        header_type: 'document',
        body_text:
          'Hi {{1}}, here is invoice {{2}} for {{3}} from {{4}}. Please keep this document for your records and reply if any invoice detail looks incorrect.',
        sample_values: {
          body: ['Asha', 'INV-000042', '₹2,500.00', 'FitZone Gym'],
        },
      },
    },
    payment_due: {
      id: 'payment_due',
      title: 'Payment due',
      blurb:
        'Remind a member about an existing outstanding membership balance.',
      purpose:
        'Updates a member about a pending amount tied to an existing membership account.',
      trigger:
        'You send it from the Inbox or a contact, once staff has confirmed the outstanding balance.',
      category: 'Utility',
      galleryGroup: 'account_update',
      consentScope: 'whatsapp_account_updates',
      wired: false,
      parameterLabels: ['Member name', 'Due amount', 'Plan name'],
      payload: {
        name: 'gym_payment_due',
        category: 'Utility',
        language: 'en_US',
        body_text:
          'Hi {{1}}, a payment of {{2}} for your {{3}} membership is still pending. Please clear it to keep your access active. Reply here for a payment link or any help.',
        sample_values: { body: ['Rahul', '₹3,999', 'Quarterly'] },
      },
    },
    payment_receipt: {
      id: 'payment_receipt',
      title: 'Payment receipt',
      blurb: 'Confirm an existing membership payment recorded by gym staff.',
      purpose:
        'Confirms a completed payment and active-until date for an existing membership transaction.',
      trigger:
        'You send it from a contact, right after staff records and checks a membership payment.',
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
      payload: {
        name: 'gym_payment_receipt',
        category: 'Utility',
        language: 'en_US',
        body_text:
          'Hi {{1}}, we received your payment of {{2}} for your existing {{3}} membership. Your membership is active until {{4}}. Reply if any payment detail looks incorrect.',
        sample_values: {
          body: ['Rahul', '₹3,999', 'Quarterly', '20 Dec 2026'],
        },
      },
    },
    membership_activation: {
      id: 'membership_activation',
      title: 'Membership activation',
      blurb: 'Confirm the exact dates of an activated gym membership.',
      purpose:
        'Confirms plan, gym, start date, and end date for an existing activated membership.',
      trigger:
        'You send it from a contact, after checkout creates or activates the membership.',
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
      payload: {
        name: 'gym_membership_activation',
        category: 'Utility',
        language: 'en_US',
        body_text:
          'Hi {{1}}, your {{2}} membership at {{3}} is active from {{4}} until {{5}}. Reply if any membership detail is incorrect.',
        sample_values: {
          body: [
            'Rahul',
            'Quarterly',
            'FitZone Gym',
            '21 Aug 2026',
            '20 Nov 2026',
          ],
        },
      },
    },
    win_back: {
      id: 'win_back',
      title: 'Win back a lapsed member',
      blurb: 'Invite a former member to discuss returning to the gym.',
      purpose:
        'Re-engages a lapsed member and promotes a future membership purchase.',
      trigger:
        'You send it yourself, or as a broadcast, to a Marketing audience you choose.',
      category: 'Marketing',
      galleryGroup: 'marketing',
      consentScope: 'whatsapp_marketing',
      wired: false,
      parameterLabels: [
        'Member name',
        'Gym name',
        'Previous membership end date',
      ],
      payload: {
        name: 'gym_win_back',
        category: 'Marketing',
        language: 'en_US',
        body_text:
          'Hi {{1}}, your membership at {{2}} ended on {{3}}. If you would like to return, use the buttons below and the gym team will help you choose a membership.',
        sample_values: { body: ['Rahul', 'FitZone Gym', '20 Jun 2026'] },
        footer_text: MARKETING_FOOTER,
        buttons: INTERESTED_BUTTONS,
      },
    },
    festival_offer: {
      id: 'festival_offer',
      title: 'Festival offer',
      blurb: 'Promote a time-bound annual-membership campaign.',
      purpose:
        'Promotes a discounted future annual-membership purchase during a named campaign.',
      trigger:
        'You send it yourself, or as a broadcast, to a Marketing audience you choose.',
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
      payload: {
        name: 'gym_festival_offer',
        category: 'Marketing',
        language: 'en_US',
        body_text:
          'Hi {{1}}, {{2}} offer from {{3}}: {{4}} off annual memberships until {{5}}. Use the buttons below if you would like details.',
        sample_values: {
          body: ['Rahul', 'Diwali', 'FitZone Gym', '20%', '10 Nov 2026'],
        },
        footer_text: MARKETING_FOOTER,
        buttons: INTERESTED_BUTTONS,
      },
    },
  };

export const FEATURE_TEMPLATE_CONTRACTS = Object.values(
  TEMPLATE_CONTRACTS
).filter((contract) => contract.wired);

export function getTemplateContract(
  name: string
): TemplateContract | undefined {
  return Object.values(TEMPLATE_CONTRACTS).find(
    (contract) => contract.payload.name === name
  );
}

export function getTemplateContractById(
  id: string
): TemplateContract | undefined {
  return TEMPLATE_CONTRACTS[id as TemplateContractId];
}
