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

- [x] G7: the exact gym_service_renewal repository contract produces the approved positional Meta payload
      CHECK: npm test -- --run src/lib/whatsapp/template-contracts.test.ts && node -e "const fs=require('node:fs');const s=fs.readFileSync('src/lib/whatsapp/template-contracts.test.ts','utf8');if(!s.includes('builds the exact Meta payload for service renewal'))process.exit(1);console.log('service renewal contract verification passed')"
      EXPECT: service renewal contract verification passed
      EVIDENCE: 2026-08-24 the dedicated payload regression passed and proves gym_service_renewal is MARKETING/en_US/POSITIONAL with the exact four body parameters, approved body, footer, Renew service button, Unsubscribe button, and provider sample values.

- [x] G8: gym_service_renewal is approved and synced in the production WhatsApp account with the exact repository contract
      EVIDENCE: 2026-08-27 a service-role read-only production check found gym_service_renewal Approved on the owner-approved Rajat Kashyap account with exact Marketing/en_US/POSITIONAL body, footer, ordered quick replies, no provider component sync marker, and no provider-missing marker. The same check proved gym_membership_renewal and gym_payment_link ready. No WhatsApp message was sent.

- [x] G9: the exact gym_installment_reminder repository contract produces the approved positional Meta payload
      CHECK: npm test -- --run src/lib/whatsapp/template-contracts.test.ts && node -e "const fs=require('node:fs');const s=fs.readFileSync('src/lib/whatsapp/template-contracts.test.ts','utf8');if(!s.includes('builds the exact Meta payload for installment reminder'))process.exit(1);console.log('installment reminder contract verification passed')"
      EXPECT: installment reminder contract verification passed
      EVIDENCE: 2026-08-27 the focused five-contract regression passed, including the exact Utility/en_US/POSITIONAL installment payload and its member, amount, plan, and due-date parameter order.

- [ ] G10: gym_installment_reminder is approved and synced in the production WhatsApp account with the exact repository contract
      EVIDENCE: pending

- [x] G11: Razorpay first-bind onboarding is account-agnostic, safely configurable, and covered by OAuth, configuration, and health-scope tests
      CHECK: npm test -- --run src/lib/payments/razorpay-config.test.ts src/lib/payments/razorpay-live-rollout-schema-contract.test.ts src/lib/payments/razorpay-rollout-route-contract.test.ts src/lib/payments/razorpay-refresh-route-contract.test.ts src/lib/payments/razorpay-oauth.test.ts src/lib/payments/razorpay-health-scope-contract.test.ts src/app/api/payments/razorpay/webhook/route.test.ts src/lib/payments/razorpay-disconnect-recovery.test.ts && node -e "console.log('razorpay onboarding verification passed')"
      EXPECT: razorpay onboarding verification passed
      EVIDENCE: 2026-08-24 the single-account environment pins were replaced by the RLS-on, browser-denied `razorpay_live_rollout_accounts` authority and service-role-only atomic merchant claim. Connector migrations `20260824154937` (isolated Test) and `20260824155039` (Production) verified Rajat enabled and exactly bound, VBF enabled for one first bind and unbound, browser grants absent, and the claim RPC service-role-only. A claimed merchant remains in strict first-bind mode until its encrypted credential exists, so a persistence retry cannot gain provider-capability fallback. The focused 53-test Razorpay suite and full 2,222-test regression passed before release.

- [ ] G12: a non-pinned production account completes Razorpay first-bind onboarding and provider readiness verification without moving money
      EVIDENCE: 2026-08-24 the owner designated VBF account `9c50dcd9-ed4a-427c-a2fc-07d452f0aec7` as the rollout canary and the Production rollout table now enables exactly that unbound account for one atomic first bind while preserving Rajat's exact binding. Commit `e635b6c` reached Production and `https://desk.usefulmade.com/login` returned HTTP 200. The post-deploy read-only closeout found Rajat exact/ready with no lease or error and found VBF enabled/unbound with no credential, active OAuth state, Payment Link, refund, exception, or webhook delivery. The gate remains unmet only until VBF's Razorpay owner authorizes Live OAuth and the existing readiness, isolation, and zero-queue checks pass without creating a Payment Link or moving money.

- [x] G13: all shipped changes are documented and the full typecheck, lint, test, and production build suite passes
      CHECK: npm run typecheck && npm run lint && npm test && npm run build && node -e "console.log('full go-live regression verification passed')"
      EXPECT: full go-live regression verification passed
      EVIDENCE: 2026-08-27 `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build` exited 0 with the database-owned scheduler; Vitest passed 2,633 tests across 349 files and Next 16.3.0 completed the 95-route production build. Lint reported zero errors and 152 pre-existing vendored-skill warnings.

- [x] G14: production operational and reminder workers have an independent database-owned scheduler with verified live execution
      CHECK: npm test -- --run src/app/api/database-cron/route.test.ts src/lib/cron/database-scheduler-contract.test.ts
      EXPECT: ten focused scheduler tests pass
      EVIDENCE: 2026-08-27 the foundation passed on isolated Test and Production, with pg_cron/pg_net installed, one private auth row, both intended schedules, a rejecting unknown-secret check, and no anon/authenticated verifier grant. Commit `f81242a` passed CI run `33047440706`, reached Vercel, and the public route rejected an unauthenticated probe with 401. Connector versions `20260827064753`, `20260827070049`, and `20260827070239` installed, digest-hardened, and activated Production jobs `1` and `2`; both are active at `8,23,38,53 * * * *` and `41 * * * *`. Vault-authenticated database requests `1` and `2` returned HTTP 200: all seven ops and both reminder routes succeeded with `failed: 0`, and no reminder was due or sent. The first natural ops run then started at `2026-08-27T07:08:00Z`, PostgreSQL recorded it as `succeeded`, and pg_net response `3` returned HTTP 200 with seven dispatched and zero failed.
