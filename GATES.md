# Gates: UsefulDesk production go-live

OWNS: GATES.md, .github/workflows/production-health.yml, docs/backups.md, docs/automations-and-cron.md, docs/production-runbook.md, docs/changelog.md, PRDs/roadmap.md, src/lib/meta/**, src/app/api/meta/**, src/lib/whatsapp/**, src/lib/payments/**, src/app/api/payments/**, src/components/settings/**, supabase/migrations/**

Scope: Close the production foundation gates first, then remove and verify the Meta Lead Ads, WhatsApp template, and Razorpay launch blockers without performing unapproved production mutations.

- [x] G1: the active production backup age identity is stored in the owner-approved Apple Passwords vault and its replacement backup completed successfully
      EVIDENCE: 2026-08-23 the owner confirmed Apple Passwords storage, the replacement identity passed a local encrypt/decrypt round trip, GitHub's public recipient was updated, and full database-and-Storage run 32657700769 remotely verified both encrypted archives.

- [ ] G1B: a physically separate offline recovery copy of the active production backup identity exists
      EVIDENCE: 2026-08-23 the owner explicitly declined an encrypted USB or other separate offline copy and accepted reliance on Apple Passwords plus the permission-restricted source on this Mac.

ABANDON: G1B owner explicitly chose to omit the separate offline recovery copy after the single-copy resilience risk was explained

- [ ] G2: Supabase leaked-password protection is enabled in the production project and its enabled state is verified without recording secret material
      EVIDENCE: 2026-08-24 the production Auth dashboard exposed the setting as Pro-plan-only; current Supabase documentation confirms the entitlement requirement, so protection remains disabled and this gate is unmet.

ABANDON: G2 owner chose the no-cost fallback instead of upgrading Supabase to Pro after the entitlement, benefits, and residual breached-password risk were explained

- [x] G2B: production Supabase Auth enforces the owner-approved no-cost password policy of at least 12 characters with lowercase, uppercase, digits, and symbols
      EVIDENCE: 2026-08-24 the production Email provider was saved with minimum length 12 and the recommended four-class requirement; a full dashboard reload showed both values persisted while leaked-password protection remained off.

- [x] G3: the repository contains an actionable production runbook defining observability, alert thresholds and destinations, rollback procedure, owners, and verification cadence
      CHECK: node -e "const fs=require('node:fs');const p='docs/production-runbook.md';if(!fs.existsSync(p))process.exit(1);const s=fs.readFileSync(p,'utf8');const required=['Observability','Alerts','Rollback','Ownership','Verification cadence'];for(const x of required)if(!s.includes(x))process.exit(1);console.log('production runbook verification passed')"
      EXPECT: production runbook verification passed
      EVIDENCE: 2026-08-24 the oracle and production login probe passed; the runbook names Rajat as owner, documents GitHub/Vercel/Supabase signals and freshness thresholds, limits rollback authority, and defines daily, weekly, release, monthly, and quarterly checks. The separate live delivery gate remains G4.

- [x] G4: production monitoring, actionable alert delivery, rollback ownership, and runbook access are verified against the live production services
      EVIDENCE: 2026-08-24 commit 05eca70 was clean on main and Vercel reported its deployment complete; `/login` returned HTTP 200 with the UsefulDesk title, scheduled production-health run 32724746860, ops run 32725040963, and renewals run 32724089661 passed, and GitHub's notification inbox retained prior failed CI and ops-cron alerts. The runbook is live on main and names Rajat as incident and rollback owner. Email/mobile delivery was not asserted.

- [x] G5: lead-specific Meta Graph failures do not overwrite Page health and the queue-reconciliation and recovery paths pass focused tests
      CHECK: npm test -- --run src/lib/meta/lead-ingestion.test.ts src/lib/meta/recovery.test.ts src/lib/meta/lead-ads-health.test.ts src/app/api/meta/leads/recovery/cron/route.test.ts && node -e "const fs=require('node:fs');const s=fs.readFileSync('src/lib/meta/lead-ingestion.test.ts','utf8');if(!s.includes('does not overwrite Page health for a lead-specific Meta Graph error'))process.exit(1);console.log('meta launch blocker verification passed')"
      EXPECT: meta launch blocker verification passed
      EVIDENCE: 2026-08-24 the regression reproduced code 100/subcode 33 overwriting Page health, then passed after ingestion restricted connection mutation to proven token/permission codes 190, 10, and 200. The invalid-token preservation test and all 26 focused ingestion, recovery, health, and cron tests passed.

- [x] G6: the production Meta stale synthetic queue is reconciled, Lead Ads health is restored, and review plus canary verification succeeds without creating a real lead
      EVIDENCE: 2026-08-24 commit 8c8d51d passed CI and reached Production. Exact failed synthetic events meta:leadgen:4391731824489306 and meta:leadgen:36213436768848596 were retained and terminally reconciled with stale_synthetic/provider_object_unavailable audit context. Meta accepted no-phone test lead 4509977375915742 once; its webhook processed on attempt 1 with skipped=no_phone. Production then verified zero unprocessed/failed Meta lead events, and the sole Page remained connected with zero consecutive health failures and no attention incident.

- [ ] G7: the exact gym_service_renewal repository contract produces the approved positional Meta payload
      CHECK: npm test -- --run src/lib/whatsapp/template-contracts.test.ts && node -e "const fs=require('node:fs');const s=fs.readFileSync('src/lib/whatsapp/template-contracts.test.ts','utf8');if(!s.includes('builds the exact Meta payload for service renewal'))process.exit(1);console.log('service renewal contract verification passed')"
      EXPECT: service renewal contract verification passed
      EVIDENCE: pending

- [ ] G8: gym_service_renewal is approved and synced in the production WhatsApp account with the exact repository contract
      EVIDENCE: pending

- [ ] G9: the exact gym_installment_reminder repository contract produces the approved positional Meta payload
      CHECK: npm test -- --run src/lib/whatsapp/template-contracts.test.ts && node -e "const fs=require('node:fs');const s=fs.readFileSync('src/lib/whatsapp/template-contracts.test.ts','utf8');if(!s.includes('builds the exact Meta payload for installment reminder'))process.exit(1);console.log('installment reminder contract verification passed')"
      EXPECT: installment reminder contract verification passed
      EVIDENCE: pending

- [ ] G10: gym_installment_reminder is approved and synced in the production WhatsApp account with the exact repository contract
      EVIDENCE: pending

- [x] G11: Razorpay first-bind onboarding is account-agnostic, safely configurable, and covered by OAuth, configuration, and health-scope tests
      CHECK: npm test -- --run src/lib/payments/razorpay-oauth.test.ts src/lib/payments/razorpay-config.test.ts src/lib/payments/razorpay-health-scope-contract.test.ts src/app/api/payments/razorpay/webhook/route.test.ts && node -e "console.log('razorpay onboarding verification passed')"
      EXPECT: razorpay onboarding verification passed
      EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajatkashyap/Desktop/projects/UsefulDesk; path=ebdbae05e4ce/23 entries; output=- ESM syntax in a file loaded as CommonJS (vitest.config.ts:1:1). Use a `.mjs` extension or set `"type": "module"` in the closest package.json | Set `VITE_CONFIG_NATIVE_IGNORE_WARNING=true` to suppress this warning.

- [ ] G12: a non-pinned production account completes Razorpay first-bind onboarding and provider readiness verification without moving money
      EVIDENCE: pending

- [x] G13: all shipped changes are documented and the full typecheck, lint, test, and production build suite passes
      CHECK: npm run typecheck && npm run lint && npm test && npm run build && node -e "console.log('full go-live regression verification passed')"
      EXPECT: full go-live regression verification passed
      EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajatkashyap/Desktop/projects/UsefulDesk; path=5a5e6a96d778/23 entries; output=Not implemented: Window's scrollTo() method | Not implemented: Window's scrollTo() method
