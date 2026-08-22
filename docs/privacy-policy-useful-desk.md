# Privacy Policy — UsefulDesk

**Effective date:** 22 August 2026

**Product:** UsefulDesk — a WhatsApp CRM for gyms

**Data controller:** UsefulMade, India

## 1. Who we are

UsefulDesk is a customer-relationship tool for gyms and fitness businesses, operated by UsefulMade in India. Questions may be sent to **contact@usefulmade.com**.

## 2. Data we process

- Team account data: names, email addresses, authentication and branch roles.
- Contact/member data supplied by a gym or its customers: name, phone, email, custom fields, memberships, attendance and payment records.
- WhatsApp message content and media exchanged through the service.
- WhatsApp Business data: WABA and phone-number identifiers and encrypted access tokens.
- Meta Lead Ads data: submitted form answers, form/ad/campaign identifiers, Facebook or Instagram source, Page identifiers, encrypted Page access tokens, and connection-health diagnostics.
- Facebook Login for Business identifiers needed to connect a WABA or Page. We do not store Facebook friends or an unrelated Facebook profile.
- Customer name, phone and email shared with Razorpay only when the gym enables payments.

## 3. How we use data

We use data to provide inbox, lead/member management, team follow-up, attendance, renewal/payment reminders, payments, and integrations selected by the gym. We do not sell data and do not use message content to train our own AI models.

Capturing a Meta Lead Ads submission does **not** create or imply WhatsApp consent. The gym remains responsible for a lawful basis to contact the person and for recording the separately required WhatsApp consent before applicable messaging.

## 4. Legal basis

We process customer account data to perform our contract with the gym. The gym is responsible for an appropriate lawful basis for contact/member data it collects or uploads, including Lead Ads submissions, and for the opt-in required for WhatsApp communication.

## 5. Subprocessors

| Subprocessor                             | Purpose                                                | Data shared                                                                      |
| ---------------------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------- |
| **Vercel**                               | Production application hosting                         | Data in transit and bounded operational logs                                     |
| **Supabase**                             | Database, authentication, file storage                 | Contacts, messages, Lead Ads data, encrypted credentials, media and health state |
| **Meta Platforms / WhatsApp**            | Facebook Login, Lead Ads retrieval, WhatsApp messaging | Relevant identifiers, form/message content, media and credentials                |
| **Razorpay** _(optional)_                | Payment processing                                     | Customer name, phone and email                                                   |
| **OpenAI** _(optional, customer key)_    | AI-drafted replies/embeddings                          | Recent conversation text selected by the feature                                 |
| **Anthropic** _(optional, customer key)_ | AI-drafted replies                                     | Recent conversation text selected by the feature                                 |
| **Cloudflare** _(optional)_              | Public-form spam protection                            | Requester IP and CAPTCHA token                                                   |

Account-configured outbound webhooks send event data to the URL the account selects; the account is responsible for that recipient.

## 6. Security

WhatsApp and Meta Page access tokens and payment credentials are encrypted at rest with AES-256-GCM. Database row-level security isolates each business. Inbound Meta/WhatsApp webhooks are cryptographically verified, and privileged recovery operations use tenant-scoped leases.

## 7. Retention and deletion

Data remains while the account is active unless deleted earlier. An account may delete individual records or permanently erase its account from **Settings → Members → Delete account**. Facebook Login data-deletion requests may be started at [desk.usefulmade.com/data-deletion](https://desk.usefulmade.com/data-deletion) or by email.

## 8. Rights, children, and legal requests

Email **contact@usefulmade.com** to request access, correction or deletion. UsefulDesk is a business tool, not directed at children under 18. We disclose data to authorities only when compelled by valid Indian legal process, limit disclosure to what is required, and challenge improper or overbroad requests where appropriate.

## 9. Changes and contact

Material changes will update the effective date. Privacy and data requests: **contact@usefulmade.com**.
