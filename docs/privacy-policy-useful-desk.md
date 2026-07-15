# Privacy Policy — UsefulDesk

_This is the full, standalone privacy policy for the UsefulDesk product. It is separate from any other product's policy on the site. Hand this to the website-repo session as the content source; that session wires the route (suggested path: `/useful-desk/privacy`)._
_Domain: `usefulmade.com` (product at `desk.usefulmade.com`). The Meta App "Privacy Policy URL", "Data Deletion Request URL", and UsefulDesk's `NEXT_PUBLIC_SITE_URL` must all sit on this domain._

---

**Effective date:** 15 July 2026
**Product:** UsefulDesk — a WhatsApp CRM for gyms
**Data controller:** UsefulMade, India

## 1. Who we are

UsefulDesk is a WhatsApp-based customer-relationship tool for gyms and fitness businesses, operated by UsefulMade (India). This policy explains what data UsefulDesk processes, why, who we share it with, and how you can delete it. For any privacy question, contact **contact@usefulmade.com**.

## 2. Data we process

- **Your account data:** name, email, and login credentials for the people on your gym's team who use UsefulDesk.
- **Your contacts' data** that you or your customers provide: name, phone number, email, and any custom fields you record about members and leads.
- **WhatsApp message content** exchanged between your business and your contacts through the platform.
- **WhatsApp Business account data** obtained via the Meta / WhatsApp Business API: WhatsApp Business Account (WABA) and phone-number identifiers, and access tokens (stored encrypted).
- **Facebook Login data:** we use Facebook Login for Business only to connect the WhatsApp Business Account or Facebook Page you administer. We do **not** store your Facebook profile (name, email, friends, or profile details).
- **Payment data** (only if you enable payments): your customers' name, phone, and email are shared with our payment processor to set up UPI / card mandates.

## 3. How we use it

We process this data solely to operate the service for your business: sending and receiving WhatsApp messages, renewal and payment reminders, managing members and leads, and processing payments you initiate.

We do **not** sell your data or your customers' data, and we do **not** use message content to train our own AI models.

## 4. Legal basis & consent

We process this data to perform our contract with you (providing the service) and on the basis of your and your customers' consent for WhatsApp communication, which is obtained through your business's own opt-in process. You are responsible for having a lawful basis to contact the members and leads you upload.

## 5. Subprocessors

We share data with the following providers strictly to operate the service:

| Subprocessor | Purpose | Data shared |
|---|---|---|
<<<<<<< HEAD
| **Vercel** | Application hosting | All data in transit; operational logs |
=======
| **Hostinger** | Application hosting | All data in transit; operational logs |
>>>>>>> c0d9eb889fff39e43b9547471dc74f236e77cdd2
| **Supabase** | Database, authentication, file storage | Contacts, messages, encrypted credentials, media |
| **Meta Platforms (WhatsApp Business API)** | Sending and receiving WhatsApp messages | Phone numbers, message content, media |
| **Razorpay** _(only if you enable payments)_ | UPI / card payment processing | Customer name, phone, email |
| **OpenAI** _(only if you enable the AI assistant with your own key)_ | AI-drafted message replies | Recent conversation message text |
| **Anthropic** _(only if you enable the AI assistant with your own key)_ | AI-drafted message replies | Recent conversation message text |
| **Cloudflare** | Spam protection on public lead forms | Requester IP, CAPTCHA token |

If you configure outbound webhooks, message and contact data is also sent to the URL **you** specify; you are responsible for that destination.

## 6. Security

WhatsApp access tokens and payment-gateway secrets are encrypted at rest (AES-256-GCM). Each business's data is isolated at the database level (row-level security). Inbound WhatsApp webhooks are cryptographically verified before processing.

## 7. Data retention & deletion

We retain data for as long as your account is active. You can:

- Delete individual records (contacts, notes, media) at any time.
- Permanently delete your **entire account and all associated data** from **Settings → Members → Delete account** — this erases every contact, conversation, message, and connected credential, and cannot be undone.
- Request deletion of data associated with a Facebook Login at **https://desk.usefulmade.com/data-deletion**, or by emailing **contact@usefulmade.com**.

## 8. Your rights

You may request access to, correction of, or deletion of your personal data by emailing **contact@usefulmade.com**. We respond within a reasonable period and, where required, in line with applicable Indian data-protection law.

## 9. Children

UsefulDesk is a business tool intended for gym operators. It is not directed at children under 18, and we do not knowingly collect data directly from children.

## 10. Government & legal requests

We disclose user data to public authorities only when compelled by valid legal process under Indian law, and only the minimum the order requires. We challenge overbroad or improper requests and, where lawful, notify the affected user.

## 11. Changes

We may update this policy; material changes will be reflected by the effective date above.

## 12. Contact

**UsefulMade**, India
Privacy & data requests: **contact@usefulmade.com**
