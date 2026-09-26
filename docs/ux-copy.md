# Plain-language UI copy

Read this before writing or changing any visible text: labels, buttons, titles,
helper text, toasts, errors, empty states, tooltips, and accessible names.

## Who reads our screens

A typical UsefulDesk user owns or runs one gym in India. They are busy, often on
a phone at the front desk, and use English as a second or third language. They
read English well enough to use WhatsApp, PhonePe, and a banking app, but a long
sentence, an office word, or a software term slows them down or loses them.

Write for that reader. If a Class 8 student in a Hindi-medium school would not
understand a word, choose another word.

## What we benchmarked

| Reference                                                         | What it teaches us                                                                                                                       |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| WhatsApp and WhatsApp Business                                    | Owners already know **Chats**, **Admin**, **Broadcast**, **Labels**, **Template**. Reuse the words they learned there.                   |
| Khatabook, Vyapar, PhonePe Business                               | Money is said as a short fact with the amount first: "₹1,500 due", "You will get ₹500". Hinglish-level vocabulary, not accounting terms. |
| Indian gym software (Gymex, FitnessForce, GymForce, MyGymDesk)    | The desk words are **Enquiry**, **Follow-up**, **Renewal due**, **Pending dues**, **Freeze**, **Receipt**, **Staff**.                    |
| Low-literacy UI research (Medhi et al., Microsoft Research India) | Fewer words per screen, concrete verbs, consistent labels, and an icon or number beside the word do more than explanations.              |
| Nielsen Norman Group, GOV.UK plain-language guidance              | Clarity before brevity before personality. One idea per sentence. Front-load the key fact.                                               |

## Ten rules

1. **Say the fact first.** "3 members expire this week", not "Memberships expiring in the next 7 days: 3".
2. **One idea per sentence.** Keep helper sentences under about 15 words. Split, don't join with "and", "which", or ";".
3. **Use desk words.** Enquiry, member, fee, due, paid, renew, expired, freeze, follow-up, staff. See the glossary.
4. **Buttons are verb + thing.** "Add member", "Send reminder", "Record payment". Two or three words. Never "Submit", "OK", or "Yes".
5. **No software words.** Never show: configure, sync, provider, contract, module, record (as a noun), entity, instance, metric, conversion, scope, payload, execute, operational, trigger (outside the Automations builder).
6. **No idioms or phrasal verbs** when a plain verb exists. "Contact", not "reach out"; "pass to staff", not "hand off"; "start", not "kick off".
7. **Errors say what happened and what to do.** "Could not save. Check your internet and try again." Never blame; never show an internal code as the main text.
8. **Empty states say why it is empty and the next step.** "No enquiries yet. Add one or share your enquiry form."
9. **Numbers and dates are concrete.** "Today", "Tomorrow", "in 3 days", "₹1,500". No "N/A", "Avg.", "e.g." — write "for example".
10. **Same thing, same word, everywhere.** A new synonym needs a glossary change first.

## Glossary

Use the left column. Never show the right column to users. Internal code,
table names, and URLs may keep the old words (for example `/leads`,
`contacts`, `role = 'agent'`).

| Say                                             | Don't say                               | Notes                                                                                 |
| ----------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------- |
| **Enquiry / Enquiries**                         | Lead, prospect, contact                 | "an enquiry". The source is **Enquiry source**. The public form is **Enquiry form**.  |
| **Add as member**                               | Convert, convert to member              | The action that turns an enquiry or trial into a paying member.                       |
| **Chats**, a **chat**                           | Inbox, conversation, thread             | The menu item and page are **Chats**.                                                 |
| **Home**                                        | Dashboard                               |                                                                                       |
| **Setup**                                       | Get started, onboarding                 | The setup checklist page.                                                             |
| **App details**                                 | Diagnostics, build info                 | The phone app's support screen: version, connection, branch, and role.                |
| **Owner, Admin, Staff, View only**              | Agent, viewer, read-only, teammate role | Role names. Owners know "admin" from WhatsApp groups.                                 |
| **Team**, **team member**                       | Teammate, user, seat                    |                                                                                       |
| **Follow-up**                                   | Next action, task                       | Hyphenated noun. Verb is **Follow up**. Close one with **Mark done**.                 |
| **Expiry**, **expires on**, **Expired**         | Lapsed, end date (for memberships)      |                                                                                       |
| **Renew**, **Renewal**                          | Re-up, extend (for memberships)         |                                                                                       |
| **Fee**, **Due**, **Paid**, **Balance due**     | Outstanding, arrears, receivable        | "₹1,500 due".                                                                         |
| **Record payment**                              | Log, reconcile, allocate                |                                                                                       |
| **Cancel payment** / **Cancelled**              | Void, voided                            | A payment entered by mistake. It stays in history and is not counted.                 |
| **Invoice**                                     | Bill (in UI), statement                 | Kept because GST documents are legally invoices.                                      |
| **Installment**                                 | Instalment, tranche, split              | Matches the WhatsApp template name.                                                   |
| **AutoPay**                                     | Mandate, subscription, eMandate         | UPI AutoPay is an NPCI name owners see in their UPI app.                              |
| **Freeze**, **Frozen**, **Unfreeze**            | Pause, hold, suspend (for memberships)  |                                                                                       |
| **At risk**                                     | Churn, retention risk                   | Members who may stop coming.                                                          |
| **Usual time**                                  | Assigned arrival, arrival slot          | The time a member normally comes. A planning hint, not a booking.                     |
| **Check in**, **Check out**                     | Attendance event, visit record          | Verb has no hyphen; noun and column use **Check-in** / **Check-out**.                 |
| **WhatsApp approval**, **approved by WhatsApp** | Meta review, provider contract, synced  | Meta is invisible to owners; they know WhatsApp.                                      |
| **Message template**                            | Template contract, HSM                  | Explain once: "a message WhatsApp has approved in advance".                           |
| **Automated messages**                          | Lifecycle messages, reminder rules      | The Settings page. Each item inside it is a **message**.                              |
| **Stopped messages**                            | Opt-out, unsubscribed                   | "This member asked not to get messages."                                              |
| **Branch**                                      | Location, workspace, tenant             |                                                                                       |
| **Upload file**, **Download file**              | Import, export (in helper text)         | Button labels may stay **Import** / **Export**; helper text says "Excel or CSV file". |
| **Details**                                     | Record, entity, profile data            |                                                                                       |

## Patterns

**Confirmations** name the thing and the result on both the title and the
button: title "Delete this enquiry?", body "Their notes and follow-ups will be
deleted too. You cannot undo this.", button **Delete enquiry**.

**Toasts** are past tense and short: "Member added", "Payment recorded",
"Reminder sent". Error toasts start with "Could not": "Could not send the
reminder. Try again."

**Loading** says what is loading only when the wait is long enough to read:
"Loading members…". A spinner inside a button needs no text change.

**Helper text** answers the question the owner would ask, in one sentence:
"Members see this name on WhatsApp."

**Blocked actions** (`ResolvableAction`) say why and what fixes it: "Connect
WhatsApp first" + **Connect WhatsApp**.

**Accessible names** match the visible words. Icon-only buttons name the action
and object: "Delete note", "Call Ravi".
