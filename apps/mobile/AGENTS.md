This file supplements `../../AGENTS.md`. The root file is canonical for
product, tenancy, authorization, localization, domain, and documentation rules.

- Keep the Next.js app at repository root; mobile lives in `apps/mobile` and
  uses the single repository `package-lock.json`. Never commit a nested
  lockfile, nested `.git`, or generated `ios`/`android` directories.
- Feature code imports UsefulDesk native masters from `src/ui`; only
  `src/core/mobile-app-providers.tsx` and `src/ui` may import `heroui-native`.
  Do not import web UI, DOM, Next.js, or browser-only modules.
- The installed app may contain only public Supabase URL, anon key, and
  UsefulDesk API base URL. Never embed service-role, UsefulDesk API, Meta,
  Razorpay, or other server credentials.
- Persist Supabase Auth in SecureStore. Revalidate stored branch membership on
  startup; branch-scoped PostgREST requests carry
  `x-usefuldesk-account-id` and invalid, unauthorized, or archived branches
  fail closed.
- This foundation exposes no customer send, internal staff chat, payment,
  attendance, or provider mutation and ships no dead product tabs.
