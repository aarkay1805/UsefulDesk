# Mobile template sending benchmark

Reviewed 2026-09-26. Scope: choosing and sending an approved WhatsApp template
from a chat in the UsefulDesk Expo app, which is the only thing an owner can
send once the 24-hour reply window has closed.

## References

This compares documented behaviour plus the inspected UsefulDesk app. It is not
a hands-on test of each product's current build.

| Product                                    | Where templates start                                                      | How one is chosen                                               | How blanks are filled                                                                | Source                                                                                                                                            |
| ------------------------------------------ | -------------------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| WhatsApp Business app (quick replies)      | Type `/` in the composer, or the attach menu                               | A list of saved messages showing their text; one tap inserts it | Inserted text is edited in the normal composer, then sent with the round send button | [WhatsApp Help Center](https://faq.whatsapp.com/1791149784551042/?cms_platform=android), [guide](https://gurusup.com/blog/whatsapp-quick-replies) |
| DoubleTick (India, mobile app mirrors web) | **Send Template** in a closed chat; attach menu → template in an open chat | Template dialog, then an arrow to continue                      | Optional variable step, then **Send now**                                            | [DoubleTick docs](https://learn.doubletick.io/templates/send-template-messages)                                                                   |
| Gallabox                                   | New chat or closed chat                                                    | Pick an approved template                                       | Contact variables (name, phone, order number) fill automatically; the rest is typed  | [Gallabox docs](https://docs.gallabox.com/conversations/initiate-a-new-chat)                                                                      |
| WATI                                       | Expired chats allow templates only                                         | Template picker in Team Inbox                                   | Template variables per send                                                          | [WATI help](https://support.wati.io/en/articles/11463459-understanding-whatsapp-chat-session-expiry-and-how-to-restart-conversations)             |
| respond.io mobile                          | Closed conversation                                                        | Select from the approved list                                   | Enter the template's details                                                         | [respond.io help](https://respond.io/help/whatsapp/whatsapp-message-templates)                                                                    |

What they share, and what owners already know from WhatsApp itself: the list
shows the message, not an internal name; the message is checked as a chat
bubble; known contact details are filled for you; the send control is the same
round button as the composer.

## UsefulDesk before and after

| Area           | Before                                                                                                                                                | After                                                                                                                                                                                                                              |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Loading        | One media-header, malformed, or unsupported template made the whole list fail, so every chat past 24 hours showed "Could not load templates"          | Each template is checked alone and skipped if this app cannot send it. A failed read or a row from another branch still fails closed                                                                                               |
| List           | Full-width buttons with raw names (`gym_membership_renewal · Selected`); the first template was pre-selected; preview and Send sat below every button | Full-screen list, searchable from six templates, with readable names ("Membership renewal") and a two-line preview already written for this member                                                                                 |
| Preview        | Plain grey box without buttons or footer                                                                                                              | Outgoing chat bubble in the chat's own colours, with footer and WhatsApp-style button rows; missing blanks show as `[Plan name]`                                                                                                   |
| Blanks         | Every blank labelled "Message detail N" and empty                                                                                                     | Labelled from the shared template contract (Member name, Plan name, Membership end date, Current renewal price). Member name, membership details, and legal name fill automatically; the server-filled legal name is never a field |
| Send           | Full-width **Send template** button                                                                                                                   | Round send button with "Ready to send to Rahul Sharma" or "2 details left to fill" beside it                                                                                                                                       |
| Known failures | Missing legal name reached the server and returned as an unknown outcome that locked the chat                                                         | A missing legal name is caught before sending, with where to fix it                                                                                                                                                                |
| Payment links  | Could be sent with a hand-typed Razorpay path and no send evidence                                                                                    | Hidden on the phone; sent from invoices, which own the live link                                                                                                                                                                   |

The safety rules for an unknown send outcome are unchanged. The phone stores a
marker before sending. Sending stays locked until the outcome is known, or the
person confirms they checked the chat.

## Deliberately not done

- **Templates in an open chat** (DoubleTick's attach menu, WhatsApp's `/`).
  Owners can type freely inside 24 hours. Adding it means applying the
  unknown-outcome lock to open chats, so it is a separate change.
- **Service, invoice, and payment-link prefill.** The website resolves these
  from member services and invoices. On the phone, those blanks are typed.
- **Media-header templates** (invoice document). They need a media upload
  on the phone and stay website-only.

## Implementation

- `apps/mobile/src/features/inbox/template-repository.ts`: per-row loading.
- `template-presentation.ts`: titles, labels, prefill, search, and preview segments.
- `template-context.ts`: legal name and membership, with an 8-second timeout.
- `components/template-picker.tsx`: two-step full-screen flow.
- `components/template-message-preview.tsx`: the bubble.
- The shared `src/lib/whatsapp/template-contracts.ts` is now importable from mobile.
  `template-validators.ts` and `src/types/index.ts` use relative imports because the
  mobile `@/` alias points at `apps/mobile/src`.
