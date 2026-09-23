# UsefulDesk customer-message copy audit and rewrite

Reviewed 23 September 2026. Implemented locally; not submitted to Meta or deployed.

The library has strong factual foundations but spends too many words explaining
that a message is a message. The rewrite puts the event first, preserves the
amount or date needed to act, and ends with a useful response. The voice is a
helpful gym front desk: warm, direct, and calm about money.

## Scope and evidence

Reviewed all **21 built-in customer-facing Meta templates** in
`src/lib/whatsapp/template-contracts.ts`: 20 wired feature contracts and the
festival broadcast preset. This includes manual invoice/document sends because
they share the same customer voice. Reviewed sender semantics in the reminder
worker and transaction-event handler, the exact readiness checks, and current
operating documentation. Account-specific custom templates, historical delivered
messages, and live provider approval states were not inspected. Retired templates
are historical evidence, not additional current automations to rewrite.

The benchmark uses public first-party guidance and documented workflow behavior,
not access to competitors' private customer conversations or a conversion study.
Zenoti publishes actual sample messages; Glofox and Gymdesk sources below document
lifecycle and automation behavior. They are not evidence that every customer of
those platforms uses identical copy.

## Benchmark and decisions

| Reference                                                                                                                                                                                                                                                                          | Observed communication practice                                                                                                                                           | Application to UsefulDesk                                                                                                                                                 |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Nielsen Norman Group: the 3 C's](https://www.nngroup.com/articles/3-cs-microcopy/)                                                                                                                                                                                                | Prioritizes clarity, then concision, then character; keeps information needed to complete the task.                                                                       | Preserve dates, remaining amounts, and business identity before optimizing word count. Remove repetitive sign-offs and filler.                                            |
| [Zenoti: two-way SMS examples](https://www.zenoti.com/thecheckin/sms-salon-spa-medspa-messages)                                                                                                                                                                                    | Short, friendly messages identify the appointment or service and give a specific reply action; the shared inbox supports follow-through.                                  | Write as an approachable front desk. Use a reply for help or a real payment button; do not imply a reply completes a renewal.                                             |
| [ABC Glofox: renewal workflows](https://support.glofox.com/hc/en-us/articles/46444536491412-XLerate-Membership-Renewal-Reminders-and-Membership-Yearly-Reminders-Workflows)                                                                                                        | Separates renewal notices from anniversary messages, with explicit lifecycle start and stop conditions. The cited renewal flow concerns annual auto-renewing memberships. | Keep pre-expiry, post-expiry, and win-back meanings distinct. Do not import automatic-renewal promises into manual gym renewals.                                          |
| [Gymdesk: marketing automations](https://docs.gymdesk.com/en/help/docs/marketing-automations)                                                                                                                                                                                      | Uses member-state conditions, exit rules, reply-aware branches, and quiet hours.                                                                                          | Treat relevance and stopping rules as part of communication quality. Copy should remain accurate at every configured offset.                                              |
| [Stripe: payment reminders](https://stripe.com/en-ch/resources/more/what-is-a-payment-reminder-how-to-write-and-send-one-successfully)                                                                                                                                             | Recommends a friendly professional tone, invoice reference, amount, due date, payment instructions, and help route.                                                       | Make those facts easy to find. Avoid copying long email pleasantries, escalation threats, or fees that UsefulDesk has not established.                                    |
| [Infobip: WhatsApp template guidance](https://www.infobip.com/docs/whatsapp/compliance/template-compliance)                                                                                                                                                                        | Recommends identifiable business context, concise relevant content, and a clear separation between transactional and promotional content.                                 | Keep Utility bodies about existing transactions. Retain Marketing categories for future purchases and offers.                                                             |
| [Meta: utility templates](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/utility-templates/utility-templates.md) and [template components](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/components.md) | Utility messages must be non-promotional; templates have structured components and parameter examples.                                                                    | Preserve contract names, categories, parameter meanings, examples, document header, and payment URL behavior. Reapproval is required for changed copy.                    |
| [Meta: business messaging policy](https://whatsappbusiness.com/policy/)                                                                                                                                                                                                            | Requires expected communication, honoring opt-outs, and approved templates when initiating platform conversations.                                                        | Identify the real business and do not invent unsubscribe functionality. The existing opt-out behavior needs a separate product decision before broader messaging rollout. |

These sources support editorial choices; they do not prove that the rewritten
messages will increase renewal or collection rates. No competitor performance
claims are transferred to UsefulDesk.

## Findings

| Dimension                | Current finding                                                                                                     | Rewrite or remaining limitation                                                                                                                                                                           |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Comprehension            | Event facts are generally accurate, but the long attribution sentence repeats the subject.                          | Integrate business identity into the reply or payment instruction. Keep the event in the first sentence.                                                                                                  |
| Concision                | “Reply using the button if you would like…” and “This message is from…about…” make brief updates feel bureaucratic. | Use a direct reply instruction and the existing specific button label.                                                                                                                                    |
| Tone                     | One administrative tone serves reminders, success, failure, and invitations.                                        | Calm facts for collection; brief thanks for payment; an optional invitation for win-back; explicit reassurance while AutoPay retries.                                                                     |
| Action clarity           | Several messages say only “help”; the old festival button signals interest without naming its subject.              | Specify payment help, renewal help, or next-pack questions. Change the festival quick reply to **Ask about offer**.                                                                                       |
| Financial accuracy       | A generic receipt must not imply full settlement or renewal. A promised amount can decrease after partial payment.  | Keep receipt and renewal confirmation separate. Describe the outstanding part of a planned payment, preserving its date.                                                                                  |
| Automation truth         | “Still being processed” masks the retry state; “complete invoice” confuses an invoice with a payment attempt.       | Say AutoPay will retry when that is the verified event; say the payment was unsuccessful when the terminal event is verified.                                                                             |
| Member autonomy          | Renewal is a choice; an exhausted session pack does not prove entry is blocked.                                     | Retain **Help me renew** and **Ask about packs**. Make no access, health-outcome, urgency, or guaranteed-price claims.                                                                                    |
| Localization             | English bodies serve accounts with regional formatting. Long legal names can dominate a short message.              | Retain all locale-formatted parameters and legal identity. Avoid idioms, emoji-dependent meaning, gender, currency literals, or festival-specific assumptions. Translated templates remain separate work. |
| Scalability              | Names, categories, components, and exact bodies are shared contracts in application code and SQL.                   | Rewrite the single registry and add a matching readiness migration. Keep existing variable positions and sender behavior.                                                                                 |
| Trust and deliverability | Consent/opt-out history does not suppress outbound sends in the documented product behavior.                        | This is an unresolved behavior gap against Meta's policy, not something nicer wording fixes. Do not promise “Reply STOP” until it actually stops the relevant sends.                                      |

### Measured concision

With each template's existing sample values substituted, total body word count
falls from **727 to 504 (30.7% fewer words)**. Total body characters
fall from **4,401 to 3,076 (30.1% fewer characters)**. The median
sample body changes from 37 to
23 words. Buttons are excluded;
words are whitespace-delimited. These are reproducible text-size measures, not
readability scores or measured customer comprehension.

Unsubstituted template bodies fall from 632
to 409 words. There is no arbitrary
160-character target: WhatsApp is not SMS, and deleting invoice or identity facts
to meet an SMS-sized target would make these messages worse.

## Copy rules for future templates

1. Lead with the customer event, not “this is a reminder” when the facts already explain it.
2. Give one primary next step. A success or retry update may only need an optional help route.
3. State observable facts. Do not claim renewal, settlement, access restrictions, discounts, or a retry time without supporting data.
4. A quick reply starts a conversation. A URL button opens its stated destination. The copy must respect that distinction.
5. Keep “ends on” distinct from “ended on”; keep link expiry distinct from payment due date.
6. Use plain English that works across gym types and account locales. Keep dynamic names, currencies, dates, prices, and business identity in their existing parameter slots.
7. Keep fixed words before and after the body's variables. Validate real sample values, not just empty placeholders.
8. Do not add unsubscribe promises without enforced suppression. Respectful contact frequency and an owned inbox response are part of the experience.

## Complete rewritten library

Below, **Before** records the reviewed source; **After** is the exact replacement
body. Parameter numbers retain their existing meanings. All feature contracts
continue to use the canonical legal business name, not an invented shorter brand.
All retain `en_US`; there are no new footers. Sample previews use existing fictional
values and were not sent.

### 1. Membership renewal

`gym_membership_renewal` · Marketing · Body words: 33 → 18

**Before**

> Hi {{1}}, your {{2}} membership ends on {{3}}. The current renewal price is {{4}}. Reply using the button if you would like help renewing. This message is from {{5}} about your membership renewal.

**After**

> Hi {{1}}, your {{2}} membership ends on {{3}}. Current renewal price: {{4}}. Reply to {{5}} for help renewing.

**Button:** Help me renew (reply)

**Parameters:** `{{1}}` Member name; `{{2}}` Plan name; `{{3}}` Membership end date; `{{4}}` Current renewal price; `{{5}}` Legal business name.

**Why:** Keep the end date and current price explicit. The quick reply requests assistance; it does not buy or renew a membership.

**Sample preview**

> Hi Rahul, your Quarterly membership ends on 20 Sep 2026. Current renewal price: ₹3,999. Reply to FitZone Wellness Private Limited for help renewing.

### 2. Service renewal

`gym_service_renewal` · Marketing · Body words: 33 → 18

**Before**

> Hi {{1}}, your {{2}} service ends on {{3}}. The current renewal price is {{4}}. Reply using the button if you would like help renewing. This message is from {{5}} about your service renewal.

**After**

> Hi {{1}}, your {{2}} service ends on {{3}}. Current renewal price: {{4}}. Reply to {{5}} for help renewing.

**Button:** Help me renew (reply)

**Parameters:** `{{1}}` Member name; `{{2}}` Service name; `{{3}}` Service end date; `{{4}}` Current renewal price; `{{5}}` Legal business name.

**Why:** Use the same grammar as membership renewal while preserving service terminology.

**Sample preview**

> Hi Rahul, your Personal Training service ends on 20 Sep 2026. Current renewal price: ₹4,500. Reply to FitZone Wellness Private Limited for help renewing.

### 3. Expired membership follow-up

`gym_membership_post_expiry` · Marketing · Body words: 33 → 18

**Before**

> Hi {{1}}, your {{2}} membership ended on {{3}}. The current renewal price is {{4}}. Reply using the button if you would like help renewing. This message is from {{5}} about your expired membership.

**After**

> Hi {{1}}, your {{2}} membership ended on {{3}}. Current renewal price: {{4}}. Reply to {{5}} for help renewing.

**Button:** Help me renew (reply)

**Parameters:** `{{1}}` Member name; `{{2}}` Plan name; `{{3}}` Membership end date; `{{4}}` Current renewal price; `{{5}}` Legal business name.

**Why:** Past tense distinguishes an ended term without blaming the member or claiming access has stopped.

**Sample preview**

> Hi Rahul, your Quarterly membership ended on 20 Sep 2026. Current renewal price: ₹3,999. Reply to FitZone Wellness Private Limited for help renewing.

### 4. Expired service follow-up

`gym_service_post_expiry` · Marketing · Body words: 33 → 18

**Before**

> Hi {{1}}, your {{2}} service ended on {{3}}. The current renewal price is {{4}}. Reply using the button if you would like help renewing. This message is from {{5}} about your expired service.

**After**

> Hi {{1}}, your {{2}} service ended on {{3}}. Current renewal price: {{4}}. Reply to {{5}} for help renewing.

**Button:** Help me renew (reply)

**Parameters:** `{{1}}` Member name; `{{2}}` Service name; `{{3}}` Service end date; `{{4}}` Current renewal price; `{{5}}` Legal business name.

**Why:** Keep the ended service and current renewal price clear; no automatic extension is implied.

**Sample preview**

> Hi Rahul, your Personal Training service ended on 20 Sep 2026. Current renewal price: ₹4,500. Reply to FitZone Wellness Private Limited for help renewing.

### 5. Low session pack balance

`gym_session_pack_low` · Marketing · Body words: 30 → 17

**Before**

> Hi {{1}}, your {{2}} has {{3}} sessions remaining. Reply using the button if you would like help with your next pack. This message is from {{4}} about your remaining sessions.

**After**

> Hi {{1}}, your {{2}} has {{3}} sessions left. Reply to {{4}} to ask about your next pack.

**Button:** Ask about packs (reply)

**Parameters:** `{{1}}` Member name; `{{2}}` Plan name; `{{3}}` Sessions remaining; `{{4}}` Legal business name.

**Why:** “Sessions left” is easier to scan. The next-pack reply does not imply a purchase or booking.

**Sample preview**

> Hi Rahul, your 10-session pack has 2 sessions left. Reply to FitZone Wellness Private Limited to ask about your next pack.

### 6. Session pack used

`gym_session_pack_used` · Marketing · Body words: 33 → 19

**Before**

> Hi {{1}}, all sessions in your {{2}} have been used. Reply using the button if you would like help with your next pack. This message is from {{3}} about your used session pack.

**After**

> Hi {{1}}, you have used all sessions in your {{2}}. Reply to {{3}} to ask about your next pack.

**Button:** Ask about packs (reply)

**Parameters:** `{{1}}` Member name; `{{2}}` Plan name; `{{3}}` Legal business name.

**Why:** Describe actual consumption without claiming check-in is blocked or shaming a lapse.

**Sample preview**

> Hi Rahul, you have used all sessions in your 10-session pack. Reply to FitZone Wellness Private Limited to ask about your next pack.

### 7. Planned membership return

`gym_membership_return_reminder` · Utility · Body words: 25 → 16

**Before**

> Hi {{1}}, your planned return date is {{2}}. Reply here if you need to update it. This message is from {{3}} about your planned return.

**After**

> Hi {{1}}, your planned return date is {{2}}. Reply to {{3}} if your plans have changed.

**Button:** None; reply in the conversation where invited.

**Parameters:** `{{1}}` Member name; `{{2}}` Planned return date; `{{3}}` Legal business name.

**Why:** A planned date is not a promise that the membership resumes automatically. The reply asks staff for a change.

**Sample preview**

> Hi Rahul, your planned return date is 20 Sep 2026. Reply to FitZone Wellness Private Limited if your plans have changed.

### 8. Membership win-back

`gym_membership_win_back` · Marketing · Body words: 27 → 14

**Before**

> Hi {{1}}, you can restart your {{2}} membership. Reply using the button if you would like help renewing. This message is from {{3}} about restarting your membership.

**After**

> Hi {{1}}, thinking of restarting your {{2}} membership? Reply to {{3}} for help renewing.

**Button:** Help me renew (reply)

**Parameters:** `{{1}}` Member name; `{{2}}` Plan name; `{{3}}` Legal business name.

**Why:** An optional question is warmer than announcing that the former member can restart. No fabricated discount or personal judgment.

**Sample preview**

> Hi Rahul, thinking of restarting your Quarterly membership? Reply to FitZone Wellness Private Limited for help renewing.

### 9. Service win-back

`gym_service_win_back` · Marketing · Body words: 33 → 19

**Before**

> Hi {{1}}, you can renew your {{2}} service at the current price of {{3}}. Reply using the button if you would like help renewing. This message is from {{4}} about renewing your service.

**After**

> Hi {{1}}, thinking of returning to your {{2}} service? Current renewal price: {{3}}. Reply to {{4}} for help renewing.

**Button:** Help me renew (reply)

**Parameters:** `{{1}}` Member name; `{{2}}` Service name; `{{3}}` Current renewal price; `{{4}}` Legal business name.

**Why:** Invite a return while keeping the current service price visible.

**Sample preview**

> Hi Rahul, thinking of returning to your Personal Training service? Current renewal price: ₹4,500. Reply to FitZone Wellness Private Limited for help renewing.

### 10. Installment reminder

`gym_installment_reminder` · Utility · Body words: 32 → 21

**Before**

> Hi {{1}}, the remaining installment of {{2}} for your {{3}} membership is due on {{4}}. Reply if you need help with this payment. This message is from {{5}} about your remaining installment.

**After**

> Hi {{1}}, your remaining installment of {{2}} for your {{3}} membership is due on {{4}}. Reply to {{5}} for payment help.

**Button:** None; reply in the conversation where invited.

**Parameters:** `{{1}}` Member name; `{{2}}` Remaining installment amount; `{{3}}` Plan name; `{{4}}` Installment due date; `{{5}}` Legal business name.

**Why:** Retain the remaining amount, membership context, and actual deadline. No unsupported payment method is prescribed.

**Sample preview**

> Hi Rahul, your remaining installment of ₹1,600 for your Quarterly membership is due on 20 Sep 2026. Reply to FitZone Wellness Private Limited for payment help.

### 11. Invoice due reminder

`gym_invoice_due` · Utility · Body words: 30 → 18

**Before**

> Hi {{1}}, invoice {{2}} has a remaining balance of {{3}} due on {{4}}. Reply if you need help with this payment. This message is from {{5}} about your invoice balance.

**After**

> Hi {{1}}, invoice {{2}} has {{3}} left to pay, due on {{4}}. Reply to {{5}} for payment help.

**Button:** None; reply in the conversation where invited.

**Parameters:** `{{1}}` Customer name; `{{2}}` Invoice reference; `{{3}}` Remaining amount; `{{4}}` Due date; `{{5}}` Legal business name.

**Why:** Plain language identifies the remaining balance and due date, with a help route when no payment URL exists in this contract.

**Sample preview**

> Hi Rahul, invoice INV-1024 has ₹2,700 left to pay, due on 20 Sep 2026. Reply to FitZone Wellness Private Limited for payment help.

### 12. Overdue invoice reminder

`gym_invoice_overdue` · Utility · Body words: 33 → 24

**Before**

> Hi {{1}}, invoice {{2}} still has a remaining balance of {{3}} that was due on {{4}}. Reply if you need help with this payment. This message is from {{5}} about your overdue invoice.

**After**

> Hi {{1}}, invoice {{2}} has {{3}} left to pay, which was due on {{4}}. Reply to {{5}} if you have paid or need help.

**Button:** None; reply in the conversation where invited.

**Parameters:** `{{1}}` Customer name; `{{2}}` Invoice reference; `{{3}}` Remaining amount; `{{4}}` Due date; `{{5}}` Legal business name.

**Why:** Make the past due date clear and give members who already paid a way to reconcile the record.

**Sample preview**

> Hi Rahul, invoice INV-1024 has ₹2,700 left to pay, which was due on 20 Sep 2026. Reply to FitZone Wellness Private Limited if you have paid or need help.

### 13. Upcoming promised payment

`gym_payment_promise_upcoming` · Utility · Body words: 32 → 23

**Before**

> Hi {{1}}, this is a reminder that you planned to pay {{3}} for invoice {{2}} on {{4}}. Reply if you need help. This message is from {{5}} about your planned invoice payment.

**After**

> Hi {{1}}, your planned payment for invoice {{2}} has {{3}} left to pay on {{4}}. Reply to {{5}} if your plans have changed.

**Button:** None; reply in the conversation where invited.

**Parameters:** `{{1}}` Customer name; `{{2}}` Invoice reference; `{{3}}` Promised amount; `{{4}}` Promised payment date; `{{5}}` Legal business name.

**Why:** Describe what is left of the planned payment. The worker reduces this value after allocations, so it must not be described as the original promised amount.

**Sample preview**

> Hi Rahul, your planned payment for invoice INV-1024 has ₹2,700 left to pay on 20 Sep 2026. Reply to FitZone Wellness Private Limited if your plans have changed.

### 14. Missed promised payment

`gym_payment_promise_missed` · Utility · Body words: 35 → 25

**Before**

> Hi {{1}}, the planned payment date of {{4}} for {{3}} on invoice {{2}} has passed, and the balance remains unpaid. Reply if you need help. This message is from {{5}} about your missed payment date.

**After**

> Hi {{1}}, invoice {{2}} still has {{3}} unpaid from your planned payment on {{4}}. Reply to {{5}} if you have paid or need more time.

**Button:** None; reply in the conversation where invited.

**Parameters:** `{{1}}` Customer name; `{{2}}` Invoice reference; `{{3}}` Promised amount; `{{4}}` Promised payment date; `{{5}}` Legal business name.

**Why:** Refer to the outstanding part of the planned payment without alleging a failed charge. Asking for more time does not automatically extend the due date.

**Sample preview**

> Hi Rahul, invoice INV-1024 still has ₹2,700 unpaid from your planned payment on 20 Sep 2026. Reply to FitZone Wellness Private Limited if you have paid or need more time.

### 15. Payment confirmation

`gym_payment_confirmation` · Utility · Body words: 25 → 17

**Before**

> Hi {{1}}, we received {{2}} for invoice {{3}}. Reply if any payment detail looks incorrect. This message is from {{4}} about your recorded invoice payment.

**After**

> Hi {{1}}, we received {{2}} for invoice {{3}}. Reply to {{4}} if anything looks incorrect. Thank you.

**Button:** None; reply in the conversation where invited.

**Parameters:** `{{1}}` Customer name; `{{2}}` Amount received; `{{3}}` Invoice reference; `{{4}}` Legal business name.

**Why:** Confirm only the amount actually received. A brief thank-you is appropriate; no full-payment or renewal claim is added.

**Sample preview**

> Hi Rahul, we received ₹2,700 for invoice INV-1024. Reply to FitZone Wellness Private Limited if anything looks incorrect. Thank you.

### 16. Payment and membership renewal confirmation

`gym_payment_membership_renewal_confirmation` · Utility · Body words: 32 → 23

**Before**

> Hi {{1}}, we received {{2}} for invoice {{3}} and renewed your membership until {{4}}. Reply if any payment detail looks incorrect. This message is from {{5}} about your payment and membership renewal.

**After**

> Hi {{1}}, we received {{2}} for invoice {{3}} and renewed your membership until {{4}}. Reply to {{5}} if anything looks incorrect. Thank you.

**Button:** None; reply in the conversation where invited.

**Parameters:** `{{1}}` Customer name; `{{2}}` Amount received; `{{3}}` Invoice reference; `{{4}}` Membership end date; `{{5}}` Legal business name.

**Why:** Keep the recorded payment and confirmed new membership end date together. This is only sent for the verified renewal event.

**Sample preview**

> Hi Rahul, we received ₹2,700 for invoice INV-1024 and renewed your membership until 20 Dec 2026. Reply to FitZone Wellness Private Limited if anything looks incorrect. Thank you.

### 17. AutoPay retry update

`gym_autopay_retry_update` · Utility · Body words: 27 → 22

**Before**

> Hi {{1}}, your AutoPay payment for {{2}} is still being processed. No payment is needed from you now. This message is from {{3}} about your AutoPay retry.

**After**

> Hi {{1}}, AutoPay will retry the payment for {{2}}. Please wait before paying another way. Reply to {{3}} if you need help.

**Button:** None; reply in the conversation where invited.

**Parameters:** `{{1}}` Customer name; `{{2}}` Membership reference; `{{3}}` Legal business name.

**Why:** Name the verified retry state and discourage a second payment by another method. Do not promise a retry time or successful collection.

**Sample preview**

> Hi Rahul, AutoPay will retry the payment for your membership. Please wait before paying another way. Reply to FitZone Wellness Private Limited if you need help.

### 18. AutoPay payment help

`gym_autopay_payment_help` · Utility · Body words: 30 → 22

**Before**

> Hi {{1}}, AutoPay could not complete invoice {{2}}, which has {{3}} remaining. Reply for help with the next payment step. This message is from {{4}} about your unpaid AutoPay invoice.

**After**

> Hi {{1}}, the AutoPay payment for invoice {{2}} was unsuccessful. There is {{3}} left to pay. Reply to {{4}} for payment help.

**Button:** None; reply in the conversation where invited.

**Parameters:** `{{1}}` Customer name; `{{2}}` Invoice reference; `{{3}}` Remaining amount; `{{4}}` Legal business name.

**Why:** A payment, not an invoice, was unsuccessful. The current remaining balance is separate from the failed attempt; the reply requests help.

**Sample preview**

> Hi Rahul, the AutoPay payment for invoice INV-1024 was unsuccessful. There is ₹2,700 left to pay. Reply to FitZone Wellness Private Limited for payment help.

### 19. Payment link

`gym_payment_link` · Utility · Body words: 30 → 20

**Before**

> Hi {{1}}, {{2}} is due for invoice {{3}}. The payment link expires on {{4}}. Use the button below to pay. This message is from {{5}} about your invoice payment link.

**After**

> Hi {{1}}, {{2}} is due for invoice {{3}}. This payment link expires on {{4}}. Pay {{5}} using the button below.

**Button:** Pay invoice (payment URL)

**Parameters:** `{{1}}` Member name; `{{2}}` Outstanding amount; `{{3}}` Invoice reference; `{{4}}` Payment link expiry; `{{5}}` Legal business name.

**Why:** Identify the payable invoice, business, and link expiry, then point to the actual payment button. The link expiry is not described as the invoice due date.

**Sample preview**

> Hi Rahul, ₹2,700 is due for invoice INV-1024. This payment link expires on 20 Sep 2026, 6:00 pm. Pay FitZone Wellness Private Limited using the button below.

### 20. Invoice document

`gym_invoice_document` · Utility · Body words: 25 → 20

**Before**

> Hi {{1}}, here is invoice {{2}} for {{3}} from {{4}}. Please keep this document for your records and reply if any invoice detail looks incorrect.

**After**

> Hi {{1}}, attached is invoice {{2}} for {{3}} from {{4}}. Keep it for your records. Reply if anything looks incorrect.

**Button:** None; reply in the conversation where invited.

**Parameters:** `{{1}}` Customer name; `{{2}}` Invoice number; `{{3}}` Invoice total; `{{4}}` Legal business name.

**Why:** Describe the attachment as an invoice, not a receipt or tax invoice. The amount is the invoice total, not necessarily the remaining amount due.

**Sample preview**

> Hi Asha, attached is invoice INV-000042 for ₹2,500.00 from FitZone Wellness Private Limited. Keep it for your records. Reply if anything looks incorrect.

### 21. Festival offer

`gym_festival_offer` · Marketing · Body words: 21 → 17

**Before**

> Hi {{1}}, {{2}} offer from {{3}}: {{4}} off annual memberships until {{5}}. Use the button below if you would like details.

**After**

> Hi {{1}}, {{2}} at {{3}}: save {{4}} on annual memberships until {{5}}. Tap below for offer details.

**Button:** Ask about offer (reply)

**Parameters:** `{{1}}` Member name; `{{2}}` Festival or campaign; `{{3}}` Gym name; `{{4}}` Discount; `{{5}}` Offer end date.

**Why:** Keep the campaign, actual discount, and end date. The specific quick reply asks for details; it does not claim to redeem the offer.

**Sample preview**

> Hi Rahul, Diwali at FitZone Gym: save 20% on annual memberships until 10 Nov 2026. Tap below for offer details.

## Validation completed

- 555 tests passed across 59 files covering WhatsApp contracts/send paths,
  reminder rules and lifecycle, template management/previews, and invoice sharing.
- TypeScript (`tsc --noEmit`), ESLint for changed TypeScript files, and
  `git diff --check` passed.
- Verified that all 21 after-copy entries match the canonical registry and that
  the new SQL migration changes only expected message bodies, preserving the
  existing readiness guards. Live schema/provider verification remains pending.

## Release and evaluation

The source rewrite is complete. Existing provider-approved bodies do not become
the new messages automatically. Exact matching intentionally blocks stale
contracts; a deploy without the provider/SQL cutover can therefore interrupt
reminders. Coordinate the application release, the existing pending template
cutover migrations, and `20260923160000_customer_template_copy.sql`. Preserve
saved automation preferences. Use the existing template resubmission and sync
workflow; verify exact category, language, POSITIONAL parameters, body, header,
and buttons after Meta review. The document template also needs its existing
sample-document workflow. No migration, deployment, Meta edit/submission, rule
activation, or customer send was performed in this copy-review task.

Before release, review rendered examples with long member, plan, and legal
business names; a partially paid promise; a partial invoice payment; a changed
return date; and a delayed retry. Check that each button opens or replies exactly
as described. Approval is a provider decision, not a result of the local tests.

For a later authorized pilot, test understanding with gym members: who sent the
message, what happened, what amount/date matters, and what happens after the
button. Track delivery, meaningful replies, completed renewals, settled invoices,
opt-outs/blocks, and staff response workload separately. Compare equivalent
lifecycle stages and offsets; read receipts alone are not evidence of better
copy. These are proposed validation steps, not completed customer research.

Two product questions remain outside the copy change: enforce opt-out decisions
before claiming compliant scaled outreach, and decide whether a recognizable
branch/trading name should accompany the legal identity. The latter needs an
explicit data/contract change rather than silently substituting a shorter name.
