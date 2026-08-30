# Contributing to UsefulDesk

UsefulDesk is a production gym CRM. Changes should advance one of four outcomes:
save the owner time, recover lost leads, collect renewals, or retain members.
Ideas outside those outcomes belong in the roadmap only after the product case
is clear.

## Before you start

1. Search existing [issues](https://github.com/aarkay1805/UsefulDesk/issues)
   and [the roadmap](./PRDs/roadmap.md).
2. Read `AGENTS.md` and only the subsystem documentation your change touches.
3. For UI work, read [the complete UI patterns guide](./docs/ui-patterns.md)
   before editing components.
4. For members, memberships, billing, payments, or attendance, read
   [the gym domain guide](./docs/gym-domain.md).

Security issues must not be discussed publicly. Use the private flow in
[SECURITY.md](./.github/SECURITY.md).

## Local setup

```bash
git clone https://github.com/aarkay1805/UsefulDesk.git
cd UsefulDesk
npm ci
cp .env.local.example .env.local
npm run dev
```

Use a development Supabase project and test provider credentials. Never copy
production secrets or customer data into a local environment, fixture, issue,
or pull request.

## Engineering rules

- Keep tenant authorization in named predicates in
  `src/lib/auth/roles.ts`, mirror it in RLS, and test both boundaries.
- Use API route handlers or RLS-secured browser calls; do not add server
  actions.
- Reuse shared UI primitives and domain helpers before creating local
  alternatives.
- Use the locale layer for gym-domain dates, times, numbers, and money.
- Do not add Zod; validation is intentionally hand-rolled.
- Do not use `supabase db push`. Apply migrations through the approved
  migration connector and verify the resulting schema and policies.
- Update both `docs/changelog.md` and `PRDs/roadmap.md` with shipped product
  work.

## Pull requests

Create a focused branch from the latest `main`, keep one logical change per
pull request, and explain the user outcome as well as the implementation.

Before requesting review, run:

```bash
npm run verify
git diff --check
```

Fill in the pull-request template with the changed behavior, verification
evidence, rollout needs, and any operational risk. Changes to authorization,
payments, public endpoints, scheduled workers, or production settings require
specific verification of those boundaries.

## Reporting bugs

Use the [bug-report
form](https://github.com/aarkay1805/UsefulDesk/issues/new?template=bug_report.yml)
and include the commit, runtime, minimal reproduction, and redacted logs. Do
not include tokens, member data, webhook payloads, or provider credentials.

## License

Contributions are accepted under the repository's [MIT license](./LICENSE).
