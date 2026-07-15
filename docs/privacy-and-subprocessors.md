# Privacy — Data Handling & Subprocessors (paste-ready)

_Last reviewed: 2026-07-15. Source text for the public privacy policy's data-handling and subprocessor sections. Mirrors `docs/meta-data-handling.md`; update both together._

---

## Data we process

To provide a WhatsApp CRM for gyms, we process:

- **Contact data** you or your customers provide: name, phone number, email, and any custom fields you record.
- **WhatsApp message content** exchanged between your business and your contacts.
- **WhatsApp Business account data** obtained via the Meta / WhatsApp Business API: WhatsApp Business Account (WABA) and phone-number identifiers, and access tokens (stored encrypted).
- **Facebook Login data**: we use Facebook Login for Business only to connect the WhatsApp Business Account or Facebook Page you administer. We do **not** store your Facebook profile (name, email, friends, or profile details).
- **Payment data** (only if you enable payments): your customers' name, phone, and email are shared with our payment processor to set up UPI / card mandates.

## How we use it

We use this data solely to operate the service for your business: sending and receiving WhatsApp messages, renewal and payment reminders, managing members and leads, and processing payments you initiate. We do not sell your data or your customers' data. We do not use message content to train our own models.

## Subprocessors

We share data with the following service providers strictly to operate the service:

| Subprocessor | Purpose | Data shared |
|---|---|---|
| **Vercel** | Application hosting | All data in transit; operational logs |
| **Supabase** | Database, authentication, file storage | Contacts, messages, encrypted credentials, media |
| **Meta Platforms (WhatsApp Business API)** | Sending and receiving WhatsApp messages | Phone numbers, message content, media |
| **Razorpay** _(only if you enable payments)_ | UPI / card payment processing | Customer name, phone, email |
| **OpenAI** _(only if you enable the AI assistant with your own key)_ | AI-drafted message replies | Recent conversation message text |
| **Anthropic** _(only if you enable the AI assistant with your own key)_ | AI-drafted message replies | Recent conversation message text |
| **Cloudflare** | Spam protection on public lead forms | Requester IP, CAPTCHA token |

If you configure outbound webhooks, message and contact data is also sent to the URL **you** specify; you are responsible for that destination.

## Security

WhatsApp access tokens and payment-gateway secrets are encrypted at rest (AES-256-GCM). Access to each business's data is isolated at the database level (row-level security). Inbound WhatsApp webhooks are cryptographically verified before processing.

## Data retention & deletion

We retain data for as long as your account is active. You can delete individual records at any time, or permanently delete your entire account and all associated data from **Settings → Members → Delete account** — this erases every contact, conversation, message, and connected credential and cannot be undone.

To request deletion of data associated with a Facebook Login, visit **[https://desk.usefulmade.com/data-deletion](https://desk.usefulmade.com/data-deletion)** or email us.

## Government requests

We disclose user data to authorities only when compelled by valid legal process, and only the minimum required. See our Government & Legal Data-Request Policy.

## Contact

Data controller: **UsefulMade**, India.
Privacy & data requests: **contact@usefulmade.com**
