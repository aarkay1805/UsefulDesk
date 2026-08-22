# Privacy — Data Handling & Subprocessors (paste-ready)

_Last reviewed: 2026-08-22. This public copy mirrors `docs/meta-data-handling.md`._

## Data we process

UsefulDesk processes team account data; gym contact/member records; WhatsApp messages and media; WhatsApp Business identifiers and encrypted tokens; and, when Meta Lead Ads is connected, submitted form answers, form/ad/campaign identifiers, Facebook or Instagram source, Page identifiers, encrypted Page access tokens, and connection-health diagnostics. Optional payments also process customer name, phone and email.

We use Facebook Login for Business only to connect a WhatsApp Business Account or Facebook Page the user administers. We do not store Facebook friends or unrelated profile details.

## How we use it

We use data to provide the CRM, inbox, lead/member operations, team follow-up, reminders, payments, and customer-enabled integrations. We do not sell data or use message content to train our own models.

A Meta Lead Ads submission creates **no WhatsApp consent record**. The gym is responsible for its lawful basis to contact the lead and must separately record the consent required for applicable WhatsApp messaging.

## Subprocessors

| Subprocessor                             | Purpose                                | Data shared                                                                      |
| ---------------------------------------- | -------------------------------------- | -------------------------------------------------------------------------------- |
| **Vercel**                               | Production application hosting         | Data in transit and bounded operational logs                                     |
| **Supabase**                             | Database, authentication, file storage | Contacts, messages, Lead Ads data, encrypted credentials, health state and media |
| **Meta Platforms / WhatsApp**            | Login, Lead Ads and WhatsApp APIs      | Relevant identifiers, form/message content, media and credentials                |
| **Razorpay** _(optional)_                | Payments                               | Customer name, phone and email                                                   |
| **OpenAI** _(optional, customer key)_    | Drafting/embeddings                    | Recent conversation text                                                         |
| **Anthropic** _(optional, customer key)_ | Drafting                               | Recent conversation text                                                         |
| **Cloudflare** _(optional)_              | Public-form spam protection            | Requester IP and CAPTCHA token                                                   |

Account-configured outbound webhooks also send event data to the account-selected destination.

## Security, retention, and deletion

WhatsApp and Meta Page tokens and payment credentials are AES-256-GCM encrypted at rest. Database row-level security isolates each business, and inbound Meta/WhatsApp webhooks are cryptographically verified. Data remains while an account is active unless deleted. The account can delete records or permanently erase its account from **Settings → Members → Delete account**. Facebook Login deletion requests are available at [desk.usefulmade.com/data-deletion](https://desk.usefulmade.com/data-deletion).

Data controller: **UsefulMade**, India. Privacy requests: **contact@usefulmade.com**.
