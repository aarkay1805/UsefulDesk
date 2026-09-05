# UsefulDesk

UsefulDesk is an India-first, phone-first gym CRM for renewals, payments,
attendance, leads, and WhatsApp conversations.

Its north-star workflow is simple: know who is expiring, remind them on
WhatsApp, collect on UPI, assign the next follow-up, and keep the conversation
history visible to the team.

[![License: MIT](https://img.shields.io/badge/License-MIT-violet.svg)](./LICENSE)
[![CI](https://github.com/aarkay1805/UsefulDesk/actions/workflows/ci.yml/badge.svg)](https://github.com/aarkay1805/UsefulDesk/actions/workflows/ci.yml)
[![Production](https://img.shields.io/badge/production-desk.usefulmade.com-111.svg)](https://desk.usefulmade.com)
[![Next.js 16](https://img.shields.io/badge/Next.js-16-black?logo=nextdotjs)](https://nextjs.org)
[![Supabase](https://img.shields.io/badge/Supabase-Postgres%20%2B%20Auth-3ecf8e?logo=supabase)](https://supabase.com)

## What it covers

- **Renewal action lists** for expiring memberships and services.
- **Members, plans, memberships, invoices, payments, and attendance** with
  account-local dates, money, and timezone behavior.
- **WhatsApp shared inbox** with assignment, notes, templates, broadcasts, and
  delivery/read tracking.
- **Leads and follow-ups** with pipeline ownership and reminder notifications.
- **UPI and Razorpay collection paths** including payment links, installments,
  refunds, and recurring-payment exception handling.
- **Automations and flows** for reminders, waits, webhooks, and conversational
  journeys.
- **Meta Lead Ads capture and recovery** with durable deduplication and health
  repair.
- **Multi-tenant access control** with owner, admin, agent, and viewer roles,
  enforced in both application capabilities and Postgres RLS.

## Product principles

- Phone-first and WhatsApp-native.
- Renewal-first: action lists beat passive dashboards.
- Every exception has an owner, status, and next action.
- Offline-tolerant where reception desks need it.
- No mandatory member app.
- The gym owner should understand what needs attention in 30 seconds.

## Quick start

Requirements: Node.js 20.18.1 or newer, npm 11, and a Supabase project.

```bash
git clone https://github.com/aarkay1805/UsefulDesk.git
cd UsefulDesk
npm ci
cp .env.local.example .env.local
npm run dev
```

Fill the required Supabase and provider values in `.env.local` before using
authenticated or messaging features. The app opens at
<http://localhost:3000>.

## Development checks

```bash
npm test
npm run lint
npm run typecheck
npm run build
```

`npm run verify` runs the required lint, typecheck, tests, and production build
checks in the same order as CI and the pre-push hook.

Formatting is advisory in CI and does not block deployment. The pre-commit hook
still auto-formats staged files; `npm run format` and `npm run format:check`
remain available for local formatting and inspection.

## Architecture

- **Application:** Next.js 16 App Router, React 19, TypeScript, Tailwind v4,
  Base UI/shadcn primitives, and Motion.
- **Data and identity:** Supabase Postgres, Auth, Storage, Realtime, and RLS.
- **Messaging:** Meta's official WhatsApp Business Cloud API.
- **Production:** Vercel project `useful-desk` at
  [desk.usefulmade.com](https://desk.usefulmade.com).
- **Scheduled work:** Supabase Cron is the database-owned execution path;
  GitHub Actions remains a redundant pinger and alert surface.

Read the focused documentation before changing a subsystem:

- [UI patterns](./docs/ui-patterns.md)
- [Gym domain](./docs/gym-domain.md)
- [Automations and cron](./docs/automations-and-cron.md)
- [Renewal reminders](./docs/renewal-reminders.md)
- [Public API](./docs/public-api.md)
- [Production runbook](./docs/production-runbook.md)
- [Product roadmap](./PRDs/roadmap.md)

## Contributing and security

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the development workflow. Report
security issues privately through [GitHub Security
Advisories](https://github.com/aarkay1805/UsefulDesk/security/advisories/new),
not a public issue.

## License

[MIT](./LICENSE).
