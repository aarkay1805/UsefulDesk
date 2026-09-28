# Home comparison study — 28 September 2026

**Status: prototype and protocol ready. No owner/front-desk sessions have been
run or claimed. No production order or default has been selected.**

## Open the prototype

Run `npm run dev`, then open `/preview/home-study`. The server returns Not found
in a production build. The page uses fictional names, a fixed 28 September 2026
practice date, and in-memory actions. Reloading restores the fixture.

The first fold uses the existing `GymMetrics` and `QuickActions` masters.
Below it, the harness composes `DashboardSection`, the queue spacing/count/empty
masters, `MemberIdentity`, `FollowUpTaskLine`, and the unchanged Card, Chip,
ScrollArea, Button, Badge, and Dialog primitives. Source is
`src/app/preview/home-study/`. This is a comparison harness: full lists and
actions open practice dialogs rather than the production Members/Enquiries
pages. It does not establish production workflow or device acceptance.

Open **Study controls** before a session. Each change resets practice records.
**Reset practice** keeps the selected comparison; **Load baseline** restores
all-open, eight-row scrolling previews, fees linked from the first fold,
renewals before fresh enquiries, and Details-first actions. Collapse the
controls, return to the top, and let the existing number animation finish
before timing a participant. Do not show the controls during a task.

| Comparison          | A                              | B                                           | Keep fixed                                        |
| ------------------- | ------------------------------ | ------------------------------------------- | ------------------------------------------------- |
| Follow-up scope     | All open                       | Overdue and due today                       | Scrolling, no fee preview, section order, actions |
| Phone preview       | Eight rows, internal scrolling | Three rows, page scrolling                  | All open, no fee preview, section order, actions  |
| Fees                | First-fold link only           | Same link plus fee preview                  | All open, scrolling, section order, actions       |
| Exploratory order   | Renewals before new enquiries  | New enquiries before renewals               | Other settings                                    |
| Exploratory actions | Details first                  | Call / Chat / Record payment / Renew labels | Other settings                                    |

Both follow-up versions retain **Upcoming**. The shared chip-strip arrows
expose it on narrow phones. **See all** opens exactly the current practice
list, including the chosen follow-up audience/date bucket. This simulated
combined list exists only in the study; production Home still links its
separate enquiry/member queues.

The fee fixture starts with two collectible membership invoices: Kavita's
older August invoice, ₹1,500, and Aarti's September invoice, ₹2,500. It uses
`isCollectiblePeriod` with membership status; cancelled memberships, void
invoices and sub-display residues are excluded. Scope matches membership fees,
including arrears; standalone service/product invoice balances are outside
this preview. These are precomputed fictional membership-line balances, not
an alternative invoice calculator or new production dues query.

**Send reminder** changes neither the fee nor expiry. **Record payment** removes
that invoice's practice balance but does not renew. **Renew** removes the
practice renewal row without collecting a fee. **Mark done** closes only the
chosen follow-up. Call and Chat simulate completing a human contact; a new
enquiry then leaves Not contacted yet. Quick actions and reports outside the
scenarios show an out-of-scope notice. Nothing sends to WhatsApp, places a call,
creates a ledger entry, or writes to Supabase from these practice actions.

## Recruit and run

Recruit six owners/front-desk staff, with up to two additional sessions to
investigate failures. Include different usual phone sizes, experience levels,
and preferred languages. Record the actual mix; do not claim representativeness.
Use their usual phones and text-size settings. Ask their preferred spoken and
reading language separately; do not default to Hindi or equate English fluency
with business understanding. A facilitator may translate the scenario, but
must not translate labels selectively to rescue a failed navigation task.

Use only this fictional dataset. Explain that no real message or money leaves
the page. Ask permission for any recording; otherwise take anonymized notes.
Do not collect phone numbers or customer details. Give participants neutral
IDs P01–P08.

For each pair, alternate AB/BA order across participants. Rotate the three
primary comparisons so every pair appears early and late. Reset the same
fixture before each run; record the order and any learning effect. Ask for
preference only after observing completion. The optional order/action controls
are exploratory; do not change several variables and attribute the result to
one. Do not turn a facilitator's preference into owner evidence.

Start the clock when the stable Home view is visible. Stop at the first useful
action and at each scenario's completion. Allow think-aloud without coaching.
If stuck, record the failure and elapsed time before giving help; assisted
completion is not an unassisted pass. Pause timing for a device/network failure
and record it separately.

## Core scenarios and scoring

Read the task only. The success criteria are for the observer.

| ID  | Neutral task                                                          | Observable success                                                                                                                                                                                     |
| --- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| S1  | “You have just opened the gym. Find the first useful thing to do.”    | Identifies a real task and opens its action within 30 seconds; record which task and why.                                                                                                              |
| S2  | “Rohit asked for a call and it is late. Finish that follow-up.”       | Finds Rohit, completes the practice call, then Mark done; his follow-up leaves the list and counts change. A call alone is not a completed follow-up.                                                  |
| S3  | “Priya asked you to call on Friday. Find when and what you promised.” | Reaches Upcoming or the full list without help; identifies 2 October and the membership discussion.                                                                                                    |
| S4  | “Send Aarti a membership reminder. Now tell me what changed.”         | Sends the practice reminder; independently says the payment and renewal have not happened. Observer then checks unchanged ₹2,500 and 29 September expiry. Do not teach this distinction before asking. |
| S5  | “Kavita has now paid her unpaid August membership fee. Record it.”    | Finds Kavita through the first-fold link or fee preview, identifies INV-000041 / ₹1,500 / August, records payment; her balance leaves the queue while her membership expiry remains.                   |
| S6  | “Sana asked about the monthly fee. Contact her.”                      | Reaches Not contacted yet and completes a practice Call or Chat; Sana leaves that list. Record scroll/reversal costs.                                                                                  |

After S4, optionally renew Aarti in a reset fixture and ask whether money was
collected. After S6, ask where remaining work would be found when the preview
is short. Record mistaken people, wrong invoices, repeated reminders,
accidental closures, and confusion between follow-up completion and renewal.
These errors matter even when the final task is completed.

## Blank result record

**Completed participant sessions: 0.** Fill one row per participant × comparison
× scenario. Leave unknown cells empty; do not copy automated test outcomes here.

| Participant | Role / experience | Phone / text size | Spoken / reading language | Variant + order | Scenario | First action seconds | Completion seconds | Unassisted pass | Wrong action / confusion | Coaching / language need | Evidence reference |
| ----------- | ----------------- | ----------------- | ------------------------- | --------------- | -------- | -------------------- | ------------------ | --------------- | ------------------------ | ------------------------ | ------------------ |
|             |                   |                   |                           |                 |          |                      |                    |                 |                          |                          |                    |

For every failure, retain the scenario, variant, participant's words,
observed navigation, and recovery. Summarize recurring language needs without
assuming translation alone is the solution. Keep a separate decision log:

| Decision          | Observations supporting it | Counter-evidence / failures | Owner | Date | Accepted / deferred |
| ----------------- | -------------------------- | --------------------------- | ----- | ---- | ------------------- |
| Follow-up default |                            |                             |       |      | Deferred            |
| Preview length    |                            |                             |       |      | Deferred            |
| Fee preview       |                            |                             |       |      | Deferred            |
| Section order     |                            |                             |       |      | Deferred            |
| Labelled actions  |                            |                             |       |      | Deferred            |

Acceptance remains the roadmap's qualitative target: at least five of the
first six participants find a first useful action within 30 seconds and
complete each core scenario without navigation coaching; nobody confuses a
sent reminder with payment or renewal. Report any seventh/eighth sessions
separately with their actual denominators. Do not present this as statistical
validation. Prefer fewer sections when extra content does not improve task
completion. A failed scenario requires revision/retest, not an averaged-away
pass.

Only after real evidence: agree order/defaults, update `docs/ui-patterns.md`,
then pilot the accepted change. Record a baseline for due follow-ups cleared,
first human response, eligible renewals, confirmed collections, errors, and
duplicate reminders. Financial outcomes have multiple causes.

## Engineering evidence and limits

`npm run verify` passed: lint, typecheck, 508 test files / 3,964 tests, and
the production build. After the final prototype dialog fix, its five tests
and typecheck passed again. Browser checks used 1280px and 390px viewports;
the final fee-list-to-details transition exposes only one active dialog and
returns focus to the first-fold fee link. No console errors were captured.

Automated coverage checks Upcoming and truncation, full fee-list access,
reminder/payment/renewal separation, task completion, collectible-fee exclusions,
and the production gate. Browser inspection at 390px reproduced and fixed
chip-wrapper horizontal overflow; Upcoming then remained reachable without
moving the card. These are engineering checks, not participant results.

Production queue repairs accompanying the harness:

- Enquiry Follow-ups now loads its open tasks and joined contacts directly,
  so Not joining contacts and later membership/service customers retain their
  scheduled work. First response keeps the active-enquiry definition.
- Home's scoped See all links explicitly request Team, while ordinary page
  visits retain My work. Member and enquiry destinations accept that scope.
- Renewal counts and pages left-join plans and filter the parent with
  `plan_id IS NULL OR matching recurring plan exists`. A one-time/session plan
  filtered out of the embed must never masquerade as a legacy NULL plan.
- Public API sends pass trusted provenance to the shared sender and persist
  as `bot`; staff sends remain `agent`, the Home contact-attempt definition.
  Older API messages are indistinguishable from staff history, so no speculative
  backfill is performed. Flow handoff behavior is unchanged.
- Chats' Members chip and badge include service-purchase history, consistent
  with the existing Members directory. Existing bounded contact pre-lookups
  (500) are unchanged; this repairs classification, not Inbox scalability.

No database migration is required. No real message send, payment, or owner study
was performed. Performance → Enquiry sources / Joined (%) still requires an
explicit definition of whether a service purchase counts as joining.
