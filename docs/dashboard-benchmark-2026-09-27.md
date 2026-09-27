# UsefulDesk Home: dashboard benchmark and daily-use assessment

**Research date:** 27 September 2026  
**Status:** research and proposal. The high-confidence recommendations and queue corrections are built in code; see the roadmap for what remains  
**Audience:** owners and front-desk staff at India-first gyms, especially people who use English as an additional language and have limited experience with business software  
**Implementation plan:** [Roadmap — Home simplification](../PRDs/roadmap.md#proposed--home-simplification-after-the-first-fold-2026-09-27)

## Recommendation

Make the area below the first fold a short list of people who need action. Prioritize due follow-ups, renewals, unpaid fees, and unanswered enquiries. Show smaller, conditional prompts for trials, missed visits, and AutoPay exceptions. Move historical message charts, the enquiry score, and stage analysis out of everyday Home.

The practical test for a Home section is: **Can the owner tell who needs help, why, and what to do next without interpreting a chart or opening several pages?**

Keep the existing first-fold summary and quick actions outside this redesign's scope. A summary number and its actionable list can coexist: “7 renewals due” answers how much work exists; names and expiry dates answer who to contact. Repeating the same number in another large card does not help.

These are product recommendations, not findings from interviews with UsefulDesk customers. Competitor presence demonstrates a design pattern, not proof that our owners need it.

## Scope and evidence quality

Seven reference products were examined: FitnessForce, Gymex, Gymdesk, GymMaster, PushPress, Mindbody, and ABC Glofox. They span India-oriented operations, independent gyms, and larger fitness/studio suites. This is a purposive comparison, **not a verified market-share ranking or an assertion that all seven are equally popular in India**.

Evidence labels:

- **Documented Home:** official documentation explicitly describes the landing dashboard or a widget on it.
- **Documented workflow:** official guidance explains the feature, but does not establish its default Home placement.
- **Marketed:** a vendor feature page describes the capability; interaction and default layout were not independently tested.
- **Source inspection:** UsefulDesk behavior established from the current checkout, including its migration definitions. Production database state and live rendered behavior were not inspected.

No competitor accounts were created, sales demos attended, or customer workflows exercised. Exact visual emphasis, mobile usability, subscription entitlements, and live default layouts remain unverified unless the source explicitly describes them. A missing mention means **not established**, not “the product lacks it.” “Dashboard” sometimes means the entire admin application; those references are not automatically counted as Home widgets.

For UsefulDesk, “below the fold” means the sections after **Today at a glance** and **Quick actions** in source order. The actual fold depends on viewport and data; this report does not claim pixel measurements. Existing research in [India gym CRM pain points](../PRDs/india_gym_crm_pain_points.md) provides context, not fresh customer validation.

## What the reference products put on their dashboards

| Product and fit                                                           | What the evidence actually establishes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Pattern worth borrowing                                                                                                                | What should not drive our default Home                                                                                                    |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **Gymdesk** — independent gyms and martial arts schools                   | **Documented Home:** monthly scheduled/received/overdue payments; seven-day attendance; today's sessions and live check-ins; assigned tasks; optional birthdays; notifications; overdue balances with invoice access. [Dashboard guide](https://docs.gymdesk.com/en/help/docs/dashboard)                                                                                                                                                                                                                                                      | Money and named follow-ups appear together; payment problems lead to an invoice action. Optional relationship reminders stay optional. | Promotion eligibility and class schedules belong to that gym's operating model. Birthdays need not compete with unpaid fees.              |
| **FitnessForce** — relevant India-oriented sales and operations reference | **Documented legacy Home:** dated manual and automated follow-ups, including renewal, balance, enquiry, and trial work assigned to staff. The older guide does not prove the current NxT landing layout. [Follow-up guide](https://support.fitnessforce.com/portal/en/kb/articles/follow-up-feature-6-1-2021). **Current documented workflow:** NxT separates CRM tasks, appointments, trials, communication, and completed-work reports. [NxT CRM guide](https://help.fitnessforce.com/en/article/fitnessforce-sales-crm-user-guide-q9chff/) | Give each follow-up a due date and responsible person. Keep work to do distinct from reporting on completed work.                      | Department setup and configurable follow-up machinery should not be necessary to understand a small gym's Home.                           |
| **Gymex** — India-oriented club operations                                | **Marketed admin-app capabilities:** dashboard, collections, targets versus achievement, attendance, bills/payments, follow-up-call status, approvals, expenses, and income versus expenses. The page lists app capabilities; it does not prove that each is a Home widget. [Admin-app page](https://gymex.online/features/mobile-apps.html)                                                                                                                                                                                                  | Owners need to check collections and staff follow-through from a phone.                                                                | A catalogue of admin features is not a reason to put all of them on Home. Targets and expenses can remain in Business.                    |
| **GymMaster** — configurable club operations                              | **Documented Home:** configurable tabs and staff-specific widgets, metrics linking to reports, weekly bookings, a prospect funnel with stage drill-down, and an AI assistant. [Dashboard guide](https://www.gymmaster.com/help/help_navigating_your_dashboard/)                                                                                                                                                                                                                                                                               | A count should open the exact list behind it. Different staff need different information.                                              | Asking a novice owner to design a dashboard or type an analytical question adds setup and reading work. Good defaults matter more for us. |
| **PushPress** — class and coaching operations                             | **Documented Home:** reference metrics, role-controlled visibility, milestone outreach, and a consistent navigation structure. Exact metric names are not listed in the overview. [Core guide](https://help.pushpress.com/en/articles/10270346-how-to-use-the-pushpress-core-dashboard). A separate guide explicitly documents dashboard class check-in. [Check-in guide](https://help.pushpress.com/en/articles/5099488-core-check-in-coach-check-in-options)                                                                                | A dashboard can support an immediate operational action, not merely link to reports.                                                   | Class controls deserve space when classes drive the business. They are not a default requirement for an open-floor gym.                   |
| **Mindbody** — broader fitness, wellness, and studio suite                | **Documented navigation:** reports, dashboards, and the former client-acquisition Home view are placed in Insights. [Navigation update](https://www.mindbodyonline.com/business/education/blog/whats-new-your-updated-navigation-and-more). **Marketed analytics:** sales, attendance, utilization, and member analysis; this does not establish the current default Home arrangement. [Reporting page](https://www.mindbodyonline.com/business/reporting)                                                                                    | Give periodic analysis a clear destination separate from daily work.                                                                   | Analytics breadth, predictive scores, and capacity reporting should not become requirements for understanding Home.                       |
| **ABC Glofox** — gym and studio growth reference                          | **Documented analytical dashboard:** the Sales Activity view in the Insights add-on covers sales streams and money owed, with drill-down. This is not proof of default Home contents. [Insights guide](https://support.glofox.com/hc/en-us/articles/46425248290068-Glofox-Insights-Optimize-Your-Revenue-Streams). Its report directory separately lists failed payments, member losses, and lead conversion. [Reports](https://support.glofox.com/hc/en-us/sections/46375732354836-Reports)                                                  | Separate analysis from exception handling; preserve drill-down to the people or transactions involved.                                 | Do not reproduce a full analytical dashboard on a daily action page.                                                                      |

**Selection caveat:** Traqade/Gympik appeared in discovery, but reliable current first-party dashboard evidence was not established. It is excluded from the main comparison rather than treating older listings or another vendor's claims as current product truth. TraqGym is a different product and was not substituted for it.

### What this comparison supports

The strongest directly documented daily patterns are **payments, named follow-ups, and today's operations**. Gymdesk connects overdue balances to invoice actions; FitnessForce connects follow-up events to responsible staff; PushPress connects the class dashboard to check-in. The inference for UsefulDesk is to shorten the path from a known problem to the relevant person and action.

There is also counterevidence to a simplistic “charts are bad” conclusion: GymMaster deliberately includes report-linked metrics and a funnel. Those can serve a manager. Our recommendation to move historical charts is a **fit decision for UsefulDesk's intended users**, not a claim that competitors have stopped using charts.

Mindbody and Glofox demonstrate that dedicated analysis surfaces are a legitimate product choice. UsefulDesk already has Business → Overview and Performance, so it need not add a new destination just to preserve every Home chart.

## Our current sections: keep, reduce, move, or repair

Source entry points: [Home composition](<../src/app/(dashboard)/dashboard/page.tsx>), [historical insights](../src/components/dashboard/dashboard-insights.tsx), and [shared section layout](../src/components/dashboard/dashboard-section.tsx).

| Current section after quick actions | Daily value                               | Recommendation                                                     | Reason and required change                                                                                                                                                                                                                               |
| ----------------------------------- | ----------------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Follow-ups**                      | High                                      | **Keep prominent; focus the initial preview on overdue and today** | Existing commitments deserve attention. Upcoming work remains accessible through an explicit control/full list rather than filling today's preview. This is a proposed change from the current all-open queue. Keep Enquiries/Members filters secondary. |
| **Expiring memberships**            | High                                      | **Keep prominent**                                                 | Renewal is our core job. Make the nearest expiry clear and provide the existing member/renewal flow. A warning badge for every member in a seven-day window gives all dates similar urgency; reserve strong emphasis for genuinely imminent work.        |
| **Not contacted yet**               | High in principle                         | **Repair its meaning before emphasizing it**                       | The current predicate is not proof of no contact, and excludes enquiries less than 24 hours old. Fresh interest should not need to become a day old before appearing as work.                                                                            |
| **Recent activity**                 | Low for routine action; useful for review | **Remove its equal-sized daily-work slot**                         | It describes messages, enquiries, broadcasts, and automations that happened. It is not a complete financial or staff audit. Preserve appropriate history in its owning surfaces; do not replace it with another large feed on Home.                      |
| **Needs attention**                 | Mixed                                     | **Use compact, actionable exceptions**                             | Trials and payment problems matter when present. Zero-valued categories should not demand the same space every day. Risk labels must lead to an exact, explained list.                                                                                   |
| **Messages**                        | Usually weekly troubleshooting            | **Move off Home**                                                  | Sent/received volume does not identify the person awaiting a reply. Reuse a suitable reporting surface only where there is a clear question; do not build a new page solely to rescue this chart.                                                        |
| **Enquiry score**                   | Hard to act on daily                      | **Remove from Home; reconsider the composite itself**              | It combines five measures with preset targets and weights. A radar shape and one score require interpretation. In Business → Performance, prefer underlying counts and denominators where they add information.                                          |
| **Enquiries by stage**              | Weekly sales review                       | **Move analysis to Business → Performance**                        | Stage counts and average days help diagnose sales progress. Daily Home should expose the specific unanswered enquiry or due follow-up. Preserve direct operational stage filtering in Enquiries.                                                         |

The two paired queue rows are currently capped at 480px per section. That keeps desktop rows bounded, but it is not evidence that four independently scrolling cards work well on a phone. Test short previews and ordinary page scrolling as an alternative. Any change must revise the shared dashboard rule deliberately rather than override masters locally.

### Data-definition issues to resolve before redesign

These are source-level findings, not reproduced incidents in a live customer account.

1. **“Not contacted yet” is a proxy.** The latest full snapshot migration selects contacts with a null `lead_status`, created more than 24 hours ago, without a membership. It does not check an outbound human reply, a logged call, or a completed contact attempt. A service-only customer is not explicitly excluded in this predicate. Define enquiry eligibility consistently with the contact-backed directory, and define how a recorded contact attempt clears the list. Automated replies should not silently count as a human handling the enquiry.
2. **The expiry list is not limited to people without follow-ups.** Its component comment describes unassigned renewal work, but the SQL does not exclude an open follow-up. A person can appear in both lists. That can be valid, but should be explicit: show existing follow-up context, and never encourage creation of a second open follow-up.
3. **“May leave” and “Members at risk” represent different things.** The first is a saved churn-risk flag; the first-fold number is based on missed/absent visits. Their destinations differ. Do not sum them into a new count or imply they are disjoint populations. Use concrete reasons and a common recovery route where feasible.
4. **“AutoPay payments that failed” is stronger than the data.** The attention aggregate counts memberships with a failed mandate and no active mandate. That is not identical to a failed debit. Separate AutoPay setup failure, charge failure, and an unpaid balance before choosing copy and next action.
5. **Trial follow-up has an unbounded past.** The aggregate includes unconverted, non-cancelled trials ending on or before today plus three days. Old unresolved trials can remain indefinitely. Decide how a completed follow-up with “not joining” retires the work; conversion and cancellation alone may not represent every real outcome.
6. **Some counts lose context when opened.** “May leave” links to All members and AutoPay problems to Payments without a specific issue filter in the URL. A user should not have to rediscover the people counted on Home.

Evidence: [snapshot migration](../supabase/migrations/20260828200000_avoid_dashboard_timezone_catalog_scans.sql), [attention aggregate](../supabase/migrations/20260828120000_dashboard_action_attention.sql), [attention UI](../src/components/dashboard/needs-attention-card.tsx), [expiry UI](../src/components/dashboard/expiring-memberships.tsx), [first-fold metrics](../src/components/dashboard/gym-metrics.tsx). The subsequent [dues optimization](../supabase/migrations/20260829020000_reduce_dashboard_action_snapshot_dues.sql) changes the dues view, not these queue predicates.

The score's targets and weights are in [lead-conversion-rating.ts](../src/lib/dashboard/lead-conversion-rating.ts). They are application constants; this research has not established them as valid benchmarks for Indian gyms. Moving the same score elsewhere should not be presented as validating it.

## Real-life situations the Home page should support

Illustrative names and amounts below are fictional. Scenarios are hypotheses to test with owners, not observed customer behavior.

| Situation                                   | What the owner needs to see                                                             | Immediate action                                                     | When the work is actually resolved                                                                                                                      |
| ------------------------------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ravi said he would pay ₹1,500 today         | Ravi, ₹1,500 due, promised date, responsible staff, last contact                        | **Record payment** after confirming receipt; otherwise **Follow up** | The relevant collectible balance is settled, or the follow-up is completed with an explicit next date. A message alone is not payment.                  |
| Asha's membership expires tomorrow          | Asha, expiry, plan, latest reminder and any open follow-up                              | **Send reminder** or open the existing **Renew** flow                | Renewal succeeds or a clear follow-up is owned. A sent reminder does not mean renewed.                                                                  |
| A new enquiry asked about fees this morning | Name, message/question, waiting time, assigned person or unassigned state               | **Chat** or **Call**                                                 | A real contact attempt is recorded. A follow-up may remain if they asked for a later call.                                                              |
| Staff promised to call at 6 pm yesterday    | Name, short note, **Overdue**, assignee                                                 | **Call**, then **Mark done** with outcome                            | The commitment has a saved result; another date is explicit if needed.                                                                                  |
| A trial ends today                          | Name, trial expiry, visit evidence where available, existing follow-up                  | **Follow up**; **Add as member** when agreed                         | Joined, declined, or next contact date recorded. Old closed trials stop reappearing.                                                                    |
| Neha has no recorded visit for 12 days      | Name, last recorded visit, whether frozen, and last contact                             | **Call** or **Follow up**                                            | Attendance resumes or staff records a valid reason/next contact. Missing attendance data must not be presented as certainty that she stopped attending. |
| AutoPay could not be set up                 | Name, setup status, plain reason, unpaid amount only if genuinely due                   | Open the appropriate setup/recovery flow                             | Setup is repaired or another payment arrangement is recorded; do not imply a debit happened.                                                            |
| Owner checks the gym at night               | Existing **Collected today**, then an exact payments list and method totals in Business | Review cash/UPI entries                                              | Owner can find a disputed entry and who recorded it. A generic recent-activity feed is insufficient.                                                    |

Payment and renewal are separate facts: collecting old dues must not silently renew a membership, and renewing must not silently erase old dues. Use the existing checkout, invoice, payment, and follow-up flows.

## Proposed information order

The plan should be tested in two steps: reduce unnecessary content first, then add only the missing work preview that proves useful. Do not replace eight sections with eight differently named sections.

| Position below the existing first fold | Default presentation                                                   | Conditional or secondary content                                                                 |
| -------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 1                                      | **Follow-ups** — overdue first, then due today; 3–5 visible people     | Upcoming and audience filters; full list access retaining the selected scope                     |
| 2                                      | **Expiring memberships** — nearest expiry first; 3–5 visible people    | Existing follow-up/reminder context; exact Renewals link                                         |
| 3                                      | **Fees to collect** — proposed short list, replacing the activity slot | Promises due today and genuinely collectible overdue fees; no duplicate summary total            |
| 4                                      | **Not contacted yet** — repaired definition, including fresh enquiries | Short preview; a time-sensitive unanswered chat can produce a compact prompt near the top        |
| 5                                      | Compact exceptions only when relevant                                  | Trials needing contact, reliable missed-visit signals, and correctly classified AutoPay problems |
| End                                    | A quiet route to **Business** for periodic review                      | No radar score, message-volume chart, or generic activity wall                                   |

This is a starting hypothesis, not an instruction to permanently rank all new enquiries below all renewals. Due-time urgency can promote a compact notice; avoid silently reshuffling the whole page each visit. Keep positions predictable and mark urgency inside the lists.

On desktop, a useful candidate is Follow-ups beside Expiring memberships, then Fees to collect beside Not contacted yet. On a phone, keep the same reading order, use short previews, and make the full queue easy to open. Do not force a sideways table or require discovering a scrollbar inside every card.

**Decision point:** test whether the existing first-fold Fees to collect link already gets owners to payment work quickly enough. If it does, omit the new fee preview. Reducing Home is a valid outcome; filling the vacated activity slot is not a requirement.

### Rules that make the lists dependable

- One person may have multiple real issues, but no duplicate open follow-up. Show the current follow-up or its owner instead of creating competing work.
- Each preview has an exact underlying population and destination. Counts, names, filters, date window, and branch agree.
- Keep renewal eligibility consistent with existing domain rules: recurring membership chase, not indiscriminate fixed-term/session-pack reminders. Treat service renewals separately unless explicitly included with clear context.
- Only genuinely collectible balances belong in collection work. Exclude settled, cancelled, future-only, and refund-review amounts using existing domain predicates. State whether the queue covers membership dues or all invoices; do not silently expand it.
- Show a recent reminder/contact fact before inviting another send. Scheduling work changes responsibility; it does not make a financial balance disappear.
- Do not clear a row merely because a request was started. Failed or uncertain writes remain recoverable. Refresh successful mutations without resetting the user's place.
- Zero, loading, unavailable, and incomplete-data states are different. “Could not load payments” must never look like “No fees due.”
- Owner/Admin sees team work; a proposed Staff default can emphasize assigned work while preserving authorized unassigned/team access. Implement only through the existing capability and branch boundaries.
- WhatsApp actions retain connection/template readiness and existing send rules. Expose one clear resolution when blocked; keep appropriate call/manual workflows usable.

## Language and comprehension

Limited English does not imply limited business judgment. Owners can understand their fees, people, and promises while finding unfamiliar software vocabulary exhausting. Design around those familiar facts.

Research with novice and low-literacy populations found substantial barriers with text-based mobile interfaces and benefits from suitable graphical or spoken alternatives. Those participants and tasks differ from our gym owners; use the research to motivate testing, not to label this audience or promise that icons solve the problem. [Microsoft Research, 2011](https://www.microsoft.com/en-us/research/publication/designing-mobile-interfaces-for-novice-and-low-literacy-users/)

| Avoid on daily Home                                       | Prefer                                                                          | Why                                                     |
| --------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------- |
| A composite enquiry score, such as 68/100                 | “4 enquiries need a reply” — only when supported by actual reply state          | Names a job with an end                                 |
| “Expires in 3d”                                           | “Expires in 3 days”                                                             | Removes an abbreviation                                 |
| “Churn risk” or an unexplained “May leave”                | A concrete supporting reason such as “No visit recorded for 12 days”            | Separates evidence from prediction                      |
| “₹18,000 revenue at risk” as if it were an unpaid invoice | Separate actual fees due from future renewals                                   | Avoids confusing money owed with uncertain future sales |
| “Resolve”, “Manage”, “View details” everywhere            | The applicable **Call**, **Chat**, **Record payment**, **Renew**, **Follow up** | Describes what will happen                              |
| Only an icon or colour for urgency/action                 | A familiar icon plus a short label and date                                     | Does not depend on remembering symbols                  |

Retain canonical terms from [UX copy](ux-copy.md): Home, Enquiries, Follow-up, Fee, Expiry, AutoPay, and Record payment. New synonyms or renamed shared concepts require a glossary decision across the product, not a Home-only rewrite.

Use name/photo first, one short reason second, the relevant date or amount, then a clearly labelled action. Put optional staff detail and history behind that. Do not shrink text or hide the only action on hover to fit more information. Use account-local dates and money; examples in this report use INR only for illustration.

Regional formatting is already supported; translation is not. Test owners' preferred spoken and reading languages before selecting a pilot language. If simple English still blocks completion, plan a small, professionally reviewed regional-language pilot for the core actions and error messages. Do not assume Hindi suits every Indian gym, and do not make users type English prompts into an AI assistant to perform basic work.

## How to validate this with owners

Recruit 6–8 people across owner-operated gyms and gyms with front-desk staff, including people who prefer a regional language. This is a qualitative discovery sample, not statistically representative market research. Conduct sessions on their usual phones, in the language they prefer, using fictional data.

Compare the current page and a simpler prototype; alternate which is shown first. Give situations rather than UI instructions: “Ravi promised to pay today; find him and record ₹500,” “Who should be called first?”, “A new enquiry asked about fees,” and “The reminder could not be sent.” Ask participants to explain what they expect before pressing an action.

Proposed acceptance targets, to establish before implementation:

- At least 5 of 6 participants identify the first useful action within 30 seconds without explanation.
- At least 5 of 6 complete each core scenario without facilitator navigation help; report results per scenario, not only an average.
- No participant mistakes reminder sent for fee paid or membership renewed. Any such mistake requires another design pass.
- Participants can distinguish an empty list from a loading/error state and recover from a failed action.
- Every visible count opens the matching people; test branch changes, overlapping reasons, existing follow-ups, settled invoices, and stale trial records.
- A 375px phone layout and large text retain the name, reason, amount/date, and action without horizontal page scrolling. Test both ordinary scroll and the current nested-scroll approach.

After a controlled rollout, compare overdue follow-ups remaining, median time to first human enquiry response, eligible renewal completion, and confirmed dues collected. Establish a baseline first; separate adoption from outcomes, and do not attribute all collection changes to a layout change. Track errors and duplicate reminders as guardrails. Time spent on Home and chart clicks are not success measures by themselves.

## Decisions ready for planning

**High-confidence recommendation:** demote Recent activity, remove the historical charts from daily Home, retain named work queues, and correct misleading queue definitions/destinations.

**Needs owner validation:** fee-preview usefulness, exact order of renewals versus fresh enquiries, due-only versus all-open follow-up preview, mobile nested scrolling, and whether regional-language support is necessary for successful completion.

**Defer:** dashboard builders, more KPI tiles, AI chat as the primary navigation, a new risk score, sales targets on Home, birthday blocks by default, and class schedules for gyms that do not run scheduled classes.

The implementation batches and their acceptance criteria live in the [roadmap](../PRDs/roadmap.md#proposed--home-simplification-after-the-first-fold-2026-09-27). This report is the evidence and decision record; it does not mark any redesign as shipped.
