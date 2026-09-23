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

export const TEMPLATE_CONTRACTS: Record<TemplateContractId, TemplateContract> =
  {
    membership_renewal: {
      id: 'membership_renewal',
      title: 'Membership renewal',
      blurb: 'Ask a member to renew a membership that will end soon.',
      purpose:
        'Promotes the future purchase of a renewed gym membership for an existing member.',
      trigger:
        'You tap Remind, or a renewal reminder runs for a membership ending soon.',
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
          'Hi {{1}}, your {{2}} membership ends on {{3}}. Current renewal price: {{4}}. Reply to {{5}} for help renewing.',
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
      blurb: 'Ask a member to renew a paid service that will end soon.',
      purpose:
        'Promotes the future purchase of a renewed paid service for an existing member.',
      trigger:
        'You tap Remind, or a renewal reminder runs for a service ending soon.',
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
          'Hi {{1}}, your {{2}} service ends on {{3}}. Current renewal price: {{4}}. Reply to {{5}} for help renewing.',
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
      blurb: 'Ask a member to renew a membership that has ended.',
      purpose: 'Promotes renewal only after a membership cycle has ended.',
      trigger:
        'An enabled reminder runs 1, 3, or 7 days after a membership ends, if it has not changed.',
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
          'Hi {{1}}, your {{2}} membership ended on {{3}}. Current renewal price: {{4}}. Reply to {{5}} for help renewing.',
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
      blurb: 'Ask a member to renew a service that has ended.',
      purpose: 'Promotes renewal only after a service cycle has ended.',
      trigger:
        'An enabled reminder runs 1, 3, or 7 days after a service ends, if it has not changed.',
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
          'Hi {{1}}, your {{2}} service ended on {{3}}. Current renewal price: {{4}}. Reply to {{5}} for help renewing.',
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
      blurb: 'Tell a member when two sessions are left in their pack.',
      purpose:
        'Promotes a future session-pack purchase from current attendance facts only.',
      trigger:
        'An enabled reminder finds two sessions left in the current pack.',
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
          'Hi {{1}}, your {{2}} has {{3}} sessions left. Reply to {{4}} to ask about your next pack.',
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
      blurb: 'Tell a member when no sessions are left in their pack.',
      purpose:
        'Promotes a future session-pack purchase without claiming that check-in is blocked.',
      trigger:
        'An enabled reminder finds no sessions left in the current pack.',
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
          'Hi {{1}}, you have used all sessions in your {{2}}. Reply to {{3}} to ask about your next pack.',
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
      blurb: 'Remind a member when their planned return date is near.',
      purpose:
        'Updates a member about an explicitly planned return without resuming or changing their membership.',
      trigger:
        'One day before the planned return date for a paused membership, if the date has not changed.',
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
          'Hi {{1}}, your planned return date is {{2}}. Reply to {{3}} if your plans have changed.',
        sample_values: {
          body: ['Rahul', '20 Sep 2026', 'FitZone Wellness Private Limited'],
        },
      },
    },
    membership_win_back: {
      id: 'membership_win_back',
      title: 'Membership win-back',
      blurb: 'Invite a former member to join again.',
      purpose:
        'Promotes renewal after the short expiry sequence has ended; it does not invent an offer or discount.',
      trigger:
        'An enabled reminder runs 14, 30, or 60 days after a membership ends, if it has not changed.',
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
          'Hi {{1}}, thinking of restarting your {{2}} membership? Reply to {{3}} for help renewing.',
        sample_values: {
          body: ['Rahul', 'Quarterly', 'FitZone Wellness Private Limited'],
        },
        buttons: [{ type: 'QUICK_REPLY', text: 'Help me renew' }],
      },
    },
    service_win_back: {
      id: 'service_win_back',
      title: 'Service win-back',
      blurb: 'Invite a former service customer to return.',
      purpose:
        'Promotes service renewal after the short expiry sequence has ended; it does not invent an offer or discount.',
      trigger:
        'An enabled reminder runs 14, 30, or 60 days after a service ends, if it has not changed.',
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
          'Hi {{1}}, thinking of returning to your {{2}} service? Current renewal price: {{3}}. Reply to {{4}} for help renewing.',
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
      blurb: 'Remind a member about a payment due for joining.',
      purpose:
        'Updates a member about an amount and due date from an existing membership transaction.',
      trigger:
        'A reminder runs 7, 3, or 1 day before the payment is due, or on the due date.',
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
          'Hi {{1}}, your remaining installment of {{2}} for your {{3}} membership is due on {{4}}. Reply to {{5}} for payment help.',
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
      blurb: 'Remind a customer about an unpaid invoice.',
      purpose:
        'Updates a customer about the actual remaining balance and effective due date of one existing invoice.',
      trigger:
        'An invoice reminder runs on a set day before an unpaid invoice is due.',
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
          'Hi {{1}}, invoice {{2}} has {{3}} left to pay, due on {{4}}. Reply to {{5}} for payment help.',
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
      blurb: 'Follow up on an invoice that is still unpaid after its due date.',
      purpose:
        'Updates a customer about the actual remaining balance of one overdue invoice without making an access claim.',
      trigger:
        'An invoice reminder runs on a set day after an unpaid invoice is due.',
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
          'Hi {{1}}, invoice {{2}} has {{3}} left to pay, which was due on {{4}}. Reply to {{5}} if you have paid or need help.',
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
      blurb: 'Remind a customer about a payment they promised to make.',
      purpose:
        'Updates a customer about their staff-recorded payment commitment for one existing invoice without implying that payment was received.',
      trigger:
        'An enabled reminder runs one day before or on the promised payment date.',
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
          'Hi {{1}}, your planned payment for invoice {{2}} has {{3}} left to pay on {{4}}. Reply to {{5}} if your plans have changed.',
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
      blurb: 'Follow up when a promised payment is still unpaid.',
      purpose:
        'Updates a customer about a missed staff-recorded payment commitment without claiming a failed payment attempt.',
      trigger:
        'An enabled reminder runs one day after the promised date, if payment is still due.',
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
          'Hi {{1}}, invoice {{2}} still has {{3}} unpaid from your planned payment on {{4}}. Reply to {{5}} if you have paid or need more time.',
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
      blurb: 'Confirm a new payment without saying a membership was renewed.',
      purpose:
        'Updates a customer about one exact recorded payment without implying a membership renewal.',
      trigger: 'A new payment is recorded while payment messages are on.',
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
          'Hi {{1}}, we received {{2}} for invoice {{3}}. Reply to {{4}} if anything looks incorrect. Thank you.',
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
      blurb: 'Confirm a payment that renewed a membership.',
      purpose:
        'Updates a customer about one exact recorded payment and the membership end date produced by that renewal.',
      trigger:
        'A new payment is recorded and the membership renewal is confirmed.',
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
          'Hi {{1}}, we received {{2}} for invoice {{3}} and renewed your membership until {{4}}. Reply to {{5}} if anything looks incorrect. Thank you.',
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
      blurb: 'Tell a member that AutoPay will try the payment again.',
      purpose:
        'Updates a customer about an attributable verified AutoPay retry and explicitly avoids a manual payment request.',
      trigger: 'Razorpay says it will try again while AutoPay help is on.',
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
          'Hi {{1}}, AutoPay will retry the payment for {{2}}. Please wait before paying another way. Reply to {{3}} if you need help.',
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
      blurb: 'Ask for payment help after AutoPay stops trying.',
      purpose:
        'Updates a customer after a terminal verified AutoPay failure when a current collectible obligation remains and no healthy mandate covers it.',
      trigger:
        'Razorpay stops trying, and the amount is still due after we check AutoPay.',
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
          'Hi {{1}}, the AutoPay payment for invoice {{2}} was unsuccessful. There is {{3}} left to pay. Reply to {{4}} for payment help.',
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
      blurb: 'Send a payment link for an unpaid invoice.',
      purpose:
        'Requests payment for a specific existing invoice through a provider-hosted dynamic URL button.',
      trigger: 'You tap Send payment link on an unpaid invoice.',
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
          'Hi {{1}}, {{2}} is due for invoice {{3}}. This payment link expires on {{4}}. Pay {{5}} using the button below.',
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
      blurb: 'Send a PDF copy of a saved invoice.',
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
          'Hi {{1}}, attached is invoice {{2}} for {{3}} from {{4}}. Keep it for your records. Reply if anything looks incorrect.',
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
      blurb: 'Share an annual membership offer.',
      purpose:
        'Promotes a discounted future annual-membership purchase during a named campaign.',
      trigger: 'You send it yourself or in a broadcast to people you choose.',
      category: 'Marketing',
      galleryGroup: 'marketing',
      consentScope: 'whatsapp_marketing',
      wired: false,
      parameterLabels: [
        'Member name',
        'Festival or campaign',
        'Legal business name',
        'Discount',
        'Offer end date',
      ],
      payload: {
        name: 'gym_festival_offer',
        category: 'Marketing',
        language: 'en_US',
        body_text:
          'Hi {{1}}, {{2}} at {{3}}: save {{4}} on annual memberships until {{5}}. Tap below for offer details.',
        sample_values: {
          body: ['Rahul', 'Diwali', 'FitZone Gym', '20%', '10 Nov 2026'],
        },
        buttons: [{ type: 'QUICK_REPLY', text: 'Ask about offer' }],
      },
    },
  };

export const FEATURE_TEMPLATE_CONTRACTS = Object.values(
  TEMPLATE_CONTRACTS
).filter((contract) => contract.wired);

export function withLegalBusinessNameSample(
  contract: TemplateContract,
  legalBusinessName: string
): TemplatePayload {
  const index = contract.parameterLabels.indexOf('Legal business name');
  if (index < 0) return contract.payload;
  const body = [...(contract.payload.sample_values?.body ?? [])];
  body[index] = legalBusinessName.trim();
  return {
    ...contract.payload,
    sample_values: { ...contract.payload.sample_values, body },
  };
}

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
