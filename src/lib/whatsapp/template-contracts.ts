import type { TemplatePayload } from './template-validators';

export type TemplateContractId =
  | 'membership_renewal'
  | 'service_renewal'
  | 'installment_reminder'
  | 'invoice_due'
  | 'invoice_overdue'
  | 'payment_promise_upcoming'
  | 'payment_promise_missed'
  | 'payment_confirmation'
  | 'payment_membership_renewal_confirmation'
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

const INTERESTED_BUTTONS = [
  { type: 'QUICK_REPLY' as const, text: "I'm interested" },
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
        'Legal business name',
      ],
      payload: {
        name: 'gym_membership_renewal',
        category: 'Marketing',
        language: 'en_US',
        body_text:
          'Hi {{1}}, your {{2}} membership ends on {{3}}. The current renewal price is {{4}}. Reply using the button if you would like help renewing. This message is from {{5}} about your membership renewal.',
        sample_values: {
          body: [
            'Rahul',
            'Quarterly',
            '20 Sep 2026',
            '₹3,999',
            'FitZone Wellness Private Limited',
          ],
        },
        buttons: [{ type: 'QUICK_REPLY', text: 'Help me renew' }],
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
        'Legal business name',
      ],
      payload: {
        name: 'gym_service_renewal',
        category: 'Marketing',
        language: 'en_US',
        body_text:
          'Hi {{1}}, your {{2}} service ends on {{3}}. The current renewal price is {{4}}. Reply using the button if you would like help renewing. This message is from {{5}} about your service renewal.',
        sample_values: {
          body: [
            'Rahul',
            'Personal Training',
            '20 Sep 2026',
            '₹4,500',
            'FitZone Wellness Private Limited',
          ],
        },
        buttons: [{ type: 'QUICK_REPLY', text: 'Help me renew' }],
      },
    },
    membership_post_expiry: {
      id: 'membership_post_expiry',
      title: 'Expired membership follow-up',
      blurb:
        'Invite a member to renew an expired membership at its current price.',
      purpose: 'Promotes renewal only after a membership cycle has ended.',
      trigger:
        'The enabled post-expiry sequence reaches day 1, 3, or 7 after an unchanged membership expiry.',
      category: 'Marketing',
      galleryGroup: 'feature',
      consentScope: 'whatsapp_marketing',
      wired: true,
      parameterLabels: [
        'Member name',
        'Plan name',
        'Membership end date',
        'Current renewal price',
        'Legal business name',
      ],
      payload: {
        name: 'gym_membership_post_expiry',
        category: 'Marketing',
        language: 'en_US',
        body_text:
          'Hi {{1}}, your {{2}} membership ended on {{3}}. The current renewal price is {{4}}. Reply using the button if you would like help renewing. This message is from {{5}} about your expired membership.',
        sample_values: {
          body: [
            'Rahul',
            'Quarterly',
            '20 Sep 2026',
            '₹3,999',
            'FitZone Wellness Private Limited',
          ],
        },
        buttons: [{ type: 'QUICK_REPLY', text: 'Help me renew' }],
      },
    },
    service_post_expiry: {
      id: 'service_post_expiry',
      title: 'Expired service follow-up',
      blurb:
        'Invite a member to renew an expired service at its current price.',
      purpose: 'Promotes renewal only after a service cycle has ended.',
      trigger:
        'The enabled post-expiry sequence reaches day 1, 3, or 7 after an unchanged service expiry.',
      category: 'Marketing',
      galleryGroup: 'feature',
      consentScope: 'whatsapp_marketing',
      wired: true,
      parameterLabels: [
        'Member name',
        'Service name',
        'Service end date',
        'Current renewal price',
        'Legal business name',
      ],
      payload: {
        name: 'gym_service_post_expiry',
        category: 'Marketing',
        language: 'en_US',
        body_text:
          'Hi {{1}}, your {{2}} service ended on {{3}}. The current renewal price is {{4}}. Reply using the button if you would like help renewing. This message is from {{5}} about your expired service.',
        sample_values: {
          body: [
            'Rahul',
            'Personal Training',
            '20 Sep 2026',
            '₹4,500',
            'FitZone Wellness Private Limited',
          ],
        },
        buttons: [{ type: 'QUICK_REPLY', text: 'Help me renew' }],
      },
    },
    session_pack_low: {
      id: 'session_pack_low',
      title: 'Low session pack balance',
      blurb: 'Let a member know their current session pack is nearly used.',
      purpose:
        'Promotes a future session-pack purchase from current attendance facts only.',
      trigger:
        'The enabled lifecycle finds two sessions remaining in an unchanged current session-pack cycle.',
      category: 'Marketing',
      galleryGroup: 'feature',
      consentScope: 'whatsapp_marketing',
      wired: true,
      parameterLabels: [
        'Member name',
        'Plan name',
        'Sessions remaining',
        'Legal business name',
      ],
      payload: {
        name: 'gym_session_pack_low',
        category: 'Marketing',
        language: 'en_US',
        body_text:
          'Hi {{1}}, your {{2}} has {{3}} sessions remaining. Reply using the button if you would like help with your next pack. This message is from {{4}} about your remaining sessions.',
        sample_values: {
          body: [
            'Rahul',
            '10-session pack',
            '2',
            'FitZone Wellness Private Limited',
          ],
        },
        buttons: [{ type: 'QUICK_REPLY', text: 'Ask about packs' }],
      },
    },
    session_pack_exhausted: {
      id: 'session_pack_exhausted',
      title: 'Session pack used',
      blurb: 'Let a member know their current pack has no sessions remaining.',
      purpose:
        'Promotes a future session-pack purchase without claiming that check-in is blocked.',
      trigger:
        'The enabled lifecycle finds zero sessions remaining in an unchanged current session-pack cycle.',
      category: 'Marketing',
      galleryGroup: 'feature',
      consentScope: 'whatsapp_marketing',
      wired: true,
      parameterLabels: ['Member name', 'Plan name', 'Legal business name'],
      payload: {
        name: 'gym_session_pack_used',
        category: 'Marketing',
        language: 'en_US',
        body_text:
          'Hi {{1}}, all sessions in your {{2}} have been used. Reply using the button if you would like help with your next pack. This message is from {{3}} about your used session pack.',
        sample_values: {
          body: [
            'Rahul',
            '10-session pack',
            'FitZone Wellness Private Limited',
          ],
        },
        buttons: [{ type: 'QUICK_REPLY', text: 'Ask about packs' }],
      },
    },
    freeze_return: {
      id: 'freeze_return',
      title: 'Planned membership return',
      blurb:
        'Remind a frozen member about a staff-recorded planned return date.',
      purpose:
        'Updates a member about an explicitly planned return without resuming or changing their membership.',
      trigger:
        'One day before an unchanged planned return date on a frozen membership.',
      category: 'Utility',
      galleryGroup: 'feature',
      consentScope: 'whatsapp_account_updates',
      wired: true,
      parameterLabels: [
        'Member name',
        'Planned return date',
        'Legal business name',
      ],
      payload: {
        name: 'gym_membership_return_reminder',
        category: 'Utility',
        language: 'en_US',
        body_text:
          'Hi {{1}}, your planned return date is {{2}}. Reply here if you need to update it. This message is from {{3}} about your planned return.',
        sample_values: {
          body: ['Rahul', '20 Sep 2026', 'FitZone Wellness Private Limited'],
        },
      },
    },
    membership_win_back: {
      id: 'membership_win_back',
      title: 'Membership win-back',
      blurb:
        'Invite a former member back with truthful current renewal details.',
      purpose:
        'Promotes renewal after the short expiry sequence has ended; it does not invent an offer or discount.',
      trigger:
        'The enabled win-back lifecycle reaches day 14, 30, or 60 after an unchanged expired membership.',
      category: 'Marketing',
      galleryGroup: 'feature',
      consentScope: 'whatsapp_marketing',
      wired: true,
      parameterLabels: ['Member name', 'Plan name', 'Legal business name'],
      payload: {
        name: 'gym_membership_win_back',
        category: 'Marketing',
        language: 'en_US',
        body_text:
          'Hi {{1}}, you can restart your {{2}} membership. Reply using the button if you would like help renewing. This message is from {{3}} about restarting your membership.',
        sample_values: {
          body: ['Rahul', 'Quarterly', 'FitZone Wellness Private Limited'],
        },
        buttons: [{ type: 'QUICK_REPLY', text: 'Help me renew' }],
      },
    },
    service_win_back: {
      id: 'service_win_back',
      title: 'Service win-back',
      blurb:
        'Invite a former service customer back with truthful current pricing.',
      purpose:
        'Promotes service renewal after the short expiry sequence has ended; it does not invent an offer or discount.',
      trigger:
        'The enabled win-back lifecycle reaches day 14, 30, or 60 after an unchanged expired service.',
      category: 'Marketing',
      galleryGroup: 'feature',
      consentScope: 'whatsapp_marketing',
      wired: true,
      parameterLabels: [
        'Member name',
        'Service name',
        'Current renewal price',
        'Legal business name',
      ],
      payload: {
        name: 'gym_service_win_back',
        category: 'Marketing',
        language: 'en_US',
        body_text:
          'Hi {{1}}, you can renew your {{2}} service at the current price of {{3}}. Reply using the button if you would like help renewing. This message is from {{4}} about renewing your service.',
        sample_values: {
          body: [
            'Rahul',
            'Personal Training',
            '₹4,500',
            'FitZone Wellness Private Limited',
          ],
        },
        buttons: [{ type: 'QUICK_REPLY', text: 'Help me renew' }],
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
        'Legal business name',
      ],
      payload: {
        name: 'gym_installment_reminder',
        category: 'Utility',
        language: 'en_US',
        body_text:
          'Hi {{1}}, the remaining installment of {{2}} for your {{3}} membership is due on {{4}}. Reply if you need help with this payment. This message is from {{5}} about your remaining installment.',
        sample_values: {
          body: [
            'Rahul',
            '₹1,600',
            'Quarterly',
            '20 Sep 2026',
            'FitZone Wellness Private Limited',
          ],
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
        'Legal business name',
      ],
      payload: {
        name: 'gym_invoice_due',
        category: 'Utility',
        language: 'en_US',
        body_text:
          'Hi {{1}}, invoice {{2}} has a remaining balance of {{3}} due on {{4}}. Reply if you need help with this payment. This message is from {{5}} about your invoice balance.',
        sample_values: {
          body: [
            'Rahul',
            'INV-1024',
            '₹2,700',
            '20 Sep 2026',
            'FitZone Wellness Private Limited',
          ],
        },
      },
    },
    invoice_overdue: {
      id: 'invoice_overdue',
      title: 'Overdue invoice reminder',
      blurb:
        'Follow up on a specific invoice that remains unpaid after its due date.',
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
        'Legal business name',
      ],
      payload: {
        name: 'gym_invoice_overdue',
        category: 'Utility',
        language: 'en_US',
        body_text:
          'Hi {{1}}, invoice {{2}} still has a remaining balance of {{3}} that was due on {{4}}. Reply if you need help with this payment. This message is from {{5}} about your overdue invoice.',
        sample_values: {
          body: [
            'Rahul',
            'INV-1024',
            '₹2,700',
            '20 Sep 2026',
            'FitZone Wellness Private Limited',
          ],
        },
      },
    },
    payment_promise_upcoming: {
      id: 'payment_promise_upcoming',
      title: 'Upcoming promised payment',
      blurb:
        'Remind a customer about the exact amount and date they committed to pay.',
      purpose:
        'Updates a customer about their staff-recorded payment commitment for one existing invoice without implying that payment was received.',
      trigger:
        'The opt-in promise-to-pay lifecycle reaches the day before or the promised payment date.',
      category: 'Utility',
      galleryGroup: 'feature',
      consentScope: 'whatsapp_account_updates',
      wired: true,
      parameterLabels: [
        'Customer name',
        'Invoice reference',
        'Promised amount',
        'Promised payment date',
        'Legal business name',
      ],
      payload: {
        name: 'gym_payment_promise_upcoming',
        category: 'Utility',
        language: 'en_US',
        body_text:
          'Hi {{1}}, this is a reminder that you planned to pay {{3}} for invoice {{2}} on {{4}}. Reply if you need help. This message is from {{5}} about your planned invoice payment.',
        sample_values: {
          body: [
            'Rahul',
            'INV-1024',
            '₹2,700',
            '20 Sep 2026',
            'FitZone Wellness Private Limited',
          ],
        },
      },
    },
    payment_promise_missed: {
      id: 'payment_promise_missed',
      title: 'Missed promised payment',
      blurb:
        'Follow up after a promised payment date passes while the invoice remains unpaid.',
      purpose:
        'Updates a customer about a missed staff-recorded payment commitment without claiming a failed payment attempt.',
      trigger:
        'The opt-in promise-to-pay lifecycle reaches the day after the promised payment date and the balance remains unpaid.',
      category: 'Utility',
      galleryGroup: 'feature',
      consentScope: 'whatsapp_account_updates',
      wired: true,
      parameterLabels: [
        'Customer name',
        'Invoice reference',
        'Promised amount',
        'Promised payment date',
        'Legal business name',
      ],
      payload: {
        name: 'gym_payment_promise_missed',
        category: 'Utility',
        language: 'en_US',
        body_text:
          'Hi {{1}}, the planned payment date of {{4}} for {{3}} on invoice {{2}} has passed, and the balance remains unpaid. Reply if you need help. This message is from {{5}} about your missed payment date.',
        sample_values: {
          body: [
            'Rahul',
            'INV-1024',
            '₹2,700',
            '20 Sep 2026',
            'FitZone Wellness Private Limited',
          ],
        },
      },
    },
    payment_confirmation: {
      id: 'payment_confirmation',
      title: 'Payment confirmation',
      blurb:
        'Confirm a newly committed payment without overstating membership status.',
      purpose:
        'Updates a customer about one exact recorded payment without implying a membership renewal.',
      trigger:
        'A new committed payment is recorded after payment confirmations are enabled.',
      category: 'Utility',
      galleryGroup: 'feature',
      consentScope: 'whatsapp_account_updates',
      wired: true,
      parameterLabels: [
        'Customer name',
        'Amount received',
        'Invoice reference',
        'Legal business name',
      ],
      payload: {
        name: 'gym_payment_confirmation',
        category: 'Utility',
        language: 'en_US',
        body_text:
          'Hi {{1}}, we received {{2}} for invoice {{3}}. Reply if any payment detail looks incorrect. This message is from {{4}} about your recorded invoice payment.',
        sample_values: {
          body: [
            'Rahul',
            '₹2,700',
            'INV-1024',
            'FitZone Wellness Private Limited',
          ],
        },
      },
    },
    payment_membership_renewal_confirmation: {
      id: 'payment_membership_renewal_confirmation',
      title: 'Payment and membership renewal confirmation',
      blurb: 'Confirm a payment that also renewed the customer’s membership.',
      purpose:
        'Updates a customer about one exact recorded payment and the membership end date produced by that renewal.',
      trigger:
        'A newly committed payment is tied to a confirmed membership-renewal operation.',
      category: 'Utility',
      galleryGroup: 'feature',
      consentScope: 'whatsapp_account_updates',
      wired: true,
      parameterLabels: [
        'Customer name',
        'Amount received',
        'Invoice reference',
        'Membership end date',
        'Legal business name',
      ],
      payload: {
        name: 'gym_payment_membership_renewal_confirmation',
        category: 'Utility',
        language: 'en_US',
        body_text:
          'Hi {{1}}, we received {{2}} for invoice {{3}} and renewed your membership until {{4}}. Reply if any payment detail looks incorrect. This message is from {{5}} about your payment and membership renewal.',
        sample_values: {
          body: [
            'Rahul',
            '₹2,700',
            'INV-1024',
            '20 Dec 2026',
            'FitZone Wellness Private Limited',
          ],
        },
      },
    },
    autopay_recovery_pending: {
      id: 'autopay_recovery_pending',
      title: 'AutoPay retry update',
      blurb:
        'Tell a member that Razorpay is still retrying without asking for a duplicate payment.',
      purpose:
        'Updates a customer about an attributable verified AutoPay retry and explicitly avoids a manual payment request.',
      trigger:
        'A verified Razorpay subscription.pending event is received after AutoPay recovery is enabled.',
      category: 'Utility',
      galleryGroup: 'feature',
      consentScope: 'whatsapp_account_updates',
      wired: true,
      parameterLabels: [
        'Customer name',
        'Membership reference',
        'Legal business name',
      ],
      payload: {
        name: 'gym_autopay_retry_update',
        category: 'Utility',
        language: 'en_US',
        body_text:
          'Hi {{1}}, your AutoPay payment for {{2}} is still being processed. No payment is needed from you now. This message is from {{3}} about your AutoPay retry.',
        sample_values: {
          body: [
            'Rahul',
            'your membership',
            'FitZone Wellness Private Limited',
          ],
        },
      },
    },
    autopay_recovery_terminal: {
      id: 'autopay_recovery_terminal',
      title: 'AutoPay payment help',
      blurb:
        'Request help with an unpaid exact obligation only after terminal verified AutoPay recovery.',
      purpose:
        'Updates a customer after a terminal verified AutoPay failure when a current collectible obligation remains and no healthy mandate covers it.',
      trigger:
        'A verified Razorpay subscription.halted event remains current after balance and mandate checks.',
      category: 'Utility',
      galleryGroup: 'feature',
      consentScope: 'whatsapp_account_updates',
      wired: true,
      parameterLabels: [
        'Customer name',
        'Invoice reference',
        'Remaining amount',
        'Legal business name',
      ],
      payload: {
        name: 'gym_autopay_payment_help',
        category: 'Utility',
        language: 'en_US',
        body_text:
          'Hi {{1}}, AutoPay could not complete invoice {{2}}, which has {{3}} remaining. Reply for help with the next payment step. This message is from {{4}} about your unpaid AutoPay invoice.',
        sample_values: {
          body: [
            'Rahul',
            'INV-1024',
            '₹2,700',
            'FitZone Wellness Private Limited',
          ],
        },
      },
    },
    payment_link: {
      id: 'payment_link',
      title: 'Payment link',
      blurb: 'Send a secure link for an existing open gym invoice.',
      purpose:
        'Requests payment for a specific existing invoice through a provider-hosted dynamic URL button.',
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
        'Payment link expiry',
        'Legal business name',
      ],
      payload: {
        name: 'gym_payment_link',
        category: 'Utility',
        language: 'en_US',
        body_text:
          'Hi {{1}}, {{2}} is due for invoice {{3}}. The payment link expires on {{4}}. Use the button below to pay. This message is from {{5}} about your invoice payment link.',
        sample_values: {
          body: [
            'Rahul',
            '₹2,700',
            'INV-1024',
            '20 Sep 2026, 6:00 pm',
            'FitZone Wellness Private Limited',
          ],
        },
        buttons: [
          {
            type: 'URL',
            text: 'Pay invoice',
            url: 'https://rzp.io/{{1}}',
            example: 'i/abc123',
          },
        ],
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
        'Legal business name',
      ],
      payload: {
        name: 'gym_invoice_document',
        category: 'Utility',
        language: 'en_US',
        header_type: 'document',
        body_text:
          'Hi {{1}}, here is invoice {{2}} for {{3}} from {{4}}. Please keep this document for your records and reply if any invoice detail looks incorrect.',
        sample_values: {
          body: [
            'Asha',
            'INV-000042',
            '₹2,500.00',
            'FitZone Wellness Private Limited',
          ],
        },
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
          'Hi {{1}}, {{2}} offer from {{3}}: {{4}} off annual memberships until {{5}}. Use the button below if you would like details.',
        sample_values: {
          body: ['Rahul', 'Diwali', 'FitZone Gym', '20%', '10 Nov 2026'],
        },
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
