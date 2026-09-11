import type { TemplatePayload } from './template-validators';

export type TemplateContractId =
  | 'membership_renewal'
  | 'service_renewal'
  | 'installment_reminder'
  | 'invoice_due'
  | 'invoice_overdue'
  | 'payment_promise_reminder'
  | 'payment_confirmation'
  | 'autopay_recovery_pending'
  | 'autopay_recovery_terminal'
  | 'membership_post_expiry'
  | 'service_post_expiry'
  | 'session_pack_low'
  | 'session_pack_exhausted'
  | 'freeze_return'
  | 'membership_win_back'
  | 'service_win_back'
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
    membership_post_expiry: {
      id: 'membership_post_expiry',
      title: 'Expired membership follow-up',
      blurb: 'Invite a member to renew an expired membership at its current price.',
      purpose: 'Promotes renewal only after a membership cycle has ended.',
      trigger: 'The enabled post-expiry sequence reaches day 1, 3, or 7 after an unchanged membership expiry.',
      category: 'Marketing',
      galleryGroup: 'feature',
      consentScope: 'whatsapp_marketing',
      wired: true,
      parameterLabels: ['Member name', 'Plan name', 'Membership end date', 'Current renewal price'],
      payload: {
        name: 'gym_membership_post_expiry',
        category: 'Marketing',
        language: 'en_US',
        body_text: 'Hi {{1}}, your {{2}} membership ended on {{3}}. You can renew at the current price of {{4}}. Use the buttons below and our team will help.',
        sample_values: { body: ['Rahul', 'Quarterly', '20 Sep 2026', '₹3,999'] },
        footer_text: MARKETING_FOOTER,
        buttons: [
          { type: 'QUICK_REPLY', text: 'Renew membership' },
          { type: 'QUICK_REPLY', text: 'Unsubscribe' },
        ],
      },
    },
    service_post_expiry: {
      id: 'service_post_expiry',
      title: 'Expired service follow-up',
      blurb: 'Invite a member to renew an expired service at its current price.',
      purpose: 'Promotes renewal only after a service cycle has ended.',
      trigger: 'The enabled post-expiry sequence reaches day 1, 3, or 7 after an unchanged service expiry.',
      category: 'Marketing',
      galleryGroup: 'feature',
      consentScope: 'whatsapp_marketing',
      wired: true,
      parameterLabels: ['Member name', 'Service name', 'Service end date', 'Current renewal price'],
      payload: {
        name: 'gym_service_post_expiry',
        category: 'Marketing',
        language: 'en_US',
        body_text: 'Hi {{1}}, your {{2}} service ended on {{3}}. You can renew at the current price of {{4}}. Use the buttons below and our team will help.',
        sample_values: { body: ['Rahul', 'Personal Training', '20 Sep 2026', '₹4,500'] },
        footer_text: MARKETING_FOOTER,
        buttons: [
          { type: 'QUICK_REPLY', text: 'Renew service' },
          { type: 'QUICK_REPLY', text: 'Unsubscribe' },
        ],
      },
    },
    session_pack_low: {
      id: 'session_pack_low', title: 'Low session pack balance',
      blurb: 'Let a member know their current session pack is nearly used.',
      purpose: 'Promotes a future session-pack purchase from current attendance facts only.',
      trigger: 'The enabled lifecycle finds two sessions remaining in an unchanged current session-pack cycle.',
      category: 'Marketing', galleryGroup: 'feature', consentScope: 'whatsapp_marketing', wired: true,
      parameterLabels: ['Member name', 'Plan name', 'Sessions remaining'],
      payload: {
        name: 'gym_session_pack_low', category: 'Marketing', language: 'en_US',
        body_text: 'Hi {{1}}, your {{2}} has {{3}} sessions remaining. Reply here if you would like help choosing your next pack.',
        sample_values: { body: ['Rahul', '10-session pack', '2'] }, footer_text: MARKETING_FOOTER,
        buttons: [{ type: 'QUICK_REPLY', text: 'Ask about packs' }, { type: 'QUICK_REPLY', text: 'Unsubscribe' }],
      },
    },
    session_pack_exhausted: {
      id: 'session_pack_exhausted', title: 'Session pack used',
      blurb: 'Let a member know their current pack has no sessions remaining.',
      purpose: 'Promotes a future session-pack purchase without claiming that check-in is blocked.',
      trigger: 'The enabled lifecycle finds zero sessions remaining in an unchanged current session-pack cycle.',
      category: 'Marketing', galleryGroup: 'feature', consentScope: 'whatsapp_marketing', wired: true,
      parameterLabels: ['Member name', 'Plan name'],
      payload: {
        name: 'gym_session_pack_used', category: 'Marketing', language: 'en_US',
        body_text: 'Hi {{1}}, all sessions in your {{2}} have been used. Reply here if you would like help with your next pack.',
        sample_values: { body: ['Rahul', '10-session pack'] }, footer_text: MARKETING_FOOTER,
        buttons: [{ type: 'QUICK_REPLY', text: 'Ask about packs' }, { type: 'QUICK_REPLY', text: 'Unsubscribe' }],
      },
    },
    freeze_return: {
      id: 'freeze_return', title: 'Planned membership return',
      blurb: 'Remind a frozen member about a staff-recorded planned return date.',
      purpose: 'Updates a member about an explicitly planned return without resuming or changing their membership.',
      trigger: 'One day before an unchanged planned return date on a frozen membership.',
      category: 'Utility', galleryGroup: 'feature', consentScope: 'whatsapp_account_updates', wired: true,
      parameterLabels: ['Member name', 'Planned return date'],
      payload: {
        name: 'gym_membership_return_reminder', category: 'Utility', language: 'en_US',
        body_text: 'Hi {{1}}, your planned return date is {{2}}. Reply here if you would like to discuss your next step with the gym.',
        sample_values: { body: ['Rahul', '20 Sep 2026'] },
      },
    },
    membership_win_back: {
      id: 'membership_win_back', title: 'Membership win-back',
      blurb: 'Invite a former member back with truthful current renewal details.',
      purpose: 'Promotes renewal after the short expiry sequence has ended; it does not invent an offer or discount.',
      trigger: 'The enabled win-back lifecycle reaches day 14, 30, or 60 after an unchanged expired membership.',
      category: 'Marketing', galleryGroup: 'feature', consentScope: 'whatsapp_marketing', wired: true,
      parameterLabels: ['Member name', 'Plan name'],
      payload: {
        name: 'gym_membership_win_back', category: 'Marketing', language: 'en_US',
        body_text: 'Hi {{1}}, you can restart your {{2}} membership. Reply here if you would like help renewing.',
        sample_values: { body: ['Rahul', 'Quarterly'] }, footer_text: MARKETING_FOOTER,
        buttons: [{ type: 'QUICK_REPLY', text: 'Renew membership' }, { type: 'QUICK_REPLY', text: 'Unsubscribe' }],
      },
    },
    service_win_back: {
      id: 'service_win_back', title: 'Service win-back',
      blurb: 'Invite a former service customer back with truthful current pricing.',
      purpose: 'Promotes service renewal after the short expiry sequence has ended; it does not invent an offer or discount.',
      trigger: 'The enabled win-back lifecycle reaches day 14, 30, or 60 after an unchanged expired service.',
      category: 'Marketing', galleryGroup: 'feature', consentScope: 'whatsapp_marketing', wired: true,
      parameterLabels: ['Member name', 'Service name', 'Current renewal price'],
      payload: {
        name: 'gym_service_win_back', category: 'Marketing', language: 'en_US',
        body_text: 'Hi {{1}}, you can renew your {{2}} service at the current price of {{3}}. Reply here if you would like help.',
        sample_values: { body: ['Rahul', 'Personal Training', '₹4,500'] }, footer_text: MARKETING_FOOTER,
        buttons: [{ type: 'QUICK_REPLY', text: 'Renew service' }, { type: 'QUICK_REPLY', text: 'Unsubscribe' }],
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
    invoice_due: {
      id: 'invoice_due',
      title: 'Invoice due reminder',
      blurb: 'Remind a customer about a specific outstanding invoice.',
      purpose:
        'Updates a customer about the actual remaining balance and effective due date of one existing invoice.',
      trigger:
        'The invoice collection lifecycle reaches a configured due milestone for an open invoice.',
      category: 'Utility',
      galleryGroup: 'feature',
      consentScope: 'whatsapp_account_updates',
      wired: true,
      parameterLabels: [
        'Customer name',
        'Invoice reference',
        'Remaining amount',
        'Due date',
      ],
      payload: {
        name: 'gym_invoice_due',
        category: 'Utility',
        language: 'en_US',
        body_text:
          'Hi {{1}}, invoice {{2}} has a remaining balance of {{3}} due on {{4}}. Reply here if you need help with this payment.',
        sample_values: {
          body: ['Rahul', 'INV-1024', '₹2,700', '20 Sep 2026'],
        },
      },
    },
    invoice_overdue: {
      id: 'invoice_overdue',
      title: 'Overdue invoice reminder',
      blurb: 'Follow up on a specific invoice that remains unpaid after its due date.',
      purpose:
        'Updates a customer about the actual remaining balance of one overdue invoice without making an access claim.',
      trigger:
        'The invoice collection lifecycle reaches a configured overdue milestone for an open invoice.',
      category: 'Utility',
      galleryGroup: 'feature',
      consentScope: 'whatsapp_account_updates',
      wired: true,
      parameterLabels: [
        'Customer name',
        'Invoice reference',
        'Remaining amount',
        'Due date',
      ],
      payload: {
        name: 'gym_invoice_overdue',
        category: 'Utility',
        language: 'en_US',
        body_text:
          'Hi {{1}}, invoice {{2}} still has a remaining balance of {{3}} from {{4}}. Reply here if you need help with this payment.',
        sample_values: {
          body: ['Rahul', 'INV-1024', '₹2,700', '20 Sep 2026'],
        },
      },
    },
    payment_promise_reminder: {
      id: 'payment_promise_reminder',
      title: 'Payment promise reminder',
      blurb: 'Remind a customer about the exact amount and date they committed to pay.',
      purpose:
        'Updates a customer about their staff-recorded payment commitment for one existing invoice without implying that payment was received.',
      trigger:
        'The opt-in promise-to-pay lifecycle reaches the day before or the promised payment date.',
      category: 'Utility',
      galleryGroup: 'feature',
      consentScope: 'whatsapp_account_updates',
      wired: true,
      parameterLabels: ['Customer name', 'Invoice reference', 'Promised amount', 'Promised payment date'],
      payload: {
        name: 'gym_payment_promise_reminder',
        category: 'Utility',
        language: 'en_US',
        body_text:
          'Hi {{1}}, this is a reminder of your payment commitment of {{3}} for invoice {{2}} on {{4}}. Reply here if you need help.',
        sample_values: {
          body: ['Rahul', 'INV-1024', '₹2,700', '20 Sep 2026'],
        },
      },
    },
    payment_confirmation: {
      id: 'payment_confirmation',
      title: 'Payment confirmation',
      blurb: 'Confirm a newly committed payment without overstating membership status.',
      purpose: 'Updates a customer about one exact recorded payment and says whether that transaction renewed a membership.',
      trigger: 'A new committed payment is recorded after payment confirmations are enabled.',
      category: 'Utility',
      galleryGroup: 'feature',
      consentScope: 'whatsapp_account_updates',
      wired: true,
      parameterLabels: ['Customer name', 'Amount received', 'Invoice reference', 'Transaction outcome'],
      payload: {
        name: 'gym_payment_confirmation',
        category: 'Utility',
        language: 'en_US',
        body_text: 'Hi {{1}}, we received your payment of {{2}} for invoice {{3}}. {{4}} Reply if any payment detail looks incorrect.',
        sample_values: { body: ['Rahul', '₹2,700', 'INV-1024', 'This payment renewed your membership until 20 Dec 2026.'] },
      },
    },
    autopay_recovery_pending: {
      id: 'autopay_recovery_pending',
      title: 'AutoPay retry update',
      blurb: 'Tell a member that Razorpay is still retrying without asking for a duplicate payment.',
      purpose: 'Updates a customer about an attributable verified AutoPay retry and explicitly avoids a manual payment request.',
      trigger: 'A verified Razorpay subscription.pending event is received after AutoPay recovery is enabled.',
      category: 'Utility',
      galleryGroup: 'feature',
      consentScope: 'whatsapp_account_updates',
      wired: true,
      parameterLabels: ['Customer name', 'Membership reference'],
      payload: {
        name: 'gym_autopay_retry_update', category: 'Utility', language: 'en_US',
        body_text: 'Hi {{1}}, your AutoPay payment for {{2}} is still being processed. No payment is needed from you right now; we will update you if anything changes.',
        sample_values: { body: ['Rahul', 'your membership'] },
      },
    },
    autopay_recovery_terminal: {
      id: 'autopay_recovery_terminal',
      title: 'AutoPay payment help',
      blurb: 'Request help with an unpaid exact obligation only after terminal verified AutoPay recovery.',
      purpose: 'Updates a customer after a terminal verified AutoPay failure when a current collectible obligation remains and no healthy mandate covers it.',
      trigger: 'A verified Razorpay subscription.halted event remains current after balance and mandate checks.',
      category: 'Utility',
      galleryGroup: 'feature',
      consentScope: 'whatsapp_account_updates',
      wired: true,
      parameterLabels: ['Customer name', 'Invoice reference', 'Remaining amount'],
      payload: {
        name: 'gym_autopay_payment_help', category: 'Utility', language: 'en_US',
        body_text: 'Hi {{1}}, AutoPay could not complete invoice {{2}}, which has {{3}} remaining. Reply here and our team will help with the next payment step.',
        sample_values: { body: ['Rahul', 'INV-1024', '₹2,700'] },
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
