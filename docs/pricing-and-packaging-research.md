# UsefulDesk pricing and packaging research

**Compiled:** 31 August 2026  
**Market research conducted:** 24 August 2026  
**Primary market:** Indian gyms and fitness studios  
**Decision:** Initial subscription pricing and packaging for UsefulDesk

## Decision summary

UsefulDesk should launch with three paid tiers and one sales-led enterprise tier:

| Tier | Monthly price | Annual price | Primary customer |
| --- | ---: | ---: | --- |
| **Core** | **₹999/month** | **₹9,990/year** | A single-location gym replacing registers, Excel, and manual renewal tracking |
| **Growth** | **₹1,999/month** | **₹19,990/year** | A gym actively using WhatsApp, lead follow-ups, PT/services, automations, and financial reporting |
| **Scale** | **₹4,999/month** | **₹49,990/year** | A group with up to three branches that needs consolidated control and permissions |
| **Enterprise** | Custom, starting around **₹10,000/month** | Contracted | Five or more branches, a custom rollout, SLA, migration, or integrations |

Prices should be published exclusive of GST. UsefulDesk should not charge a percentage of the gym's collections.

**Growth should be the visibly recommended tier.** It is the package that best expresses the product's core promise: find revenue at risk, follow up on WhatsApp, collect payment, and keep every exception owned.

The recommended customer-facing value statement is:

> Recover two renewals and UsefulDesk has paid for itself for the year.

## Scope of this research

This recommendation combines:

- The product status documented in the [roadmap](../PRDs/roadmap.md), [gym domain model](gym-domain.md), and [India-first pain-point research](../PRDs/india_gym_crm_pain_points.md).
- Published Indian gym-software prices.
- Published global gym and studio-management prices.
- Payment and WhatsApp usage costs that sit outside the software subscription.
- Product-readiness constraints that affect what UsefulDesk can honestly sell today.
- A value and willingness-to-pay model based on the economics of Indian fitness facilities.

Competitor prices are public sticker prices, not negotiated quotes. Product maturity, support quality, message allowances, taxes, payment fees, hardware, onboarding, and implementation depth vary substantially. Very low published pricing should be treated as market pressure, not proof of sustainable unit economics.

## Current UsefulDesk product position

UsefulDesk is not a generic all-in-one gym ERP. It is a phone-first, WhatsApp-native operating system for renewals, collections, follow-ups, and daily exceptions.

### Capabilities that are already strong enough to sell

- Leads, contacts, members, membership plans, recurring terms, fixed terms, and session packs.
- Membership lifecycle operations including joining, conversion, renewal, freeze, cancellation, and plan change.
- Expiring, expired, due, dormant, churn-risk, and missed-attendance action lists.
- Manual attendance and plan visit limits.
- WhatsApp inbox, approved templates, one-tap reminders, automated reminder schedules, broadcasts, flows, and automations.
- Lead and member follow-ups with an owner, status, due date, and next action.
- Products and services, trainer-specific pricing, trainer history, add-on sales, and service renewals.
- CSV/XLSX migration, including resumable and service-aware imports.
- Partial payments, installment promises, credits, allocations, payment history, receipts, refunds, and corrections.
- Business overview, invoices, payments, expenses, performance reporting, and CSV exports.
- Roles, branch isolation, organization-over-accounts multi-branch foundations, and consolidated reporting.

These capabilities support a premium over basic member-register products. The strongest differentiation is the depth of the renewal-to-WhatsApp-to-collection workflow, not the total number of features on a checklist.

### Capabilities that remain gated or incomplete

- Booking and class scheduling are not shipped.
- Invoice limitation: human numbering, immutable non-tax PDF download, and application-side sharing are shipped; GST-ready and statutory documents remain deferred, and provider-side WhatsApp invoice delivery still depends on the exact template becoming Approved and synced.
- Razorpay onboarding and payment features remain controlled per account rather than universally available to every new subscriber.
- Meta Lead Ads is implemented but remains behind review and production rollout gates.
- Some WhatsApp feature contracts remain dependent on exact provider approval and synchronization.
- Multi-branch operations do not yet include unified live inboxes, cross-branch check-in, membership portability, automatic member transfers, or merged person records.

### Deliberately deferred categories

- Branded member app.
- Class marketplace.
- Payroll.
- Workout and nutrition tracking.
- Door and biometric access control.
- Loyalty.
- Family and household plans.

These omissions are strategically defensible, but they matter during price comparison. Many Indian competitors advertise several of these capabilities—even at very low prices—and global platforms often include them in their entry or mid-market packages. Sales qualification must therefore focus on gyms whose primary pain is revenue recovery and operational control rather than class booking or member-app engagement.

## Indian fitness-market economics

The [Deloitte and Health & Fitness Association India Fitness Market Report 2025](https://www.healthandfitness.org/wp-content/uploads/India-Fitness-Market-2025_FINAL_Print.pdf) estimates that India had, in 2024:

- Approximately **46,500** commercial fitness facilities.
- Approximately **12.3 million** members.
- Approximately **₹16,200 crore** in industry revenue.
- Fitness-facility membership penetration of only **0.8%**.

The report projects approximately ₹37,700 crore in revenue, 65,500 facilities, and 23.2 million members by 2030. That implies about 15% annual market growth, with memberships growing around 11% annually.

The 2024 figures imply approximately:

- **264 members per facility** on average.
- **₹34.8 lakh annual revenue per facility** on average.
- **₹2.9 lakh monthly revenue per facility** on average.

These are market averages rather than the economics of every gym. They include differences between value gyms, premium clubs, boutique studios, cities, and personal-training revenue.

### Relevant customer segments

According to the same report:

- Value facilities represent approximately 80% of centres and 78% of members. Their annual membership fees commonly range from below ₹8,000 to ₹14,000.
- Premium facilities commonly start near ₹14,000 annually and can exceed ₹50,000.
- Boutique studios commonly charge approximately ₹19,000–₹30,000 annually and are projected to be the fastest-growing facility segment.

This creates two simultaneous pricing constraints:

1. The majority of Indian facilities remain price-sensitive, so a ₹5,000 single-location entry price would sharply narrow the market.
2. UsefulDesk directly influences retained and recovered revenue, so it should not be priced like a passive attendance register.

At the recommended prices:

- Core's ₹9,990 annual price is about 0.29% of the average facility revenue above.
- Growth's ₹19,990 annual price is about 0.57% of that average facility revenue.
- Two recovered ₹10,000 annual memberships cover a full year of Growth.

This is why ₹1,999 is a credible centre of gravity: high enough to signal an operational revenue product, but still easy to justify against one or two saved renewals.

## Indian competitor pricing benchmark

The following prices were publicly visible during the research period.

| Product | Published price | Commercial signal |
| --- | ---: | --- |
| [GymAdminX](https://www.gymadminx.com/pricing) | ₹399 / ₹499 / ₹599 monthly | An extreme budget floor advertising very broad functionality and unlimited members |
| [Fitexo](https://fitexo.in/) | Standard ₹799 / ₹999 / ₹1,199; promotional ₹399 / ₹699 / ₹899 | Price-led, single-branch packaging with biometrics and broader gym operations prominent |
| [GymForce](https://gymforce.in/pricing/) | ₹9,999 and ₹14,999 annually, about ₹833 and ₹1,250 monthly | Unlimited-member pricing, annual commitment, and a quote-led enterprise tier |
| [GymOwl](https://gymowl.in/pricing) | ₹17,999 and ₹22,999 annually, about ₹1,500 and ₹1,917 monthly | An established Indian mid-market price band |
| [GrwFit](https://www.grwfit.com/) | ₹999 / ₹1,999 / ₹3,999 monthly | The closest published three-tier price staircase to this recommendation |
| [UrbanGym](https://www.urbangym.in/pricing) | Free / ₹1,499 / ₹3,999 monthly | Upgrades driven by members, staff, communication quotas, and locations |
| [Helmr](https://helmr.in/) | ₹2,499 base; a fuller single-location configuration can approach ₹5,095 | Premium India-first positioning with separately priced operational modules |
| [FitnessForce](https://www.fitnessforce.com/us/home/pricing) | $67 / $89 / $179 monthly when billed annually | A mature India/global platform priced well above most rupee-native products |

The published Indian market divides roughly into:

| Segment | Typical public price | Common positioning |
| --- | ---: | --- |
| Budget | ₹399–₹999/month | Member records, attendance, payments, and headline automation |
| Mainstream single-location | ₹1,000–₹2,000/month | CRM, renewals, reporting, staff access, and integrations |
| Premium India-first | ₹2,499–₹5,000/month | Deeper automation, billing, migration, support, and operational modules |
| Chains | ₹4,000+ or custom | Locations, permissions, consolidated reporting, onboarding, and integrations |

Core and Growth place UsefulDesk inside the mainstream Indian buying band. Scale sits at the lower end of premium chain software.

### Interpretation of very-low-price competitors

Some vendors advertise combinations such as unlimited members, biometrics, full WhatsApp APIs, member and trainer apps, GST billing, multi-branch dashboards, white-labeling, and dedicated support for below ₹1,000 per month.

Those prices should not become UsefulDesk's cost target without evidence about:

- What is genuinely live versus marketed.
- Whether messaging charges are included, subsidized, marked up, or charged separately.
- Whether onboarding, hardware, migration, and support are extra.
- Service reliability, security, data portability, and operational depth.
- Whether the price is promotional acquisition pricing.

UsefulDesk should compete on recovered revenue, clarity, reliability, and depth—not on having the lowest number on a pricing card.

## Global competitor pricing benchmark

The following approximate INR conversions use about ₹95.77 per US dollar, the observed market rate on 24 August 2026. The exchange rate is only for comparison; global products may apply regional prices, taxes, transaction fees, add-ons, and contracts.

| Product | Published price | Approximate INR equivalent |
| --- | ---: | ---: |
| [Mindbody](https://www.mindbodyonline.com/business/education/blog/new-mindbody-pricing-united-states) | From $79 per location/month | ₹7,566 |
| [Gymdesk](https://gymdesk.com/pricing) | $75–$200/month by active members | ₹7,183–₹19,154 |
| [GymMaster](https://www.gymmaster.com/gymmaster-pricing-page/) | $89 / $129 / $209 monthly | ₹8,524 / ₹12,354 / ₹20,016 |
| [Wodify](https://www.wodify.com/pricing) | From $99 per location/month | ₹9,481 |
| [Glofox](https://www.glofox.com/plans/) | From $99/month | ₹9,481 |
| [Zen Planner](https://zenplanner.com/pricing-tiers/) | $99–$289 by active members | ₹9,481–₹27,678 |
| [PushPress](https://www.pushpress.com/pricing) | $159 / $229 core; full stack around $559 | ₹15,227 / ₹21,931; full stack around ₹53,535 |

Global pricing demonstrates the category's long-term ceiling. It does not justify charging an ordinary Indian gym ₹8,000–₹15,000 per month today.

Global products often include class scheduling, online booking, waivers, member apps, workout functionality, access control, branded apps, and mature integrated payments. UsefulDesk is intentionally narrower. Its advantage is stronger Indian operational relevance: WhatsApp, UPI-aware collections, renewal action lists, negotiated and partial payments, and phone-first owner workflows.

### Review signals from global products

Public review patterns reinforce that a feature checklist is not sufficient:

- [Mindbody's Capterra profile](https://www.capterra.com/p/40229/MINDBODY/) shows a mature, broad product, but reviewers frequently raise high or unpredictable costs, add-ons, technical friction, and complexity.
- [GymMaster reviews](https://www.capterra.com/p/57469/GymMaster/reviews/) strongly praise support, value, uptime, and breadth; regional payment integrations and parts of point-of-sale usability still appear as weaknesses.
- [Glofox reviews](https://www.capterra.com/p/136861/Glofox/reviews/) praise onboarding, clean design, and integrated member operations, while other reviews mention glitches, inflexible payment behaviour, and support inconsistency.

The competitive opportunity is therefore not merely to be cheaper. UsefulDesk should be more understandable, more relevant to Indian collection behaviour, and faster at getting an owner to the next action.

## Recommended packaging

### Three-tier availability matrix

**Legend:** ✓ Included · — Not included in this tier · **Conditional** Available only after the named account or provider-readiness requirement is satisfied.

| Capability | **Core**<br>₹999/month | **Growth**<br>₹1,999/month | **Scale**<br>₹4,999/month |
| --- | --- | --- | --- |
| Best for | Running one gym without registers or spreadsheets | Recovering revenue and automating follow-up | Controlling a small multi-branch group |
| Included branches | 1 | 1 | Up to 3 |
| Included staff users | 3 | 10 | 25 |
| Unlimited members and leads | ✓ | ✓ | ✓ |
| Plans, memberships, session packs, renewals, freezes, cancellations, and plan changes | ✓ | ✓ | ✓ |
| Renewal, due, expired, dormant, and attendance action lists | ✓ | ✓ | ✓ |
| Attendance and visit limits | ✓ | ✓ | ✓ |
| Manual payments, balances, credits, installments, and payment history | ✓ | ✓ | ✓ |
| Immutable human-numbered non-tax invoice PDF download | ✓ | ✓ | ✓ |
| Basic dashboard and financial summaries | ✓ | ✓ | ✓ |
| Full invoices, payments, expenses, performance analysis, and exports | — | ✓ | ✓ |
| Self-serve CSV/XLSX member import | ✓ | ✓ | ✓ |
| Assisted standard migration | — | Annual plan | ✓ |
| Concierge migration and implementation | — | Paid add-on | ✓ |
| One connected WhatsApp number and shared inbox | ✓ | ✓ | One per branch |
| One-tap, staff-reviewed WhatsApp template sends | ✓, subject to an Approved contract | ✓, subject to an Approved contract | ✓, subject to an Approved contract |
| Automated membership, service, installment, and payment reminders | — | ✓, subject to provider readiness | ✓, subject to provider readiness |
| Full lead pipeline, public capture forms, follow-up operations, and attribution | — | ✓ | ✓ |
| Broadcasts, flows, and automations | — | ✓ | ✓ |
| Products, services, trainers, trainer-specific pricing, and service renewals | — | ✓ | ✓ |
| Razorpay payment links, AutoPay, reconciliation, and refunds | — | **Conditional:** eligible and onboarded account | **Conditional:** eligible and onboarded account |
| Meta Lead Ads ingestion | — | **Conditional:** production rollout approval | **Conditional:** production rollout approval |
| Organization and branch role controls | — | — | ✓ |
| Consolidated branch reporting and comparison | — | — | ✓ |
| Cross-branch membership portability, automatic transfers, and unified live inbox | — | — | — Not yet available |
| API and supported integrations | — | Limited | ✓ |
| Support | Standard email and WhatsApp | Priority WhatsApp | Named onboarding contact and priority escalation |

### Not available in any tier yet

The following capabilities must not appear as included on a pricing page or sales proposal until they ship:

| Capability | Current position |
| --- | --- |
| Booking and class scheduling | Not shipped |
| GST-ready or statutory invoices | Deferred pending compliance validation; current PDFs are explicitly non-tax invoices |
| Provider-delivered WhatsApp invoice documents | Application-side sharing is shipped, but provider delivery awaits an Approved and synced `gym_invoice_document` template |
| Branded member app | Deliberately deferred |
| Biometric or door access control | Deliberately deferred |
| Payroll and trainer class-delivery accountability | Not shipped |
| Workout and nutrition tracking | Deliberately deferred |
| Loyalty programme | Deliberately deferred |
| Family and household plans | Separate future work |
| Cross-branch check-in and membership portability | Deliberately deferred from the current multi-branch foundation |

The matrix describes the recommended commercial packaging. It does not override account-level provider readiness: a plan can include a workflow while the connected Meta or Razorpay account still requires approval, onboarding, or an exact contract before that workflow can execute.

### Core — ₹999/month

**Promise:** Run the front desk without registers or spreadsheets.

Best for an owner-led or reception-led single-location gym that needs clean member operations but is not yet ready for advanced automation.

Recommended inclusions:

- One branch.
- Three included staff users.
- Unlimited members and leads.
- Plans, memberships, session packs, lifecycle operations, and renewal queues.
- Attendance.
- Manual payments, invoices, balances, and basic financial summaries.
- Human-numbered immutable non-tax invoice PDF download.
- Self-serve CSV/XLSX import.
- One connected WhatsApp number and shared inbox.
- One-tap, staff-reviewed WhatsApp template sends.
- Basic follow-ups and dashboard action lists.
- Email and standard WhatsApp support.

Core must still feel like UsefulDesk. Removing WhatsApp or renewal actions from the entry tier would reduce it to an undifferentiated member database.

### Growth — ₹1,999/month

**Promise:** Recover revenue and automate follow-up.

Best for a growing single-location gym or boutique operation with a team, active lead acquisition, PT or add-on services, and meaningful renewal volume.

Recommended inclusions:

- Everything in Core.
- Ten included staff users.
- Automated membership, service, installment, and payment reminder schedules where provider contracts are ready.
- Full lead pipeline, lead/member follow-up operations, public capture forms, and channel attribution.
- Broadcasts, flows, and automations.
- Products, services, trainers, trainer-specific pricing, combined checkouts, and service renewals.
- Full invoices, payments, expenses, performance analysis, and exports.
- Priority support.
- Assisted standard migration for annual customers.
- Razorpay and Meta Lead Ads only when those capabilities are generally available for the customer's account; they must not be promised before readiness.

This should be the most prominent plan on the pricing page. It contains the workflows most likely to create measurable ROI.

### Scale — ₹4,999/month

**Promise:** Control every branch without losing local ownership.

Best for a small chain that needs central visibility while preserving branch-level WhatsApp, staff, members, finance, and permissions.

Recommended inclusions:

- Everything in Growth.
- Up to three branches.
- Twenty-five included staff users.
- One connected WhatsApp number per branch.
- Organization and branch role controls.
- Consolidated branch reporting and comparison.
- Branch-aware finance, retention, staff, and performance views.
- API access and supported integrations.
- Concierge migration and implementation.
- Named onboarding contact and priority escalation.

The sales process must disclose current multi-branch boundaries. Scale should not imply cross-branch membership portability, a unified live inbox, or automatic member transfers before those features exist.

### Enterprise — custom

Enterprise should begin around ₹10,000 per month but remain quote-led. Pricing should depend on branch count, implementation effort, integration requirements, support level, and data migration—not negotiation alone.

Potential inclusions:

- Five or more branches.
- Custom staff limits.
- Dedicated implementation plan.
- Custom data migration and validation.
- Security and access review.
- SLA and support escalation.
- Custom API or integration work priced separately.

## Pricing metric decisions

### Do not use active-member caps as the main pricing metric

Member caps are common, but they conflict with UsefulDesk's retention thesis. They encourage gyms to delete expired or dormant members to avoid upgrading, even though those records are essential for win-back and churn analysis.

UsefulDesk should include unlimited members and instead monetize:

- Locations.
- Included staff users.
- Automation and workflow depth.
- Consolidated control.
- Support and implementation effort.

This also makes the price predictable as a gym grows.

### Staff and branch add-ons

Recommended add-ons:

- **Additional staff user:** ₹199/month.
- **Additional Scale branch:** ₹1,499/month.
- **Complex concierge migration:** from ₹4,999 one time; waived for annual Growth and included with Scale.
- Custom integration work: scoped separately.

Add-ons should remain few and comprehensible. Fragmenting normal workflows into many paid modules would weaken the product's 30-second-control principle.

## WhatsApp and payment-cost policy

### WhatsApp

[Meta's official WhatsApp Business Platform pricing](https://whatsappbusiness.com/products/platform-pricing/) charges businesses per delivered message based on destination market and message category. Service messages and some in-window utility replies may be free, while marketing templates carry a charge.

UsefulDesk's exact product contracts classify membership and service renewal templates as Marketing. Installment reminders and payment links are Utility. This makes “unlimited WhatsApp” commercially risky and misleading.

Recommended policy:

- The subscription covers the inbox, staff collaboration, automation engine, templates, and workflows.
- The gym pays Meta directly through its own WhatsApp Business Account.
- UsefulDesk adds no message markup.
- The product shows delivery status, provider failures, and enough usage context for the owner to understand the bill.
- No plan promises unlimited delivered messages.

This preserves transparent unit economics and protects UsefulDesk from future Meta rate changes.

### Razorpay

[Razorpay's public pricing](https://razorpay.com/pricing/) states a standard platform fee of 2% plus GST on successful payments, with no standard setup fee or annual maintenance charge.

Recommended policy:

- The merchant pays Razorpay directly.
- UsefulDesk charges 0% of collections.
- Payment-gateway fees are clearly described as a provider cost, not part of the UsefulDesk subscription.
- Payment links, AutoPay, refunds, and reconciliation remain plan capabilities only when the account passes the required provider-readiness gates.

Avoid using payment margin to subsidize a free software plan. That would weaken the promise that the gym's collections remain its own.

## Billing and trial policy

Recommended commercial terms:

- 30-day guided trial with no credit card required.
- No free-forever plan.
- Monthly billing with cancellation at the end of the billing period.
- Annual billing priced as ten months for twelve months of service, a 16.7% discount.
- Published prices exclusive of GST.
- Standard export available without an exit fee.
- Standard spreadsheet import free; high-touch migration charged or bundled as described above.
- Upgrades prorated immediately; downgrades effective at the next billing cycle.
- No routine discount above 15% outside a documented pilot or founding-customer programme.

A 30-day trial is preferable to a 7- or 14-day trial because the primary value appears across a meaningful renewal and collection window. Trial activation should require importing real member data and connecting at least one operational workflow; an empty dashboard is not a valid evaluation.

## Founding-customer offer

For the first 20–30 qualified gyms:

- Offer the Growth package at **₹1,499/month**.
- Lock the price for 12 months.
- Require structured product feedback and permission to produce an anonymized or named case study if measurable value is achieved.
- Do not present the pilot price as the permanent public list price.
- Do not promise unfinished payment, Meta, booking, or GST-document capabilities.

The purpose of the offer is to collect evidence about activation, renewal recovery, support load, and willingness to pay—not to establish a permanently discounted customer base.

## Price increase gates

Once the following capabilities are generally available and reliable, new-customer list prices can move to:

| Tier | Current recommended price | Later target price |
| --- | ---: | ---: |
| Core | ₹999 | ₹1,299 |
| Growth | ₹1,999 | ₹2,499 |
| Scale | ₹4,999 | ₹5,999 |

The primary gates are:

1. GST-ready and statutory invoice documents; human numbering, non-tax PDF download, and application-side sharing are already shipped.
2. Broad, repeatable Razorpay merchant onboarding rather than one-off enablement.
3. Production Meta Lead Ads availability for ordinary customers.
4. Booking and class scheduling, if UsefulDesk decides to pursue class-led gyms.
5. Evidence from paying customers that the system consistently recovers or protects more revenue than it costs.

Existing customers should be grandfathered for at least 12 months after a list-price increase.

## Validation plan

The exact price points have medium confidence until UsefulDesk has real win/loss and willingness-to-pay data. The price bands have higher confidence because they are supported by public Indian and global benchmarks.

### Prospect sample

Recruit at least 30 qualified prospects across:

- Value gyms outside the top metros.
- Independent premium gyms in the top ten cities.
- Boutique fitness and PT-led studios.
- Two- to five-branch groups.

Do not combine these segments into one average willingness-to-pay result.

### Price testing

Test the same Growth package at ₹1,499, ₹1,999, and ₹2,499 among comparable prospects. Avoid changing the feature package and price simultaneously, because that makes the result impossible to interpret.

Track:

- Demo-to-trial conversion.
- Trial-to-paid conversion.
- Discount requests.
- Time to import real member data.
- Time to first WhatsApp send.
- Time to first recorded collection or completed follow-up.
- Support hours during onboarding.
- Monthly active owner and staff usage.
- Renewal recovery value attributed to UsefulDesk workflows.
- Churn and stated churn reason.
- Competitor present in the deal.

### Decision rules

- Keep ₹1,999 if its paid conversion is within approximately 20% of the ₹1,499 test while producing meaningfully better revenue per lead.
- Move toward ₹2,499 when customers can demonstrate recurring collection or retention value, price is rarely the primary loss reason, and the product-readiness gates above are closed.
- Do not reduce the public price in response to one highly price-sensitive lead. Use segment data and multiple comparable deals.
- If Scale loses to ₹3,999 competitors, determine whether the cause is price or missing cross-branch functionality before discounting.

## Positioning implications

UsefulDesk should not lead with “all-in-one gym management software.” That claim places it in a feature-count contest against products advertising apps, bookings, workouts, biometrics, access control, payroll, and inventory.

Recommended category framing:

> A WhatsApp-first revenue and operations desk for Indian gyms.

Recommended product promise:

> Know who is expiring, follow up on WhatsApp, collect on UPI, and keep every next action owned.

The tier names can reinforce this progression:

- **Core:** Run the desk.
- **Growth:** Recover revenue.
- **Scale:** Control every branch.

This packaging aligns pricing with the outcomes UsefulDesk is designed to deliver rather than with an arbitrary number of dashboard modules.

## Risks and countermeasures

| Risk | Consequence | Countermeasure |
| --- | --- | --- |
| Budget competitors anchor buyers below ₹1,000 | Growth appears expensive before value is understood | Sell on two-renewal payback, real workflows, data migration, and operational proof |
| Missing booking, apps, or biometric access | Class-led and access-led gyms reject the product | Qualify early; do not pretend those categories are supported |
| Provider rollout gates are mistaken for generally available features | Broken trust during onboarding | Maintain an explicit account-readiness checklist and honest sales copy |
| WhatsApp charges surprise customers | Subscription feels misleading | Separate Meta charges clearly and avoid “unlimited” language |
| Too many plan restrictions | Product becomes difficult to explain | Keep members unlimited and differentiate mainly by automation, team, and branches |
| High-touch imports erase margin | Cheap plans become service-heavy | Standardize self-serve imports and charge for complex concierge migration |
| Scale is compared with ₹3,999 five-location products | Price pressure on chain deals | Demonstrate branch isolation, permissions, finance depth, support, and WhatsApp-per-branch value |

## Final recommendation

Launch at **₹999 / ₹1,999 / ₹4,999**, with Growth as the hero package and Enterprise as a controlled sales-led tier.

Pricing below this range would place UsefulDesk in a commodity fight against ₹399–₹899 tools and underprice its WhatsApp, finance, follow-up, and renewal depth. Pricing materially above it would require broadly selling capabilities—booking, GST documents, member experience, and universally available payment onboarding—that are not yet ready.

The commercial model should remain simple:

- Unlimited members.
- Predictable location and team pricing.
- Two months free annually.
- No percentage of collections.
- Meta and Razorpay costs passed directly to the merchant without UsefulDesk markup.
- Paid, high-touch migration only when it creates real implementation work.

The proposed staircase expresses the product strategy cleanly: **Core runs the desk, Growth recovers revenue, and Scale gives the owner control across branches.**
