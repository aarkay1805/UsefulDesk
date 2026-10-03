# Dated Billing Staging acceptance artifact

`billing-release-cloud.acceptance.mjs` is a formatting-only copy of the harness accepted on
3 October 2026. It is outside normal test discovery. Its provider responses are
synthetic; it rejects all network traffic except the selected Billing Staging
URL. It imports the actual quote/order/webhook routes and uses real Auth and RPC.

This is not an unattended runner. The coordinator restored the explicitly empty
`otagotpezshybxkagtwv` target, applied the closed sources, and composed existing
pilot/customer/renewal fixtures. Disposable Auth users needed blank confirmation,
recovery and email-change tokens before GoTrue password login. The harness's
`sql()` requests use a file bridge in `/tmp/usefuldesk-billing-release`; the
operator must review each request and service it through the approved connector
against **that Staging project only**, using `apply_migration` for DDL. It cannot
execute SQL by itself. Never service the bridge against Production.
The operator must inspect the final `routing_acceptance` result and require
`pass`; the archived helper checks errors but does not assert a returned
pass/fail string. Vitest's green result alone does not prove that final SQL
cardinality/calendar-month assertion.

The connection file contains `url`, `public_key` and `secret_key`, must be 0600
in a 0700 temporary directory, and must never be committed. All users, passwords,
quote/order/payment IDs, HMACs and scoped opening records are disposable fixtures.
No real provider credentials or customer data are inputs.

After reconstructing and reviewing fixtures in the empty target, an operator can
invoke `npx vitest run --config scripts/acceptance/billing-release-cloud.config.mts`
while separately servicing the connector bridge. The test temporarily activates
only two synthetic renewal scopes; it does **not** clean up afterward. A separate
guarded connector cleanup must close scopes/gates, remove every synthetic row,
restore original settings/audit history, reinstate the hard-closed renewal check,
compare all table counts and pause Staging. Remove connection/bridge files even
on failure. Never run against an occupied staging baseline.

See `docs/subscription-coordinated-release-2026-10-03.md` and its JSON evidence for
the accepted result, cleanup, actual migration versions and remaining genuine
provider/WhatsApp acceptance. No fixture activation is a Production release step.
