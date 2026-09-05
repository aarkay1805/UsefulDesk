# Roadmap

> Phased — build step by step, don't over-engineer. The feature filter (in `CLAUDE.md`) governs everything here: does it save the owner time, recover lost leads, collect renewals, or retain members? If not, defer.

## ✅ Phase 1 — the renewal wedge

Membership plans, including responsive label-free billing-option comparison cards with a clear monthly-price/total/cadence hierarchy and reliable same-plan savings · member records · renewal action lists (expiring / expired / due) with the Memberships / Services source segment grouped first inside the queue toolbar · one-tap WhatsApp reminder · manual payment recording · staff assignment · owner tiles.

## ✅ Phase 2 — India-first workflows

Built locally: **mobile attachment composer refinement** — readable filename,
type and size; compact caption/send layout; accessible discard; uncropped photo
preview; and visible pending send state. Native visual acceptance and a new
tester build remain pending; the existing v0.1.0/build 1 binaries are unchanged.

Mobile release readiness: **internal tester distribution is now the first
release target.** `apps/mobile/eas.json` has a standalone `preview` profile
(Android APK and iOS internal distribution), and the existing EAS project has
the four public Preview environment settings. SDK 57 patch dependencies are
aligned and clean-install Expo Doctor passes 21/21; mobile lint/typecheck and
69 suites / 785 tests pass. Both native bundles export. Both cloud builds
finished successfully; the signed iOS tester app is installed on the registered
iPhone Air and the connected Android phone. Owner-approved iOS distribution
signing and ad hoc provisioning are configured. Follow `docs/mobile/internal-testing.md` for current build evidence
and the remaining tester-binary/device acceptance gates. Historical development
push acceptance does not prove Preview signing or device delivery. Tester text
delivery passed on both platforms; iOS quoted replies and incoming realtime
passed. Reaction testing found a proxy bearer/branch forwarding gap: the local
fix passes 66 focused tests, lint, and typecheck, but deployment and live retest
remain pending. Android document/image/video/audio delivery passed on build 1;
iOS media, attachment opening/playback, Preview push, and remaining device gates
still block release sign-off.

Engineering maintenance: **native Inbox refreshes retain the loaded conversation
range across live events, manual refresh, foreground, and reconnect.** Bounded
keyset scans preserve continuation, authoritative membership, and exact unread
counts; failed scans retain visible rows, and stale/deleted data cannot return
through late responses. Query and branch changes still reset the range.

Engineering maintenance: **native Inbox search preserves spaces as users type
and delete text.** Only normalized query changes invalidate results; equivalent
edits retain loaded rows, pagination, and in-flight requests without refetching.

Engineering maintenance: **native message refreshes preserve failed and pending
text/media sends, retry safety, payloads, and identity reconciliation.** Manual,
foreground, and reconnect snapshots retain local attempts; acknowledgement races
and realtime delivery updates deduplicate correctly. Deleted or inaccessible
history clears authoritatively, and no refresh automatically resends a message.

Engineering maintenance: **native message sends recheck the selected branch
immediately before the initial request and authentication retry.** Switching or
clearing the branch during token loading blocks the next POST; text, template,
and media paths have regression coverage.

Engineering maintenance: **native conversation readiness refreshes preserve
composer drafts, uncertain-send locks, picker state, and uploaded attachments.**
Sending and retries stay gated during verification; access loss and conversation
or branch changes still clear local composer state and clean up unsent media.

Engineering maintenance: **native text and media sends now generate temporary
message IDs with `expo-crypto`, removing the browser-global crypto crash.** Both
default send paths have regression coverage without that global, including
optimistic-message acknowledgement and reconciliation.

Engineering maintenance: **the secure UsefulDesk Agent mobile foundation and
Stage 1 read-only native Inbox are built in `apps/mobile`: public-only Expo
configuration, SecureStore auth, startup membership revalidation, and
fail-closed branch selection lead to a selected-branch Inbox with an All/Unread
scope dropdown in the search field, search, refresh, exact pagination and
counts, role-safe unread clearing, and chronological localized history whose older-message loading preserves the
reader. Reconnect, foreground, duplicate/out-of-order event, sign-out, and
branch teardown behavior have deterministic coverage. Because selected-branch
custom headers cannot travel over Realtime WebSockets, private account-topic
Broadcast carries identifiers only and the repositories always rehydrate with
explicit selected-account predicates. Valid PostgREST offset timestamps remain
intact for parsing and pagination. Mobile lint/typecheck and all 38 Jest
suites/361 tests, Expo Doctor, both platform exports, and the root
lint/typecheck/Vitest/Next build gates pass. Physical iPhone Air acceptance
proves conversation navigation/history, header and metadata rendering, and
cross-branch isolation without a stale back stack; a live realtime incoming
event was not exercised. Stage 1 contains no composer or message sending.
Generated native projects stay ignored. Physical Android 11 runtime smoke now
passes for the Stage 1/2 Inbox boundary; newer-system theming, predictive Back,
and alternate form factors remain pending. Remote EAS builds are deliberately
deferred until native feature development is complete; local Xcode and Gradle
development builds remain the active acceptance path. **Stage 2 native
outbound Inbox implementation is
built:** strict mobile bearer authorization keeps cookie callers compatible;
the branch-aware transport has one refresh retry; optimistic, persisted, and
provider identities reconcile to one outbound row; agent+ users get an
inside-window text composer and safe pre-send Retry while outside-window users
get only Approved/synced POSITIONAL templates; viewers remain read-only. The latest
post-fix mobile gate passed lint/typecheck and **48 Jest suites / 534 tests**;
current root lint has 0 errors / 3 existing warnings, typecheck passes, all
**406 suites / 3,055 tests** pass, and the bearer/send/proxy selection passes
**66 tests**. The fresh Next production build and iOS/Android exports also pass.
The Expo SDK 57 packages are upgraded to their recommended patches, typed-route
generation is part of mobile typecheck, the development scripts expose the
workspace-local module path required by the hoisted Expo CLI, and Expo Doctor
passes **21/21**.
Generated Expo/native trees are excluded from advisory Prettier checks.
Shared small native buttons, icon buttons,
composer fields, and text fields now have a 48pt minimum target for Android and
iOS parity. Physical iPhone
acceptance passed two-branch isolation and the closed-window Approved-template
picker. After explicit confirmation, one exact template send was attempted to
an approved test contact: the API returned 200 and Meta returned a provider ID,
but its asynchronous callback failed with code `131049` (healthy-ecosystem
engagement), so the test contact did not receive the message. After the provider
race/status and presentation fixes, a no-resend retest showed the persisted
row's separate red **Failed** state, matching the database with no stale
checkmark and no unsafe text Retry. Recent inbound messages exposed the
open-window composer, but no free-form send was executed. A final iOS
accessibility fix announces the same message's sent-to-failed transition once
with queued VoiceOver speech while cold failed mounts, unrelated updates, and
repeated failed renders stay silent. The unlocked development client
additionally passed branch isolation, foreground/session recovery, persisted
failed-row safety, and base light/dark appearance. The maximum-standard Dynamic
Type P1 now has a code fix and a passing dark-appearance physical retest:
native text slots use content-driven line metrics, Inbox rows move time/unread
metadata below untruncated identity and preview copy, Account uses a fixed SF
Symbol target, and large-text message bubbles widen to 88% while moving
timestamps/delivery state below the body. The full template body, date
separators, failed state, composer, and 48pt controls remain visible. A matching
maximum-size light-appearance retest passes the Inbox and Account surfaces; its
conversation/composer portion now also passes on the same physical iPhone via a
`__DEV__`-only local fixture that injects in-memory repositories, a no-op
realtime feed, and a sender that fails before transport. The fixture created no
customer data, contacted nobody, and left the real provider path unreachable.
Physical acceptance therefore remains partial. Physical viewer read-only, the transition-only VoiceOver announcement,
local optimistic text Retry, iOS edge-swipe navigation, live inbound realtime,
and remote EAS builds remain unverified. A current local iOS development client
builds, installs, and launches on the paired iPhone. On a physical OnePlus 6
running Android 11 / API 30, the main-checkout development client built,
installed, launched, restored its authenticated selected-branch session, and
passed Inbox, All/Unread, search, system Back, branch isolation, and
background/foreground smoke. A branch-keyed unmount warning and standard-font
software-keyboard overlap were fixed and physically retested. The harmless
fixture draft was cleared, Send remained unused, and device settings were
restored to night mode `auto` and font scale `1.0`. The post-repair font-scale
`1.3` light/dark visibility and accessibility checks were user-deferred; the
historical pre-repair newest-bubble failure is covered by automated repair tests
but is not physically accepted. Predictive Back, Android 12+ theming,
tablet/foldable layouts, provider delivery, and synthetic screenshots remain
unverified. Remote EAS builds, project linking, signing, and store distribution
are release-hardening work after native feature development; they are not a
development blocker while local Xcode and Gradle builds pass. The root
`npm run verify` requires lint, typecheck, tests, and build; formatting is
advisory and no longer stops these gates.
Final review additionally closed ambiguous-send duplication with locked text
drafts and a durable account/conversation SecureStore template marker,
separated open-text from template readiness, filtered Authentication templates,
enforced branch lifecycle gates, preserved realtime inbound readiness across a
stale query completion, and raised light/dark semantic contrast while uncapping
Dynamic Type. The safety changes passed source review and tests; the original
physical maximum-size run found the clipping defect above, and the subsequent
dark-mode retest verifies its reflow fix. **Stage 3 media and quoted replies are
built:** image, video, document, and existing-audio-file selection now has
strict MIME/size validation, account-scoped authenticated upload
progress/cancel/retry, caption/preview/discard behavior, and optimistic send
reconciliation without an offline queue; persisted messages can be staged as
quoted text/media reply targets through long press or an accessibility action,
with open-window/status gates, missing-parent fallback, safe retry ownership,
and clear-on-sent replacement safety. On a freshly rebuilt OnePlus 6 / Android
11 client, all four native pickers passed launch/cancel only, and the local
fixture passed reply select/replace/dismiss. Media file selection, upload, and
provider delivery remain unverified; no provider/customer message was sent,
and quoted-reply provider delivery remains unverified. **Remaining Stage 3 work
is partially built:** native message reactions now use the existing WhatsApp
reaction route through strict bearer/cookie-compatible operational auth,
selected-branch fail-closed reads and writes, RLS-rehydrated private Realtime
broadcasts, and race-safe optimistic swap/remove rollback. Persisted provider
messages expose six quick reactions from a compact long-press action sheet;
reaction pills group counts and distinguish the current agent, viewers remain
read-only, and temporary/sending/failed rows remain ineligible. Reply moves to
swipe-right or an accessibility action and remains service-window-gated while
reactions do not. A freshly rebuilt OnePlus 6 / Android 11 client passed the
local-only pill, long-press, reaction-selection, and swipe-reply interaction
checks without reaching the provider. Remote reaction/provider synchronization
remains unverified. **Push notifications are now built locally and their
service-only production migration is applied:** authenticated installation
registration, durable Expo ticket/receipt recovery, bounded inbound dispatch,
permission and token lifecycle coordination, branch-safe tap routing, Account
recovery, and active-branch web chat sounds are in place. Local mobile gates and
iOS/Android static exports pass; the EAS project, Android Firebase app, and EAS
FCM V1 credential are configured, and foreground/background remote delivery is
accepted on OnePlus 6 / Android 11. Production inbound acceptance also repaired
ambiguous union ordering in both push claim RPCs and numeric-leading opaque Expo
receipt IDs without dropping queued deliveries. A physical iPhone has now
accepted foreground/background and terminated-state
notification banners, opened a notification into the native conversation, and
passed remote sign-out without the former false timeout warning. Token-refresh
device acceptance now also passes: a cold launch re-registered the current APNs
token into the same production installation, advanced its heartbeat, kept it active,
and left exactly one iOS/development row; controlled refresh-check notifications
then received successful Expo tickets and receipts. Personal Focus suppressed a new
banner during that final receipt check, while the separate foreground/background/
terminated display matrix remains accepted. The production Supabase redirect allowlist
also includes the exact native callback, and physical Google OAuth now returns
through authorize, callback, and code exchange into the authenticated native
Inbox instead of the web Site URL. Other advanced message actions remain
deferred.**

The shipped native Inbox now also carries a Google Messages-inspired Android
visual hierarchy: pale app chrome, a rounded white conversation plane, quiet
edge-free identity rows with restrained unread signals, contact identity in the
thread header, soft high-radius bubbles without tails, and a filled
placeholder-led pill composer with a circular Send action and a contained
attachment tray. A physical-device layout-bounds and accessibility pass fixed
the reference geometry at a 56dp app bar, 48dp fallback avatars, 28dp sheet
corners, and 24dp bubble corners while keeping accent foreground contrast
semantic in light and dark modes. Shared icon actions also resolve the live
foreground instead of Android's non-adaptive label color. This preserves the
single-workflow stack and all existing outbound, accessibility, realtime, and
branch-safety behavior; no inactive calling or Gemini controls were added.

Engineering maintenance: **mobile text no longer clips when the reader changes
iOS Dynamic Type while the app is running.** The cause was not the app-wide
`lineHeight: undefined` idiom or the row `min-h-18` floor — both were measured
correct — but React Native memoising a paragraph's measured content on the
shadow node and returning it without consulting the layout context that carries
the new `fontSizeMultiplier`, so glyphs repainted at the new size inside
launch-time frames. With React Compiler on, re-rendering an ancestor does not
dirty the node either. `src/ui/text.tsx` is now the text master feature code
must use instead of `Text` from `react-native`: it keys each text leaf on the
scale from `useTextScale`, remounting only that leaf, and absorbs the idiom
(66 hand-written copies removed). The heroui-backed masters key only
non-interactive labels; editable inputs pass the effective scale through a
changing native measurement prop, preserving focus and selection. One shared
`Dimensions` listener fans scale changes out to every consumer. Verified on
the simulator from extra-small through
accessibility-extra-extra-extra-large in light and dark, on a fresh launch and
across a runtime change.

Engineering maintenance: **the five hand-rolled message boxes on the native
conversation screen are one `Notice` master, and a closed reply window no longer
cries wolf.** The screen carried five coloured boxes with three paddings, two
radii, and only four of the five announcing themselves to a screen reader.
`ui/notice.tsx` now owns the shape, and its `emphasis` axis carries the
distinction that was missing: `fill` for a fault someone must clear, `outline`
for a condition that is simply true right now. The closed 24-hour window was the
miss — an edge-to-edge amber band with Meta's own terminology over a full-width
solid button, styled exactly like the realtime, verification, and setup faults
beside it, for what is the resting state of most threads. It now takes the
composer's surface and carries amber on a hairline and a clock glyph, the same
demotion the web composer already made. The action sits outside the announced
region so it is reached as a control rather than read as part of the message,
and the master is free of `heroui-native` so leaf components can use it without
pulling reanimated into their tests. Every message box in the Inbox now routes through it —
sixteen call sites, including the byte-identical disconnected-connection card
the list and conversation screens had each been carrying. Inline bubble
metadata, list-footer pagination errors, and field errors under auth inputs stay
as they are by design; one candidate remains in the branch-selection screen.

Engineering maintenance: **conversation avatars no longer borrow `--accent`.**
The fallback circle has its own `--avatar` / `--avatar-foreground` pair — a
pale fill carrying a dark mark in both themes, the treatment shipping chat
lists use to keep avatars quiet — so unread badges read first; `UserAvatar`'s tone is `tinted` rather than `strong`, and the
contrast test covers the new pair at AA.

Engineering maintenance: **the native Inbox scope moved from a chip strip into
the search field.** `All | Unread` no longer occupies a row of its own beneath
the search field; it is a dropdown pinned inside that field's trailing edge,
defaulting to All, with the unread count as its own text on the menu row rather
than folded into the label. `ui/filter-chip-group.tsx` gave way to
`ui/filter-menu.tsx` and `ui/search-field.tsx` gained a `trailingAccessory`
slot. Both then moved out of the rounded conversation sheet into the chrome,
because heroui's field fill equals `--inbox-panel` in light _and_ dark, so
inside the sheet the pill had no colour of its own in either theme. The web Inbox keeps its queue chips deliberately — that surface has the
width for them and a phone does not.

Engineering maintenance: **the native Inbox now reads calendar-relative
timestamps and draws its delivery state.** Conversation rows walked from a bare
clock time — which made a three-week-old chat look ten minutes old — to
time/`Yesterday`/weekday/date, thread separators name Today and Yesterday
outright, and the `✓ ✓✓ ◷` Unicode metadata became drawn SVG ticks at one
stroke weight with `read` held on the fixed chat-read token. Both ladders
resolve the account's calendar day rather than the device's and refresh at that
day's midnight plus app resume. `weekday()` joins the shared locale formatters
and a dev-only `app/inbox-preview.tsx` harness renders the states without auth;
production deep links to the preview redirect to the app root.

Engineering maintenance: **a build can now say what it points at without being
unpacked.** The native app's original home screen went unreachable when the
Inbox took `(app)/index` and sat unreferenced afterwards — no route, no caller,
no test. It is now `features/foundation/diagnostics-screen.tsx` at
`app/(app)/diagnostics.tsx`, reached from a Diagnostics section on Account,
answering the one question a published binary otherwise hides: a **Build** group
(environment, push channel, app version, build number, API host, Supabase host)
that is fixed until the next binary, over a **Session** group (branch,
organization, role, readiness) for support. Backends are identified by host
alone — the Supabase key and every other credential are deliberately absent, and
a colocated test asserts the key appears nowhere in the rendered tree, because
every signed-in user can reach this screen and screenshot it into a support
thread.

Engineering maintenance: **UsefulDesk is operationally detached from the
former CRM template. Active repository metadata, contributor/security forms,
ownership, dependency review, package identity, and invite fallbacks now route
to `aarkay1805/UsefulDesk` and `desk.usefulmade.com`; historical changelog links
and compatibility-sensitive runtime identifiers remain intact. Local Vercel
metadata targets production project `useful-desk`, while the renamed archival
upstream remote is fetch-only with pushes disabled. GitHub's delayed/dropped
scheduled events are now surfaced by a tested freshness check inside
`production-health` using the existing ops, renewals, and backup thresholds;
Supabase Cron remains the unchanged database-owned execution path. After the
detached repository continued creating only a small fraction of its GitHub
schedule events, the ops and renewals definitions were source-refreshed with
POSIX-equivalent explicit all-hours ranges. This preserves every worker minute,
freshness threshold, manual-run exclusion, and Supabase schedule while forcing
GitHub to rebuild the two schedule registrations; natural scheduled runs, not
manual dispatches, remain the rollout gate. GitHub accepted the refresh and its
CI/Production deployment passed. After dropping the first natural events, the
platform recovered: genuine scheduled ops and renewal runs both succeeded
inside their existing freshness windows on 2026-08-31, and the authenticated
freshness checker exited 0 without counting manual dispatches. The independent
Supabase Cron jobs remained active and successful on their original cadences,
and the production login returned HTTP 200, closing the external scheduler
blocker. Alert delivery was also proven: a no-secret manual failure and a
natural scheduled `production-health` freshness failure reached the primary
repository owner/administrator's authenticated GitHub notification inbox as
`ci activity` on 2026-08-30. The temporary manual-only probe was removed in the
same session; no email/mobile delivery is claimed, and no threshold or worker
cadence was weakened. Repeated later gaps confirmed the platform's documented
best-effort behavior while the primary Supabase jobs continued succeeding on
every retained cadence. Freshness now classifies those redundant GitHub ops and
renewal gaps as visible warnings; backup staleness remains a hard failure
because it has no alternate scheduler, and failed worker executions remain red
in their own workflows.**

Lead-management refinement: **the profile's separate Template and Chat actions
are now one WhatsApp-marked Chat action that resolves or creates the lead's
conversation and opens the branch-aware Inbox directly. The inherited Company
field no longer appears in lead create/edit, import/preview, table/board,
bulk-edit, detail, Inbox-filter, or export workflows; its database/API column
remains compatibility-only.**

Engineering maintenance: **the owner's pending AutoPay mandate now has a reliable
resolution path: immediate cancellation matches Razorpay's body-less provider
contract, while disabled, misconfigured, or blocked OAuth returns a clear
Settings → Payments recovery instead of an internal error. The existing
provider-safety boundary remains intact, so renew/change/freeze/cancel stays
locked only until Razorpay confirms a terminal mandate. Product and service
checkout also crosses its intended database-authoritative boundary again:
`perform_contact_checkout` keeps explicit agent, selected-branch, contact,
membership, catalogue-price, and idempotency checks but runs as a fixed-path
definer because all underlying financial tables remain browser read-only.
Migration `20260829082000_authorize_contact_checkout_writes.sql` is live on the
UsefulDesk project; a rollback-only authenticated PT checkout for member 1265
returned the full ₹400 invoice/service result and persisted nothing.**

Engineering maintenance: **WhatsApp guided reconnect now preserves a known-good
same-number Cloud API registration instead of submitting a new random two-step
PIN, preventing Meta `133005` from disabling the local inbound-delivery marker.
Connections already awaiting registration have a PIN-only Fix delivery action
that uses the encrypted saved token server-side, clears the provider error on
success, and never stores the PIN or requires Manual setup.**

Engineering maintenance: **Husky and GitHub CI now execute one shared
`npm run verify` contract requiring lint, typecheck, the full test suite, and
the production build. Prettier runs as a separate advisory CI step, so
formatting differences cannot block pushes or Vercel deployment. Staged-file
auto-formatting and local formatting commands remain available; the existing
CI check name and Vercel status are unchanged. The Members Realtime dependency
matrix is directly testable, so its
attendance and follow-up coverage survives subscription implementation
refactors without weakening the behavior contract.**

Engineering maintenance: **the member profile drawer now states each fact once
and navigates six anchors instead of eight. Membership status, session usage,
and auto-pay each print in exactly one place; the two prose lines restating the
membership stat grid are gone, as are the duplicated load-failure and loading
sentences and the churn-risk paragraph that repeated its own switch. The
template-send log joined Follow-ups and consent/deletion joined the profile
form, while Attendance keeps its own card and anchor, now below the follow-up
work; its visit list drops the per-row tick that was identical on every line.
Every card keeps its visible title. The invoice and message tables dropped
their redundant frames and the message log its constant `WhatsApp` channel
column, and Purchases rows lead with the item name as a heading instead of
using it as a stat label. `SECTIONS` ids, `#sec-payments` deep links,
`revealMemberBilling`, and every action, field, permission gate, and mutation
path are unchanged**.

Engineering maintenance: **P2-8 gives Finance -> Performance one bounded
browser-memory cache across component remounts. Exact completed and pending
keys include the authenticated user, selected account/branch, timezone, month,
and staff scope; changing user/account clears the cache, explicit Retry always
bypasses it, stale callbacks remain sequence-guarded, and 12-entry LRU eviction
prevents unbounded growth. Because Performance has no Realtime invalidation,
completed entries are fresh for a conservative 30 seconds: a fresh revisit
paints immediately without a request or loading skeleton, while an expired
revisit refreshes once through the existing UI. Deterministic request counts
moved completed remount from 2 to 1 total calls, Strict Mode first load from 2
to 1, and rapid A->B->A from 4 to 2; an authenticated browser trace confirmed
one cold snapshot POST, zero fresh-revisit POSTs, and one post-TTL POST. Report
output, staff/date/timezone behavior, selected-branch RLS, the snapshot RPC,
database, and compute are unchanged. No further request-lifecycle residual is
evidenced; the one legitimate snapshot remains roughly 624–636 ms warm and
cache-resident/CPU-bound.**

Engineering maintenance: **P2-7 replaces the Members page's single broad
Realtime reload nonce with per-listing dependency tokens. One selected-account
channel and the existing 400 ms trailing debounce now accumulate changes from
15 already-published base/indirect tables, then refresh only listings whose
displayed rows or facets can change; separate data/timeline tokens preserve open
member sheet freshness. The original membership/payment/attendance/follow-up
matrix moved from 28 of 28 event/view pairs and 36 database requests to 13
relevant refetches and 15 requests, suppressing 15 unrelated view refreshes and
21 requests. Complete focused coverage exercises all 105 published
table/view pairs (43 relevant, 62 unrelated), rapid bursts, tab switches before
flush, immediate write refresh, selected-account rejection, primary-key-only
deletes, one channel, and cleanup. URL/history, branch-aware RLS reads,
readiness/provider fetches, loading/error/stale-response behavior, permissions,
and UI are unchanged; no database, publication, RLS, cache, or compute change
was required. Its next evidenced residual was the Performance report cache,
closed by P2-8 above.**

Engineering maintenance: **P2-6 makes the Members `view` search param the
render-time listing source of truth. Attendance, Payments, Follow-ups, All
members, and Renewals deep links now mount and fetch only the requested child;
missing/invalid values retain the canonical Renewals fallback. Previously every
non-Renewals direct load committed Renewals first and started one extra 50-row
memberships request with no network abort before a post-commit effect selected
the requested lazy view. Native `replaceState`, branch and other query params,
back/forward traversal, tab order/permissions, lazy loading, loading/error
states, and the single four-table page Realtime subscription remain unchanged.
Focused lifecycle tests cover the direct-link matrix, in-app switching, stale
completion suppression, URL preservation, history traversal, and subscription
count; no database or authorization change was required. The next evidenced
residual is the Members page's broad Realtime reload nonce, which refetches the
active listing after changes to unrelated member tables.**

Engineering maintenance: **P2-5 Members -> Attendance now returns one bounded
25-row roster page, exact total and present/absent facets, plan options, latest
selected-day attendance state, and current-day usage counts through a
selected-branch `SECURITY INVOKER` snapshot. This replaces the full roster and
day-attendance downloads plus a conditional sequential usage-count RPC;
search, plan/presence filters, all sorts, deterministic page clamping,
check-in/out actions, plan/session limits, account-local day boundaries, stale
response cancellation, and coalesced Realtime freshness retain their existing
semantics. Migrations `20260829060000_consolidate_member_attendance.sql`,
`20260829061000_avoid_member_attendance_timezone_catalog_scan.sql`, and
`20260829062000_defer_member_attendance_row_json.sql` are live on Production as
connector versions `20260828181428`, `20260828181556`, and `20260828181829`.
At 281 memberships, the default tab fell from two requests / 281 roster rows /
630,564 bytes to one request / 25 rows / 43,691 bytes; the normalized row hash
matched exactly, warm execution was 6.433 ms / 39 shared hits / no reads or
temp versus 6.726 ms / 816 hits across the legacy statements, and rollback-only
usage, current/past day, present/out, search/filter/sort/page, role, tenant,
archived, empty, ACL, RLS, publication, input-bound, and advisor controls
passed. No speculative index was added. The next evidenced residual is the
Members deep-link lifecycle loading the default Renewals view before the
requested tab.**

Engineering maintenance: **P2-4 Members -> Follow-ups now returns one bounded
25-row task page, exact filtered total, and the four rendered due-date counts
through a selected-branch `SECURITY INVOKER` snapshot instead of one
page/exact-total request plus four exact facet requests. Search, mine/team,
reason, assignee, due bucket, all four sorts, server page clamping, persisted
table preferences, and authored/assigned identity retain their existing
semantics; numeric member search is now database-side, stale work aborts, and
direct follow-up changes join the existing coalesced Realtime refresh.
Migrations `20260829050000_consolidate_member_follow_ups.sql` and the
forward-only PostgreSQL extrema repair
`20260829051000_repair_member_follow_ups_extrema.sql` are live on Production as
connector versions `20260828173840` and `20260828173922`. At current scale, the
default tab fell from five requests / one row / 3,771 bytes to one request / one
row / 2,225 bytes; five warm plans improved from 15.446 ms / 3,192 shared hits
to 13.064 ms / 2,739 hits, with no reads or temp blocks and exact output,
role/tenant/archived/empty/bound, ACL, RLS, publication, index-plan, and advisor
controls verified. No speculative index was added. Members -> Attendance's
full-roster read plus sequential usage-count RPC is the next residual
performance finding.**

Engineering maintenance: **P2-3 Members -> Payments now returns the payment
tiles, exact due-member total/facets, plan options, and one bounded 25-row page
through a shared selected-branch `SECURITY INVOKER` snapshot instead of four
broad reads joined, aggregated, filtered, sorted, and paginated in the browser.
Migrations `20260829040000_consolidate_member_payment_dues.sql` and the
forward-only PostgreSQL extrema repair
`20260829041000_repair_member_payment_dues_extrema.sql` are live on Production
as connector versions `20260828170652` and `20260828170827`. At current scale,
the default tab fell from four requests / 314 rows / 632,733 bytes to one
request / three rendered rows / 7,020 bytes; five warm plans improved from
33.898 to 29.327 ms, with exact row and money output, role/tenant/archived/empty
controls, ACL, RLS, publication, indexes, and advisors verified. The independent
member Follow-ups fanout is closed by the P2-4 entry above.**

Engineering maintenance: **P2-2 Finance Overview now returns exact revenue,
expense, profit, projection, trend, invoice-health, method, stream, and recent
transaction data through one selected-branch `SECURITY INVOKER` snapshot instead
of five paged datasets aggregated in the browser. Active-tab Realtime
subscriptions cover every displayed-data dependency while avoiding unrelated
Finance tab refreshes and retaining the existing 400 ms coalescing. Migrations
`20260829030000_consolidate_finance_overview.sql` and
`20260829031000_preserve_finance_recent_transaction_order.sql` plus
`20260829032000_publish_finance_allocation_changes.sql` are live on Production
as connector versions `20260828162238`, `20260828163345`, and
`20260828163809`. The
authenticated August fixture fell from five requests / 621 rows / 176,359 bytes
to one request / one row / 8,698 bytes; five warm plans remained database-neutral
at 53.189 ms legacy versus 50.932 ms snapshot, with no reads or temp blocks.
Exact output, roles, selected-branch denial, edge fixtures, ACL, RLS, Realtime,
and advisors passed. The member payments and follow-up residuals are closed by
the P2-3 and P2-4 entries above.**

Engineering maintenance: **P2-1 removes the home Dashboard action snapshot's
remaining repeated ledger expansion. The RLS-visible `membership_dues` view now
materializes current-period invoice balances once, while the
`membership_periods` SELECT policy uses the existing row-independent
selected-account initPlan helper; write policies, grants, view invoker mode,
and the stable authenticated-only dashboard RPC are unchanged. Migration
`20260829020000_reduce_dashboard_action_snapshot_dues.sql` is live on Production
as connector version `20260828155301`. Five identical warm authenticated plans
moved from 402.003 ms / 153,733 shared hits to 33.361 ms / 6,938 hits, with zero
reads or temp blocks, the same dashboard JSON hash, and zero differences across
all 281 dues rows. Finance Overview is closed by the P2-2 entry above.**

Engineering maintenance: **P1-5 Leads now returns the active table or board
rows, exact total, four quick-filter facets, rendered tags/custom values, and
PostgreSQL-evaluated detailed filters plus direct/person/tag/custom ordering
through one bounded selected-branch `SECURITY INVOKER` snapshot. Explicit
id/export modes retain select-all and CSV semantics; same-key lifecycle loads
coalesce, superseded work aborts, and preference/custom-field readiness plus a
render-derived page reset remove initial and old-page duplicate requests.
Migration `20260829010000_consolidate_leads_listing.sql` is live on Production
as connector versions `20260828150302` and corrected `20260828150747`. On a
rollback-only 5,000-contact/1,000-membership fixture, five warm ordinary loads
moved from seven calls / 2,609.779 ms / 1,523,659 shared hits to one call /
89.073 ms / 46,032 hits, with non-empty semantic, identity, role, tenant, ACL,
bound, sort, filter, and empty-result probes passing. All meaningful P1 audit
findings are now fixed; re-running the P0/P1 performance audit is next.**

Engineering maintenance: **Finance Performance now returns its complete
selected-branch report, configurable source labels/revenue, plan billing-option
breakdown, average sale price, ad performance, and expense totals from one
shared `SECURITY INVOKER` database snapshot instead of seven concurrent reads.
Migration `20260828233000_consolidate_branch_performance_snapshot.sql` is live
on Production as connector version `20260828141834`; explicit account
predicates, owner authorization, underlying RLS, branch timezone/month range,
staff filtering, organization scope, errors, and CSV values remain unchanged.
All-staff and staff-filter JSONB hashes matched their legacy equivalents, as did
zero/empty data, and the cache now suppresses an exact branch/timezone/month/
staff revisit while retaining explicit Retry. Post-P1-3 five-run warm means
moved from 633.857 to 559.005 ms all-staff and 612.745 to 562.726 ms staff-filter,
with shared hits also lower; database calls fell from seven to one. The P1-5
Leads fan-out is closed by the entry above.**

Engineering maintenance: **the measured All-members SELECT-policy path now
caches row-independent selected-account access through PostgreSQL initPlans
while every candidate row remains explicitly equal to that authorized branch.
The private helper preserves header fallback/fail-closed behavior,
account-membership role ordering, and archived-branch denial; 15 exact
viewer-level SELECT policies cover accounts, contacts, memberships, plans,
services, billing/refund dependencies, and follow-ups without changing write
policies, grants, invoker APIs, RLS state, or TypeScript capabilities. Migration
`20260828230000_cache_selected_account_rls_checks.sql` is live on Production as
connector version `20260828135003`. Identical authenticated five-run directory
RPC plans improved from a 681.965 ms mean / 12,611 shared hits to 44.038 ms /
6,916 hits, with exact payload and identity hashes; the direct count improved
from 127.879 to 8.080 ms and the representative renewal listing from 159.050 to
3.995 ms. P1-4 owner performance-report fan-out is next; unrelated SELECT
policies remain deliberately unexpanded.**

Engineering maintenance: **All-members now returns its 25-row page, exact total,
and three quick-filter counts from one materialized, RLS-visible directory
snapshot instead of four expensive reads. Numeric member/customer search runs
inside PostgreSQL, while the directory's latest membership, service, billing,
and follow-up work is set-wise. Migration
`20260828210000_member_customer_directory_page.sql` is live on Production as
connector version `20260828132439`; the function remains `SECURITY INVOKER`,
authenticated-only, and selected-branch RLS-bound. The identical default
interaction preserved all 25 identities, the 281-row total, and 0/3/1 facet
counts while reducing four pre-change statement means totalling 2,491.898 ms
to a five-run 749.608 ms mean (69.9% lower). P1-3 is the separate
selected-account policy optimization above.**

Engineering maintenance: **dashboard action and insight RPCs now validate the
selected branch timezone through PostgreSQL's direct resolver instead of
repeatedly materializing the computed timezone catalog view. Like-for-like
authenticated Production plans improved from 1,914.805 to 937.294 ms for the
action snapshot, 81.181 to 15.343 ms for the conversation series, and 242.173
to 159.048 ms for lead-rating inputs, with identical result hashes. Migration
`20260828200000_avoid_dashboard_timezone_catalog_scans.sql` is live as connector
version `20260828130403`; signatures, return shapes, stable invoker execution,
selected-branch RLS, ownership, grants, and invalid-zone errors are unchanged.**

Engineering maintenance: **Vercel functions are pinned to Singapore (`sin1`) beside both Supabase projects. An identical ten-run authenticated preview comparison reduced median all-action Dashboard readiness from 4,487.5 ms to 3,203.5 ms (28.6%) while the quick-actions shell stayed flat; median auth bootstrap fell 90.9% and the action snapshot fell 13.5%. Initial and follow-up-filter action API requests remain zero. The snapshot's remaining 1,793.5 ms server median is the next bounded RLS/PostgREST performance target.**

Engineering maintenance: **the five server-hydrated dashboard action widgets now share one branch-scoped, viewer-authorized, no-store database snapshot while keeping their existing Suspense/provider islands, loading/empty/error states, mutation refresh, preloaded filters, deferred readiness, and account-timezone behavior. The maximum action data stage falls from 12 Supabase requests to one (11 fewer, 91.67%), fixed server timing stages fall from five to one, and the browser remains at zero initial requests, one refresh request, and zero filter-change requests. Authenticated agent/viewer-equivalent selected-branch probes passed on Production and Test; one-row/no-temp-spill plans completed in 126.660 ms and 122.191 ms respectively, with zero advisor findings attributable to the function. Connector versions are `20260828112344` plus correction `20260828112514` on Production and `20260828112351` plus correction `20260828112522` on Test.**

Engineering maintenance: **all async data tables now retain their destination structure while loading through one shared row-skeleton pattern: real headers, column widths, responsive visibility, horizontal scrolling, and sticky-column geometry stay stable across Leads, Members, renewals, payments, Finance, broadcasts, reports, communication history, and service-customer billing. Centred table spinners and whole-ledger grey blocks are removed, while one concise assistive loading status replaces per-cell announcements.**

Engineering maintenance: **Needs attention now uses one viewer-readable, `SECURITY INVOKER` action aggregate that returns only churn-risk, trial-follow-up, and failed-mandate counts under selected-branch RLS and the server-resolved branch day. It replaces the owner-only 30-day report workload that also calculated revenue, trend, visits, plans, sources, and collection breakdowns the card discarded. The database request count remains one, so this is a bounded server-work/transfer reduction rather than a new browser-request or live-latency claim; the initial action path remains zero browser requests and refresh remains one, preserving the previously measured 14-to-1 consolidation. Connector versions `20260828102546` (Test) and `20260828102714` (Production) are live, authenticated non-owner probes passed in both databases, and the new function has zero exact security/performance advisor findings.**

Engineering maintenance: **a request-scoped dashboard context now reuses the authenticated layout's validated user, selected branch membership/account, RLS client, and account timezone across five independently streamed operational sections. Quick actions no longer wait for the slowest dashboard query; each metrics, follow-up, expiring, uncontacted, and attention section retains local failure UI and emits fixed-label, identifier-free server timing evidence. Members commits the selected 50-row renewal page before any bounded inactive count and defers the exact all-time expired count until Expired is actually opened, while preserving selected-window caches, exact active counts, account/recurring filters, and pagination. A same-account production-browser benchmark measured Members visible rows at a 308.9 ms warm mean versus 490 ms before, and Dashboard cold shell/first-section reveal at 336.3/1,077.6 ms; full five-section Dashboard completion remained flat-to-worse, so no completion-speed improvement is claimed. That benchmark identified needs-attention as the next backend target; the narrow aggregate entry above closes its known excess workload without inventing a new timing result.**

Engineering maintenance: **Authenticated navigation performance now responds immediately with a shared route skeleton and a clicked-link pending state. Dashboard action data arrives in the server response, historical insights defer until near the viewport, and Members code-splits inactive tabs plus unopened dialogs. The default renewal queue is account-scoped, recurring-only, exact-column, selected-window, cached, and paginated at 50 rows instead of downloading six months of upcoming and all historical expiries. Production route-only JavaScript budgets and focused regression tests protect the changes.**

Engineering maintenance: **a server-hydrated dashboard bootstrap now reuses the canonical server-validated user, resolves branch/profile/account context before hydration, and preserves the browser auth-state listener for token refresh and sign-out without a blocking duplicate session/profile waterfall. The proxy's early redirect uses signed claims while the layout keeps authoritative `getUser()` validation, and invalid, archived, unauthorized, missing, or unreadable branches remain fail-closed. Active onboarding completion checks now cross one settings-authorized branch-scoped endpoint rather than eight browser requests, while individual signal failures remain incomplete and cannot auto-dismiss onboarding.**

Engineering maintenance: **a branch-authorized, no-store bounded dashboard insights snapshot now replaces the historical cards' initial browser-side Supabase fan-out. The changed slice falls from at least 16 browser data requests to one API request (15 fewer, 93.75%), returns only chart aggregates and a 50-item activity preview, preserves independent card failures, and keeps 7/30/90 range changes fresh behind the same boundary. Conversation and month buckets use the selected branch timezone, and raw message/contact/membership/follow-up histories no longer enter browser JavaScript.**

Engineering maintenance: **two RLS-preserving branch-scoped insight aggregates now replace the dashboard insight server's highest-volume raw-history reads. The changed server slice falls from at least seven PostgREST queries to three (four fewer, 57.14%): conversation history becomes exactly 7/30/90 bucket rows, while five independently paginated lead-rating scans become one count row per source plus the unchanged source-label lookup. Each old lead-rating reader added another query per 1,000 rows; the new query count is fixed. This is static query-shape and transfer-cardinality evidence, not live production timing. Separate `SECURITY INVOKER` RPCs preserve selected-branch RLS, branch timezone and date semantics, range freshness, private/no-store delivery, and independent insight failures.**

Engineering maintenance: **a branch-authorized, viewer-readable, no-store bounded dashboard action snapshot now replaces the remaining action widgets' browser-side Supabase fan-out. Gym metrics, follow-ups, expiring memberships, uncontacted leads, needs-attention, and the bounded assignee metadata they render fall from 14 browser data requests to one (13 fewer, 92.86%); both follow-up scopes are preloaded at eight rows, expiring and uncontacted queues stop at eight rows, message previews stop at 160 characters, and successful sections survive an independent failure. Post-mutation refreshes reuse the same boundary, while WhatsApp readiness waits until a member detail opens instead of spending two boot requests.**

Engineering maintenance: **production workers now have two independent schedulers. Supabase Cron owns Vault-authenticated 15-minute ops and hourly renewal aggregator calls, while GitHub Actions remains the staggered redundant pinger and alert surface. This closes the dropped GitHub schedule failure mode without changing any worker's claim, dedupe, provider, or failure semantics. The authorized manual recovery and post-09:00 reminder runs were green, then live database-originated requests returned HTTP 200 for all seven ops and both reminder routes with zero aggregate failures and no due or sent reminders. The database holds only a SHA-256 digest outside Vault, the verifier is service-role-only, and both Production jobs are active.**

Engineering maintenance: **the remaining Razorpay P2 integrity fixes passed Test Mode provider acceptance and their production schema is installed. Signed unknown-merchant events retain canonical recovery state, settlements preserve provider payment time, mandate setup stays same-origin/exact-active/currency-safe, and owner/admin cancellation converges provider state before an audited local terminal transition. Disposable Test subscription `sub_TUUNYZcSaJlDsr` was cancelled without approval or money movement; the exercise fixed branch authorization through `account_memberships` and a webhook-first cancellation audit race, then ended with zero Test acceptance queues. After encrypted backup run `32997711909`, migrations `20260826210000_resolve_razorpay_p2_integrity_gaps.sql` and `20260826220000_fix_razorpay_mandate_cancellation_branch_authorization.sql` were connector-applied to Production as `20260826181015` and `20260826181016`; grants, Live credential health, and preflight queue counts were unchanged. Future Vercel production aliasing is held on the repository's full CI check.**

Shipped addition: **one canonical Resolvable action across WhatsApp messaging, renewals, invoice delivery and collection, payments, membership lifecycle actions, and follow-ups. High-value actions blocked by a changeable prerequisite remain focusable and tappable, explain the highest-priority reason in place, and offer the nearest resolution CTA when one exists; pending work, explained validation, empty input, and obvious boundaries remain truly disabled. The explanation is presented in the shared alert grammar — warning glyph, message, left-aligned resolution — on a tailed popover anchored to the control it blocks.**

Engineering maintenance: **Razorpay reconnect recovery now admits a fresh `blocked` OAuth grant only inside the authenticated read-only Verify path, allowing the existing capability probes to restore readiness when Razorpay's Accounts endpoint rejects an imported merchant; ordinary payment access remains ready-only and ready connections still force token refresh. Disconnected OAuth rows present one honest Reconnect task instead of stale readiness badges and Verify/Disconnect actions. The owner's exact pinned Live merchant `acc_TCJwBqanN9LTrK` was restored to OAuth/Live/ready after customer, plan, subscription, payment-link, and payment probes all returned 200, and its exact operational queues remained zero. No payment, link, refund, message, or money movement was created.**

Engineering maintenance: **the four preserved pre-OAuth Razorpay account-mismatch failures are terminally reconciled through an immutable service-only audit after event-by-event read-only proof. Each was a Test event received under the owner's retired manual webhook for merchant `acc_TCJwBqanN9LTrK` while its subscription notes named VBF; the referenced member/contact/mandate rows are gone and exact local payment, allocation, refund, exception, and delivery effects are zero. The path retains receipt tenant/raw payload and null legacy signature facts, records the proven Test merchant mapping, and closes without replay or ledger mutation. Production now has zero failed/unprocessed Razorpay events; the pinned Live connection and zero Live failed/missing-ledger scope are unchanged.**

Engineering maintenance: **a Cloudflare R2 backup foundation now exports and
client-side encrypts nightly Supabase database dumps plus weekly complete
Storage snapshots, supports manual pre/post-operation recovery points, verifies
remote objects, and documents a disposable-project restore drill. The bucket,
lifecycle, credentials, encryption recipient, and production runs are active.
The 2026-08-23 drill restored every one of 124 dumped table counts and all 30
Storage objects into a fresh Singapore project, then passed Auth, signed-private-
object, and cross-tenant RLS checks. Recovery is therefore proven; safeguarding
the private `age` identity remains an owner resilience task. After the original
identity could not be located, the recipient was rotated and full replacement
run `32657700769` remotely verified new database and Storage archives. The
replacement is stored in Apple Passwords; the owner explicitly declined a
physically separate offline copy and accepted that single-vault risk. Archives
before the rotation are not considered recoverable unless the old identity
resurfaces. This provides daily/weekly pilot recovery, not point-in-time
recovery.**

Engineering maintenance: **production Supabase Auth now requires at least 12
characters with lowercase, uppercase, digits, and symbols for every new or
changed password. A dashboard reload verified the saved policy. The Pro-only
HaveIBeenPwned check remains disabled because the owner chose the no-cost
fallback and accepted the residual breached-password risk.**

Engineering maintenance: **a no-secret GitHub Actions probe now checks the
production login surface, and `docs/production-runbook.md` defines the minimum
observability sources, freshness/error thresholds, GitHub alert destination,
the owner's incident and rollback ownership, forward-only database recovery rule,
and daily/weekly/release verification cadence. Commit `05eca70` reached
Production; the login, ops, and renewal probes passed, and historical failed CI
and ops-worker alerts are present in the owner's GitHub notification inbox.
Email/mobile delivery remains optional and was not asserted.**

Engineering maintenance: **Meta Lead Ads ingestion now distinguishes an
event-specific stale/missing lead (`100/33`) from a proven Page connection
failure. Only invalid-token or required-permission codes (`190`, `10`, `200`)
may overwrite Page health during a lead fetch; the stale event remains in its
owned retry/reconciliation path. Focused ingestion, recovery, health, and cron
coverage passes. Commit `8c8d51d` passed CI and reached Production; both stale
synthetic rows were retained and terminally reconciled with audit context, and
one fresh Meta test lead completed on attempt one as a no-phone skip. The queue
ended at zero unprocessed/failed events and Page health remained connected with
zero failures or attention incident.**

Engineering maintenance: **the exact `gym_service_renewal` Meta payload now has
a dedicated regression lock covering Marketing classification, `en_US`,
POSITIONAL parameter order, body, footer, buttons, and provider examples. The
owner-approved production account has submitted that exact
contract and stores Meta's provider ID. A read-only 2026-08-27 production check
proved the exact Marketing/en_US/POSITIONAL body, footer, ordered buttons, and
sync markers are Approved and ready alongside membership renewal; no WhatsApp
message was sent.**

Engineering maintenance: **the Inbox conversation view no longer traps the contact panel or hijacks the reader — the panel carries a Close button of its own, the thread-header identity block and the active row's avatar toggle it open and closed with matching `aria-expanded` labels, the thread pins to the newest message only while the reader is already at the bottom and offers a Jump to latest control otherwise, delivery receipts from other conversations no longer re-render or re-scroll the open thread, opening the panel keeps a bottom-parked reader parked, and hitting Reply focuses the composer**.

Engineering maintenance: **the Inbox now follows WhatsApp Desktop's layout and interaction model — 72px conversation rows on 48px avatars with a fill-tinted active state, an on-surface queue chip strip with a live unread count in place of the old filter dropdown, a 64px thread header carrying Status and Assign inline with the session window, contact panel, and refresh behind a ⋮ menu, tail-bearing message runs on a recessed chat canvas with metadata tucked into each bubble's last line, and a floating composer pill. The account accent still owns outbound bubbles, unread counts, and selection so all five themes survive; only the read tick uses a fixed blue. Five derived chat tokens keep every mode × accent combination above WCAG AA, and DESIGN.md gained an 11px Meta type step for bubble metadata**.

Engineering maintenance: **Add member and Convert to member no longer collect WhatsApp consent or evidence as part of checkout, and lead profiles no longer carry the remnant consent action in Leads or Inbox; scoped consent remains recordable from the member profile's Settings card for audit history, but consent and organization-wide opt-out records no longer block manual, API, broadcast, flow, automation, reminder, installment, or payment-link sends**.

Engineering maintenance: **WhatsApp now uses a grayscale provider mark beside the settings menu label and its brand-green mark beside the panel heading, while Razorpay payments and Meta lead ads use compact marks in their card titles; status and action iconography remains semantic**.

Shipped addition: **member-only Products & services with fixed or trainer-specific calendar-duration pricing, archived catalogue and trainer history, newest-first service/merchandise summaries using the Membership card's column hierarchy and expiry-adjacent lifecycle badges with single-line overflow actions plus compact single-line invoice-first member billing without redundant Items or Payment columns—the payment state stays attached to the invoice reference—that renders each checkout once and shares one streamlined item-, total-, payment-history-, receipt-, and correction-complete detail/payment flow with Business → Invoices; the shared drill-down keeps one header-level payment state, uses a compact two-column financial table, omits redundant item-type pills plus settled paid/zero-balance rows, and retains partial-payment balances, meaningful credit, AutoPay, recorder, note, receipt, and void audit context; plain-language trainer-fee setup with set/edit CTAs and completion copy, registered teammates using a Trainer switch and Independent trainers using a permanent-delete trash action on the same roster identity row with concise guidance and an Add action aligned in that card's header, combined joining/renewal invoices, later standalone sales, partial payments and full-invoice 60/40 promises, proportional paise-exact payment/credit allocations, independent dated services, prorated trainer reassignment, service renewal action queues, and separately configured claim-first WhatsApp service reminders; membership dues and AutoPay remain isolated from add-on balances and credits; desktop setup prevents duplicate active options, shows account-currency fees, labels form controls, confirms archive actions, permanently deletes unused catalogue items, and removes independent trainers while retaining historical snapshots**.

Shipped addition: **service-aware, resumable Members CSV/XLSX import with membership-only, service-only, and combined customer purchases; active catalogue/trainer/rate resolution; grouped per-customer atomic accounting; historical sold-price/expiry snapshots; stable retry idempotency; contact-backed service customers without fake memberships; author-private, revision-safe, cross-device drafts in a private bucket with 30-day cleanup; and explicit missing/invalid/conflicting-phone explanations whose Fix phone actions reveal and focus the exact paginated candidate editor. Membership, attendance, renewal, and AutoPay metrics remain membership-only. Merchandise and multiple numbered service-column families are deliberately deferred.**

Engineering maintenance: **shared phone inputs now canonicalize visible country codes with `+`, member-import review rows present digits-only qualified phones with that visible prefix, and constrained table-cell phone editors expand into a responsive elevated 240px surface that keeps the complete number plus the original compact check/cross actions unobstructed without changing column widths; persistence, dedupe, WhatsApp normalization, and every other inline editor remain unchanged.**

Engineering maintenance: **the Leads table's built-in Phone column now uses the `PhoneInput` master instead of a plain text input, closing the last subscriber phone field that bypassed it; the column also renders stored digits-only numbers with the account's visible country code. Typed phone custom fields, sorting, dedupe, the required-phone guard, and stored values are unchanged.**

Engineering maintenance: **all read-only phone numbers now render through one account-aware formatter across Inbox, Leads, Members, profiles, imports, broadcasts, automations, dashboard activity, follow-up notifications, custom phone fields, invoice settings, and CSV exports; national and legacy digits-only values visibly include `+<country code>`, while persistence, search, clipboard values, and call targets remain unchanged and invalid source text stays visible for correction.**

Engineering maintenance: **member import draft resume now grants the exact Storage signing operation used by private workbook URLs, clears parsed file state when draft initialization fails, and stops acknowledged revisions from recursively scheduling another autosave; the connector-applied production policy and the existing VBF draft were verified through successful live sign/download/resume requests.**

Engineering maintenance: **`package-lock.json` is the single authoritative lockfile; the tracked `pnpm-lock.yaml` and `pnpm-workspace.yaml` are removed and `package.json` pins `"packageManager": "npm@11.9.0"` to match the `npm ci` that CI already ran. Dependency security overrides now survive only in `package.json` `overrides`, and Vercel no longer picks a package manager by lockfile auto-detection.**.

Engineering maintenance: **Renew membership now uses the established conversion-style split task model with member/current-term context, grouped membership details, checkbox-opted products/services using the Add purchase catalogue and quantity controls, payment, fixed chrome, and a scroll-contained responsive body; deselecting add-ons clears their invoice selections. Dialog and Sheet share one visible blur standard, including the supported nested-dialog parent blur, while lightweight popovers and menus remain unchanged**.

Engineering maintenance: **mid-cycle Change plan again records its optional first manual collection in the same transaction: membership payment serialization stays on the already-locked billing period, the immutable linked invoice remains readable without exposing invoice UPDATE RLS, and generic invoice collection keeps its stronger trusted invoice lock**.

Engineering maintenance: **Dashboard Renewals due uses the same renewal-chase predicate as its default seven-day Members → Renewals queue, so fixed-term and session-pack expiries no longer inflate the KPI**.

Engineering maintenance: **Meta lead-ad deliveries now lease a durable event and atomically retain the contact, one enquiry note, and original new-contact state, so partial retries resume automation without reclassifying or duplicating the enquiry; goal tagging remains non-blocking enrichment**.

Engineering maintenance: **Meta Lead Ads review setup now preserves the Facebook JS SDK's exact OAuth redirect URI, confines temporary review-host CSRF acceptance to the configured non-production proxy, parses Meta's current direct lead-access diagnostic, verifies Page subscriptions even when that optional diagnostic is unavailable without falsely stamping lead access, and keeps the app-level Page webhook handshake stable through a dedicated token or a domain-separated app-secret fallback. The disposable review Page is connected with its `leadgen` subscription healthy, the app callback uses the stable Production endpoint, and Meta dummy-phone placeholders complete safely as phone-less events. A fresh delivery succeeded, all six permission screencasts are attached, and every required Graph API call succeeded; Meta's delayed usage counters and final submission remain. The production-domain reviewer walkthrough is enabled only for the authenticated dedicated review account, while all customer accounts stay behind the unset dark-launch environment gate.**

Engineering maintenance: **public lead forms now atomically retain the contact, enquiry note, submission audit, and consent evidence before returning success; automation dispatch only follows a committed new contact, while goal tagging remains non-blocking enrichment**.

Engineering maintenance: **Settings → Appearance has compact keyboard-native mode and accent choices, concise copy, immediate account-synced updates, responsive density, and explicit detection of silently blocked profile writes**.

Engineering maintenance: **Settings → Login & security is provider-aware from Supabase's authoritative linked identities and now uses a polished responsive task hierarchy: Google-only, password-only, and Google-plus-password accounts get explicit loading/retry states, accurate connected-method summaries, a separate accessible password card with visibility controls, a verified recovery-link Add password path with no current-password prompt, confirmation-aware account-email management that keeps Google linked, and provider-neutral global UsefulDesk sign-out that does not claim to end Google sessions**.

Engineering maintenance: **password recovery now requires a short-lived, server-signed grant minted only by a verified Supabase recovery exchange; ordinary authenticated sessions, cross-site requests, user-mismatched grants, and tampered or expired grants cannot use the reset route, and a successful update clears the grant**.

Engineering maintenance: **validated team-invitation continuations now survive signup verification failures and forgot-password recovery through callback, reset success, login, and proxy handling; only current-format invite tokens can produce an internal `/join/<token>` destination, recovery completion takes it from the signed user-bound grant, and ordinary auth keeps its dashboard destination**.

Engineering maintenance: **signup now normalizes and requires a nonblank full name at both the form and database boundaries, and tenant provisioning failures abort the Supabase Auth insert instead of silently leaving a login without its organization, branch, profile, or memberships**.

Engineering maintenance: **direct Google Identity Services login/signup is live on localhost and `desk.usefulmade.com`: Google's generated button prefers FedCM, offers a popup-mode retry for unsupported browsers, and exchanges the ID token directly with Supabase using a fresh raw nonce whose SHA-256 hash alone is sent to Google. The user-facing flow no longer navigates through the Supabase project hostname; invitation continuation, hard post-login hydration, provider-error handling, and atomic tenant/profile provisioning remain intact. Vercel Production and Preview hold only the public Google client ID, the client secret remains in Supabase, exact localhost and production JavaScript origins are configured in the published Google client, and the previous redirect path is retained unshown only for safe rollback and email recovery. READY deployment `dpl_3x8q5fDrQekazAQApmuPTXitDVr9` passed a complete Google popup login to the hydrated dashboard**.

Engineering maintenance: **the shared Google Identity Services button now follows UsefulDesk appearance mode on both login and signup, using Google's filled-black treatment in dark mode and outlined treatment in light mode while preserving the official rendered control and existing authentication flow**.

Engineering maintenance: **profiles are now privileged membership projections rather than client-created authority rows: browser and anonymous roles have neither an INSERT policy nor table grant, while atomic signup, audited membership lifecycle operations, self-service profile updates, and trusted backend administration remain intact. Migration `20260814165451_close_profile_insert_authority.sql` was applied to Test and Production; both had zero orphan Auth users or profile/membership inconsistencies to repair**.

Engineering maintenance: **Settings → Your profile is reduced to its two cosmetic tasks—photo and display name—with the canonical avatar and alert primitives, a contained save action, explicit loading/unavailable states, and verified profile-update row returns; sign-in email now lives only in Login & security, and a new Google account may seed its provider photo once without ever overriding a UsefulDesk photo or a later Remove**.

Engineering maintenance: **Settings → WhatsApp now separates API access from inbound-delivery readiness, preserves delivery diagnostics, uses account-local timestamps, gates every change and verification path for non-admins, confirms resets accessibly, and keeps the Meta guided/manual credential flows responsive and concise without changing connection or registration security**.

Engineering maintenance: **Settings → Templates now shows the account-wide Meta template set with clear loading, recovery, empty, and read-only states; keeps every create, preset, sync, edit, resubmit, and delete path permission-gated; and makes the compact builder and lifecycle list responsive, labelled, and consistent with the shared component system**.

Engineering maintenance: **Settings → Renewal reminders now presents membership and service schedules as one concise, responsive save task with labelled switches, keyboard-readable day selections, readiness and recovery guidance, explicit read-only behavior, and unchanged account-local cron, template, WhatsApp, and permission gates**.

Shipped addition: **Gym WhatsApp template contract library with ten exact Meta payloads, grouped setup gallery, locked feature forms, independent readiness for membership renewal, service renewal, installments, payment links, and invoice documents, plus aligned onboarding/member/service/payment/cron triggers. Renewal offers are correctly Marketing; transaction/account updates remain Utility. Exact Approved/synced provider category, POSITIONAL format, and components remain enforced at feature send boundaries. Consent and unsubscribe records remain audit history but do not block outbound sends. Provider reclassification/rejection/name reservation stays visible and is never silently aliased; approval and recipient delivery are not guaranteed.**

Engineering maintenance: **member profiles now place a WhatsApp-marked Template action beside Remind, opening the shared approved-template review picker with member context and sending through the canonical contact-aware WhatsApp endpoint; all outbound send paths have removed local consent and suppression guards while retaining authorization, exact template policy/readiness, provider errors, and consent history**.

Engineering maintenance: **new failed WhatsApp status callbacks now retain Meta's bounded error code, title, and actionable detail before durable receipt cleanup, show those diagnostics beneath the failed Inbox message, and mirror the detail into broadcast-recipient errors; historical failures remain reasonless because their processed payloads were already erased**.

Engineering maintenance: **every WhatsApp template send now persists the message it delivered — the text header stacked above the filled body, plus an image/video/document header's URL — so an Inbox thread and the conversation list show what the member actually received instead of a bare Template tag and a `[template]` placeholder; footer and buttons stay out, sends made before this remain bodiless and fall back to the template's business title, and the in-bubble Template tag and document-header link both clear WCAG AA contrast on all five accents in both appearance modes**.

Engineering maintenance: **sending an approved WhatsApp template from the Inbox or contact profile is now a review-first task: known templates use business titles and purpose copy, membership/service/invoice/payment-link values resolve from the selected contact, fully populated messages hide their implementation variables behind Edit details, missing or ambiguous context falls back to labelled fields with actionable guidance, and retired provider-approved names remain available with an explicit Legacy marker instead of masquerading as a current feature contract**.

Engineering maintenance: **Message-template sync now treats a complete Meta catalogue as authoritative: returned templates clear stale local submission failures and refresh provider state, while provider-backed rows missing from Meta are retained as disabled `Not on Meta` evidence instead of remaining falsely Approved. Pagination-capped snapshots skip absence reconciliation, reappearing templates recover on the next complete sync, generation-guarded writes prevent an older overlapping snapshot from winning, and missing rows can be removed locally without a failing provider delete.**

Engineering maintenance: **Get Started now preserves the selected branch id in every setup action and dashboard handoff, including the pressed control's pending-navigation target; Dashboard KPIs, quick actions, work queues, reports, inbox, and empty-state links use the same branch-aware navigation boundary, so a fresh multi-branch owner cannot fall back to stale branch selection while completing setup or opening operational work**.

Engineering maintenance: **Settings → Lead capture and Fields & tags now use the shared Settings hierarchy with concise copy, explicit loading/recovery/read-only states, current-tenant catalogues, labelled responsive forms, RLS-confirmed writes, and accessible destructive confirmations while preserving public-form, Meta, tag, and custom-field behavior**.

Engineering maintenance: **Settings → Products & services now has concise catalogue guidance, a narrow-phone-safe trainer roster, readable archived items, explicit load recovery and empty-trainer states, reset-on-close drafts, and clearer permission-safe errors while preserving catalogue, trainer-fee, history, and checkout behavior**.

Engineering maintenance: **member profile Add purchase now has a clear invoice-items → payment hierarchy, explicit total/credit/due math, Full and Leave due collection presets, inline amount validation, honest catalogue loading/failure states, labelled controls, and account-currency price overrides while preserving the transactional checkout and immutable-ledger contract**.

Engineering maintenance: **trainer-priced Add purchase rows now put the trainer selector in the Price column and smart-default to the first alphabetically listed trainer with an active fee, making the configured fee and Add action immediately available while preserving explicit no-fee blocking and the transactional checkout contract**.

Engineering maintenance: **member profile Add purchase now opens a dedicated member-aware page instead of another nested modal, condenses name/phone/Member ID/plan/expiry into one context line, and returns to the same Members branch/view with the profile reopened after Cancel or success; its catalogue merges repeated item metadata into one supporting line, uses the table as its sole bordered surface without a repeated section label, keeps the desktop item column stable while Payment is absent, and replaces every zero-value stepper with Add before starting the selected item at 1. Add and stepper controls share a compact fixed right-aligned footprint with centered contents, and the price-adjustment icon follows the anchored amount. Payment plus Create invoice stay hidden until the first selection; Payment uses Collect now / Collect later radios and reveals the pre-filled amount plus payment method only for immediate collection. Once Payment is visible, Cancel and Create invoice sit at the leading edge of its canonical footer; the empty checkout keeps standalone Cancel access. Conditional service/trainer details, audited price adjustment, credit, the shared service-renewal dialog host, authorization, API, and immutable-ledger behavior remain unchanged**.

Engineering maintenance: **the dedicated Add purchase page keeps its member context borderless, omits the redundant phone number, separates it from the catalogue by 16px, moves its sole cancel affordance to an accessible close icon in the shared app-bar trailing action slot, and makes its Create invoice action fill the payment card; reusable dialog checkout action and cancel controls remain unchanged**.

Engineering maintenance: **Settings → Payments now has concise UPI and Razorpay setup, responsive labelled forms, inline UPI-ID validation, RLS-confirmed account writes, and recoverable loading/error/read-only states; bounded Razorpay status checks replace indefinite loading without changing OAuth, provider diagnostics, money movement, or disconnect behavior**.

Engineering maintenance: **Settings → Regional settings, Organization & branches, and Team members now share the established narrow settings hierarchy, responsive card structure, canonical controls and status treatments, and concise owner-facing guidance while preserving account locale persistence, branch lifecycle behavior, invitations, role gates, and database authorization**.

Engineering maintenance: **the member profile drawer now keeps its identity and WhatsApp reminder action clear across desktop and phone widths, while loading and failure states retain labelled sheet structure, explicit progress, and an in-place retry without changing member, billing, attendance, notes, or permission behavior**.

Engineering maintenance: **the member profile drawer opens and closes with the same transition as the lead drawer again. Code-splitting it left every host mounting the sheet already-open, which is the one case Base UI skips its entry transition, and the unmount-on-close clipped the exit; `useSheetMountTransition` restores both directions without touching the code-splitting or any host**.

Engineering maintenance: **the authenticated app hydrates without mismatches. The mode toggle, the theme context's exposed `theme`/`mode`, the deferred dashboard insights, and the three dnd-kit contexts each derived SSR-visible output from browser-only state, so React was discarding the server render and regenerating from the root on most page loads. Fixed at the source in each case; `useIsClient` is now shared at `src/hooks/use-is-client.ts`**.

Engineering maintenance: **Razorpay recurring payment safety now reserves mandate setup before remote creation, blocks duplicate/uncertain subscriptions, compensates failed local persistence by remote cancellation, addresses each charge with the provider's monotonic `paid_count` plus a frozen membership-period/cadence snapshot, preserves confirmed-but-unapplied money as a durable operator-visible exception, and restricts AutoPay allocation to the explicit membership line without changing manual partial/proportional or 60/40 collection**.

Engineering maintenance: **the first Razorpay audit containment slice is implemented on `main`: provider retry state is separate from local mandate lifecycle, `subscription.pending` no longer fails collection, halted and terminal states remain monotonic, signed authorization revocation invalidates OAuth grants while retaining merchant mapping, stale imported-account readiness is re-verified by recovery, disconnect refuses unresolved provider work with an actionable conflict, and mandate setup fails closed on cross-site requests, frozen memberships, or unavailable account currency. New AutoPay setup remains enabled by explicit owner decision. Production applied and verified the additive containment migration plus a forward-only grants hardening migration before application deployment; no financial or membership row changed**.

Engineering maintenance: **Razorpay recurring-charge recovery is implemented on `main`: the worker leases only the immediately next provider `paid_count`, atomically re-evaluates an earlier sequence exception after its predecessor is applied, and retains the exception as resolved audit history instead of duplicating a period or payment. A separate 20-mandate provider-source batch compares subscription `paid_count` with a complete chronologically verified paid-invoice/payment set once per day and preserves captured charges absent from UsefulDesk as review-held exceptions; it never auto-credits provider-discovered money. Settings now gives admins two explicit resolutions for only those provider-discovered items: fresh provider revalidation plus atomic canonical apply, or actor/reason-audited handled-externally with no ledger credit. Mocked ordering, provider-gap, refund-refusal, route-boundary, schema, and UI tests pass. Production applied connector versions `20260826040518`, `20260826040539`, and resolution version `20260826044721`; schema, grants, actor guards, resource counts, and advisors are verified. The first naturally scheduled Production Live scan claimed and scanned the one due mandate with zero observations and failures. A live no-work refund-reconciliation null shape now has a regression guard, and any recovery phase failure returns diagnostic `503` so GitHub Actions alerts instead of remaining falsely green. The original P1 audit set is closed in code; deployment is the remaining release step for the final runtime guards**.

Engineering maintenance: **the final migrated payment allocator now preserves that AutoPay membership-line isolation together with refund-adjusted collectible balances; a final-definition contract test prevents a later `CREATE OR REPLACE` migration from silently restoring generic cross-line allocation**.

Engineering maintenance: **a blocking Razorpay mandate now locks provider-coupled membership renew/edit/plan-change/freeze/cancel/reactivate/delete operations in both the member UI and database; delayed authentication cannot switch an incompatible member to auto collection, and a provider charge against a frozen, cancelled, or trial member is preserved as an exception instead of settling or reactivating it. Provider pause/cancel/rebind remains separate work, so the remote subscription must become terminal before those local lifecycle actions resume**.

Engineering maintenance: **Razorpay OAuth Stages 1 and 2 are accepted in the isolated Test stack behind disabled flags: the real development client completed S256 authorization/code exchange and readiness/refresh/disconnect checks; OAuth Bearer AutoPay produced exact three-event dual-ingress parity; the lease/backoff recovery worker and daily token-due scan passed; and the authenticated atomic gate switched the single isolated selector to application. Post-cutover cancellation proved application-canonical/legacy-shadow processing once. A second fresh Test cancellation then exercised Razorpay's real retry path: the first signed application delivery received a controlled 503 before canonical persistence, Razorpay redelivered the identical event ID and raw-body hash 1.55 seconds later, the retry received 200, one canonical attempt revoked the mandate once, no payment was created, and unresolved events/exceptions remained zero. Support ticket 20297340 is separate evidence, not a gate. No other account is authorized for cutover; production/manual-account inventory and every pre-live credential rotation remain separate authority.**

Shipped addition: **Razorpay Stage 3 Payment Links for the single isolated Test account: agent-authorized Copy creates or reuses an exact seven-day, full-balance, non-partial INR link; invoice changes durably cancel the old revision before replacement; verified `payment_link.paid` alone writes one immutable `source='payment_link'` payment with generic-invoice line allocations; provider mismatches and unexpected partials stay in a service-only exception queue; gateway payments cannot use the manual void path; and the shared recovery worker verifies, adopts, cancels, or settles provider state without double-credit. Genuine ₹1.00 mixed-line and ₹1.01 revised-link Test payments, plus a paired cancellation, produced application-canonical/legacy-shadow evidence and ended with zero active/failed links or unresolved exceptions. The missing `gym_payment_link` template disables Send only; Copy remains shipped. Both rollout flags are false; broader account rollout, production/Live Mode, and credential rotation remain separately gated.**

Engineering maintenance: **Razorpay Stage 4 refunds are accepted only for the isolated Test account: admin-only full remaining-payment refunds preserve immutable provider/payment/allocation facts, recover ambiguous creates by provider receipt, finalize from signed events or the hourly 48-hour-overlap scan, and separate provider state from `reopen_balance` / `reduce_charge` accounting. Finance, invoices, payment views, dues/reminders, and CSV distinguish gross cash, refunds, net cash, adjustments, and review holds. Genuine evidence covers both dispositions, provider-originated retry of an identical signed refund event, Dashboard import, and explicit admin line targeting of the required external ₹1.00 partial refund. The closure transaction assigned every paise to an original payment line, created one equal reduce-charge adjustment, resolved the exact exception idempotently, retained provider identity, and ended with zero unresolved events/exceptions or unfinished refunds. All temporary flags are false on the restored READY Test deployment; no other account, production/Live Mode, real money, or Stage 5 work is authorized.**

Engineering maintenance: **Razorpay Stage 5 provider/payment acceptance passed on the owner-controlled account `50a9e8f9-d7e5-44d2-ba04-c367509b981e` and exact Live merchant `acc_TCJwBqanN9LTrK`. The owner later confirmed this is their operating gym account with real clients, so it is real gym-owner environment evidence, while the isolated ₹1 transaction remains a controlled acceptance exercise rather than a broader customer rollout. The `read_write` OAuth connection remains encrypted, manual-material-free, application-canonical, and exact-account/merchant pinned under the recorded owner acceptance of unrotated client secrets. The owner paid an isolated test invoice through a Live Payment Link; signed `payment_link.paid` created one payment/allocation, the provider-backed historical refund scan completed cleanly, and a full `reopen_balance` refund produced one signed `refund.processed` event, one refund/allocation, no adjustment, and a reopened ₹1 balance. Finance/CSV show ₹1 gross, ₹1 refunded, ₹0 net, no review; the original ₹2,700 membership due/reminder queue stayed unchanged and no WhatsApp Send was claimed. A checkout composite-row fix and strict mode/merchant recovery migration were connector-applied; exact Live unresolved events, missing ledgers, unfinished links/refunds, and exceptions are zero. Both events arrived once, so no retry was available or manufactured.**

Engineering maintenance: **the VBF/Aakash co-branded Razorpay continuation was closed without provider authorization or money movement. Four abandoned OAuth state reservations expired unconsumed; VBF has no active state, credential, merchant binding, selector activation, Payment Link, gateway payment, or refund. Production remains pinned to the owner-controlled account `50a9e8f9-d7e5-44d2-ba04-c367509b981e` and accepted Live merchant `acc_TCJwBqanN9LTrK`. The failed-disconnect gap is now closed provider-first: refresh reported the stored grant revoked and moved the row to `reconnect_required`; the owner's exact merchant-pinned consent then returned fresh encrypted `read_write` grants and passed the existing provider readiness probes. Current state is OAuth/Live/ready, application-canonical, manual-material-free, lease/error-free, with zero exact Live operational queues. READY deployment `dpl_5GkfJc9Nj21pH5Liy8obPbfXpSuN` restores OAuth, first-bind enrollment, manual rollback, and every provider/refund acceptance flag false. Historical ₹1 acceptance remains distinct from this current-readiness verification; no money, VBF action, real-customer rollout, or Stage 6 work was added.**

Engineering maintenance: **Razorpay Stage 6 manual-key retirement is shipped under the owner's explicit waiver of the remaining policy-only 14-day hold. Both accepted databases proved zero manual-mode and zero storage-v0 rows; Production also proved zero manual material, while Test's sole dormant legacy webhook secret was erased. Connector-applied migration `20260811181302_retire_razorpay_manual_keys.sql` DB-locks Razorpay credentials to OAuth/v1/application ingress with all manual columns null and removes retired cutover RPCs while keeping immutable audits. Manual-key UI/API/config, Basic-auth/version-0 fallback, per-account/legacy-secret/cutover routes, and the backfill script are gone. READY deployment `dpl_9ZTDDvDN88gNm6CZ4qswhW47Ata1` serves `desk.usefulmade.com`; OAuth, first-bind enrollment, and every provider/refund acceptance flag remain false, the old manual rollback variable is absent, and the exact Live connection/queues remain clean. No money, VBF action, real-customer rollout, or WhatsApp Send was added.**

Engineering maintenance: **the owner confirmed the pinned account/merchant is their operating gym, so its completed exact-pinned revalidation is now the first real gym-owner OAuth connection-readiness pilot without expanding the authorized money or messaging scope. An authenticated 2026-08-15 Meta sync updated both exact `en_US` Utility templates—`gym_payment_link` (`1996323644342719`) and `gym_payment_due` (`1528972491789269`)—to Approved, removing the template prerequisite for Send. No message or Payment Link was created; all OAuth, enrollment, and acceptance flags remain false at rest, VBF stays closed, and broader rollout still requires separate authority.**

Engineering maintenance: **the first exactly authorized real-client delivery pilot completed on the owner's pinned Live merchant: secret-blind preflight matched invoice `#BC2B1DDB` and its ₹40 collectible balance, the owner action created one seven-day non-partial ₹40 Payment Link, and the approved `gym_payment_link` template advanced to Read. Signed application event `TPy00PfdmPIwtD` settled one ₹40 gateway payment and allocation, reducing invoice collectible/accounting balances to zero with no pilot refund or review hold. Exact Live queues stayed zero; READY deployment `dpl_DAtth8pTbH8osaCiSVao71wpoi5x` restored OAuth false while enrollment and all acceptance flags remained false. VBF stays closed, and no second customer or broader rollout is authorized.**

Engineering maintenance: **Razorpay Production is now permanently operational only for the pinned owner-controlled account `50a9e8f9-d7e5-44d2-ba04-c367509b981e` and exact Live merchant `acc_TCJwBqanN9LTrK`. READY deployment `dpl_9dcvUKMuTMiXzw8xsC21GQ49cfhp` keeps OAuth true while first-bind enrollment and every provider/refund acceptance flag remain false; Stage 6 manual-key and legacy-ingress retirement is unchanged. Authenticated UI verification showed Connected/Live/ready and enabled payment-link actions without using them. Secret-blind closeout found zero relevant queues and zero new financial, messaging, refund, link, mandate, webhook, or OAuth-state records, while the prior ₹40 invoice settlement stayed exactly once. At this 2026-08-15 closeout, client-secret rotation remained deferred under accepted owner risk; VBF/Aakash stayed closed, and another account, merchant, consent, transaction, send, refund, money movement, or broader rollout required separate authority.**

Engineering maintenance: **Razorpay confirmed in writing on 2026-08-21 that Technology Partner Application OAuth credentials are static: an existing Application ID has no self-service, API, or support-side client-secret rotation/regeneration path. The only way to obtain new client secrets is a brand-new application followed by manual configuration and merchant re-onboarding. Razorpay recommended continuing with the existing Development and Production credentials; the owner accepted that recommendation and closed support ticket `20297340`. Client-secret rotation is therefore resolved as a provider constraint, not a pending rollout gate. The remaining broader-rollout boundary is unchanged: another account or merchant still requires explicit authorization, the disabled first-bind enrollment gate, exact merchant binding, and the existing readiness and operational checks.**

Engineering maintenance: **the single-account Razorpay Live environment pins are replaced by a server-owned rollout authority. RLS and revoked browser grants keep eligibility off the client; the owner-controlled account remains enabled and exactly bound to `acc_TCJwBqanN9LTrK`, while designated G12 canary VBF account `9c50dcd9-ed4a-427c-a2fc-07d452f0aec7` is enabled for exactly one first bind. The callback atomically claims the returned unbound merchant, rejects a merchant already bound to another tenant, closes enrollment, and then persists the encrypted grant; a claimed-but-not-persisted retry remains strict first-bind and cannot gain capability fallback. Connect, callback, refresh, and disconnect recovery all require the same account/merchant record. Connector migrations `20260824154937` (isolated Test) and `20260824155039` (Production), 53 focused Razorpay tests, and the full 2,222-test regression passed. Commit `e635b6c` reached Production, the canonical login smoke check passed, and a read-only closeout preserved exact owner-account readiness plus VBF's unbound/zero-queue state. G12 now remains pending only on VBF-owner OAuth consent and the post-consent no-money readiness/isolation/zero-queue closeout. No Payment Link, message, transaction, refund, or money movement was performed.**

Engineering maintenance: **invoice Copy link and Send payment link actions now show the established spinner and accessible busy state while Razorpay, WhatsApp, and template readiness load, then return to their normal icons without changing any role, provider, phone, or template eligibility rule. Active links now show Payment link active as the primary badge with its expiry as adjacent supporting text on the caption line above the link buttons, so link expiry cannot be mistaken for invoice expiry.**

Engineering maintenance: **WhatsApp feature-template readiness now compares ordered button values structurally instead of comparing serialized JSON object key order, so PostgreSQL `jsonb` normalization cannot falsely block an otherwise exact Approved/synced renewal or payment template as component drift; button sequence and all contract values remain strict.**

Engineering maintenance: **all delayed button actions now use one accessible pending contract across authentication, member/contact work, imports, messaging, broadcasts, automations, flows, retries, and cold route transitions: the pressed control spins and blocks duplicate activation, repeated rows stay item-scoped, and successful network-plus-navigation actions remain busy until the destination mounts; instant clipboard and explicitly optimistic local actions keep immediate feedback without artificial delay.**

Engineering maintenance: **every manual follow-up in the product is now written through one composer.** The profile **Notes & follow-ups** block is the base reference, and the standalone Create follow-up dialog opened by every lead and member row action mounts the identical block — note first, follow-up fields attached beneath, same placeholder, same ⌘/Ctrl+Enter submit, same **In 3 days** and **Me** defaults. A note typed in the dialog is now a real timeline note linked to its task instead of text that a completion note overwrote, and the member Reason chip opens on the membership's contextual reason from both entry points. Because only one follow-up may be open per person, the dialog reads that task on open and offers **Complete follow-up** instead of a form that would be rejected on submit. The row trigger is role-gated everywhere it appears, so it can no longer disagree with the same row's avatar quick view, and the automations step calls its work a **Follow-up** rather than a task. Bulk **Add note** stays note-only.

Engineering maintenance: **the lead/member profile Notes & follow-ups surface now presents one captioned control recipe for Reason, Follow-up, Assign to, and Reminder in both the note composer and the standalone Create follow-up dialog; the create action names what it will create and always explains why it is disabled; saved notes expose keyboard- and touch-reachable Edit and Delete actions; and profile follow-up cards carry the task-type icon, an Overdue/Due today status badge for open tasks, and the reminder time that was set**.

Engineering maintenance: **the canonical Button text-link action now stays account-primary without adding an underline on hover, while Accordion content preserves underlines only for ordinary prose links and excludes explicitly marked Button-style anchors; this covers Finance revenue drilldowns, AI Playground setup navigation, and Follow-up filter clearing**.

Engineering maintenance: **the shared member/Business invoice drill-down now preserves both modal gutters under payment-link actions, wraps cleanly at narrow widths, gives dense refund history a wider reading surface and clearer Collected/Refunded hierarchy, hides stale terminal link status from a currently due invoice, and keeps Record payment as the sole primary footer action**.

Engineering maintenance: **shared table headers now inherit one canonical muted neutral label colour from `TableHead`, including nested Finance revenue-source payment tables, with page-level styling limited to layout**.

Engineering maintenance: **the Next.js 16.3 / React 19 tree is ESLint-clean with zero warnings and no rule overrides; mount/refetch and prop/URL synchronization effects use cancellable async boundaries, compiler dependencies preserve whole-object identity where required, the Leads table derives related column layouts through one pure helper, auth/tenant transitions retain intentional documented full reloads, and authenticated Inbox images keep their existing proxy/blob delivery through `next/image`**.

Engineering maintenance: **the selective upstream security refresh pins Next.js and its ESLint config at 16.3.0 without changing React, raises compatible npm/pnpm security floors for the affected image/parser/network transitive dependencies, requires Node 20.18.1+, regenerates both lockfiles, and keeps production audits free of high/critical findings**.

Engineering maintenance: **inbound WhatsApp now has database-enforced one-thread-per-account-contact resolution, race recovery, a unique conversation-creation event boundary, full conversation-scoped Meta-message replay idempotency before every message-derived downstream effect, atomic unread increments through a service-role-only invoker RPC, awaited automation completion, pessimistic run logs, template-button normalization into the existing Flow path, and CAS closed-thread reopening. Applied migration: `20260811043230_inbound_webhook_integrity.sql` on UsefulDesk `fwqthstqrkrwtaehefks`**.

Engineering maintenance: **outbound WhatsApp status callbacks now keep the signed phone-number ID as the tenant boundary, advance inbox-message and broadcast-recipient states through one service-role-only atomic invoker RPC, refuse duplicate/cross-tenant/regressive transitions, and emit public status events only when a stored message actually advances. Applied migration: `20260813205947_whatsapp_status_callback_integrity.sql` on UsefulDesk `fwqthstqrkrwtaehefks`**.

Engineering maintenance: **verified WhatsApp webhook payloads are now durably and idempotently recorded before Meta receives 200; `after()` performs only the first leased drain, while the authenticated 15-minute ops sweep reclaims failed or stale receipts, and successful completion erases payload JSON while retaining the dedupe hash. Applied migration: `20260814023000_durable_whatsapp_webhook_receipts.sql` on UsefulDesk `fwqthstqrkrwtaehefks`**.

Engineering maintenance: **public API broadcasts now persist normalized destinations and per-recipient template parameters before returning 202; `after()` is only the first atomic owner-leased drain, the authenticated 15-minute ops sweep reclaims expired work, stale workers cannot complete a newer claim, and the final recipient transition closes the broadcast. Applied migration: `20260814030000_resume_public_api_broadcasts.sql` on Test `hkuqzmgnhhgecqcbwupb` and UsefulDesk `fwqthstqrkrwtaehefks`; both had zero legacy broadcasts to repair**.

Engineering maintenance: **delayed automation waits now use atomic five-minute owner leases; the authenticated 15-minute cron reclaims expired `running` work, and lease-owner compare-and-set blocks stale terminal updates. Applied migration: `20260814031000_lease_delayed_automation_claims.sql` on Test `hkuqzmgnhhgecqcbwupb` and UsefulDesk `fwqthstqrkrwtaehefks`; both had zero queued executions to repair**.

Engineering maintenance: **flow timeouts now compare-and-set the exact active `last_advanced_at` snapshot classified as stale, so a concurrent inbound advance cannot be overwritten as `timed_out`; focused route coverage protects both the race and ordinary stale expiry, with no schema change and zero active or timed-out flow runs to repair on Test and Production**.

Engineering maintenance: **public API contact submissions now preserve every enquiry in the lead timeline, including dedupe hits, while only genuinely new contacts dispatch `new_contact_created`; focused route coverage protects both states, no schema change was required, and Test plus Production had zero existing API-origin contacts to repair**.

Engineering maintenance: **authenticated inbound WhatsApp media proxy responses are now private and non-storable instead of publicly cacheable for 24 hours; focused route coverage protects the downloaded bytes, content type, and cache contract, with no schema or persisted-data change and no change to the public outbound `chat-media` delivery bucket**.

Engineering maintenance: **template image-header fetches and automation `send_webhook` steps reject non-public targets and redirects with a ten-second bound while preserving automation log semantics; browser broadcast fan-out has a matching 60/min budget plus bounded 429-only retry; successful login and invitation continuation use a full browser navigation so fresh Supabase cookies reach the proxy**.

Engineering maintenance: **signed-in account access now retries one transient profile lookup failure, distinguishes a valid viewer from unresolved branch/role context, and becomes ready only after the selected account row supplies authoritative locale, currency, and timezone settings; failed or unreadable account hydration clears tenant IDs, roles, and capabilities, keeps account-dependent content unmounted, and offers an in-place Retry path without changing RLS or requiring a migration**.

Engineering maintenance: **automation steps inside Condition Yes/No branches now support targeted updates, deletion, insertion into deeply nested conditions, and deep reordering through one regression-tested tree-addressing model; responsive condition cards split by available container width and nested cards stay fluid without introducing i18n or interactive-message expansion**.

Engineering maintenance: **automation Keyword Match triggers now add an explicit Unicode-aware Whole word mode with literal punctuation/regex-character handling and case-sensitive support, while the existing Contains substring default and Exact behavior remain unchanged; no schema change**.

Engineering maintenance: **Tag Added automations now dispatch exactly once for every genuinely new tenant-owned contact/tag join from dashboard contact edits, Flows, Automation add-tag steps, API v1, public lead forms, and Meta lead capture; exact tag matching fails closed, chained tag automations stop at depth three, contacts without conversations log an explicit send failure, and CSV/member imports remain intentionally non-dispatching to avoid accidental mass sends; no schema change**.

Engineering maintenance: **the Inbox now keeps its conversation list inside the mobile viewport with timestamps and status visible, uses a full-width search and recoverable empty/filter states, caps desktop message measure for faster reading, simplifies the narrow composer, and provides explicit accessible names for icon-only messaging and assignment controls while preserving the shared contact-detail surface and existing WhatsApp behavior**.

Engineering maintenance: **the primary sidebar now groups Broadcasts, Automations, Flows, and AI Agents under one Engagement disclosure; active child routes reveal themselves automatically, the open/closed preference persists, the compact desktop rail expands before exposing the nested destinations, navigation and separator spacing use a compact 8px vertical rhythm across layouts, and the branch dropdown keeps a neutral outline at rest so its menu behavior is immediately recognizable**.

Engineering maintenance: **Settings now replaces the thirteen-item Workspace wall with five stable functional groups—Account, Messaging, Lead management, Business setup, and a reduced Workspace—while preserving every existing icon, deep link, permission, panel, and the mobile horizontal rail; the owner-facing labels are Payments and Regional settings, with currency edited only under Regional settings instead of duplicated across both panels**.

Deliberately deferred from the referenced upstream batches: **i18n, AI dashboards, MCP server, Docker, media viewer, the full interactive-message suite, and tunnel-origin config**. Existing UsefulDesk cron timing-safe comparison, RBAC/security-route fixes, and Suspense/build fixes supersede their upstream counterparts.

Shipped addition: **automatic Click-to-WhatsApp referral attribution that preserves every inbound ad/post touch on its message, labels Instagram/Facebook only when a trusted Meta source URL proves the platform, keeps WhatsApp as the immutable intake channel, fills an absent contact acquisition source without overwriting prior attribution, and surfaces both message-level context and contact-level source in the Inbox**.

Shipped addition: **AI-assisted member migration that proposes a typed allowlisted interpretation from bounded CSV samples, deterministically selects each source member’s latest dated row, separates plan terms, preserves expired semantics and legacy IDs, blocks shared-phone merges and unsafe payments, groups repeated findings by their real import consequence, carries every actionable financial row into an uncapped attention-focused preview, retains manual mapping plus human preview, and reports determinate row-level progress during large commits**.

Engineering maintenance: **the Members import resolution workspace now uses compact dialog and preview spacing, one divider above grouped exceptions, and a frameless desktop candidate ledger so dense corrective work stays visible without changing import behavior or restyling shared UI masters**.

Engineering maintenance: **the Members import Resolve issues step now renders every exception through two shared primitives instead of eight bespoke layouts, offers Exclude wherever the step promises it, reads each issue's why/what-next from the single authored copy in the candidate model rather than restating it in the UI, commits correction fields on blur so partial input cannot re-validate the whole file, and counts issue groups in its tab badge so it agrees with the focused-issue position; import behavior and shared UI masters are unchanged**.

Engineering maintenance: **the Members import Resolve issues step now groups its queue under the issue kind so each entry identifies a record rather than repeating a title, leads the working pane with the issue itself, bounds long record lists so the instruction and the commit control stay on screen together, names the rows a group-wide mapping will change, and reads payment conflicts as a labelled figure set; import behavior and shared UI masters are unchanged**.

Engineering maintenance: **the Members import Resolve issues step is now a true two-pane workspace: the queue rail and the focused issue each own a scrollport, so the tab strip, the ready/excluded tally, and both panes no longer ride one shared column scroll. The step frame stops scrolling and sizes its panes through flex rather than a percentage height, which silently collapsed to `auto` under the dialog's max-height clamp. The strip, the rail, and the working pane now carry the dialog's own gutter, the rail's divider runs the full height, and the issue rows lay out against their container instead of the viewport so the dialog's medium width no longer crushes a member's name to a few characters. At phone width the step indicator names only the current step rather than scrolling `Confirm` off the end, and the draft bar holds one line instead of orphaning `Start fresh` on a second row**.

Shipped addition: **member import that separates membership from service in Map columns — each owning its own dates, status, list price, discount amount, discount %, and charged amount — adds row-level Amount due and a mappable legacy Member ID, derives a discount from the actual/discounted column pair every legacy gym export ships, validates list − discount = charged in paise-exact arithmetic at both the browser and database boundaries, persists the result through the existing conversion-discount columns so imported members render their real list price and discount on the invoice they already had, and gives a member a real `trainer_id` gym identity that needs no login seat—separate from the staff `assigned_to` that owns notifications and follow-up ownership—so a bare Trainer column imports instead of being dropped**. All Members shows Trainer inline-editable against the active trainer roster, with Assigned to shipped hidden-but-restorable behind a seeded layout version — owners need a release note for that, since the column disappears once on next load. A same-day source row imports as a one-day membership rather than failing its whole customer group, and every import warning now reaches the operator as a notice: an unmatched trainer or teammate, an unreadable churn risk, height, or weight, and a cancelled member whose unpaid balance is written off on commit.

Engineering maintenance: **the Members import Map columns step was distilled to the one question it asks per column: the redundant Status column, the eyebrow, and the reassurance banner are gone, the mapping suggestion's escape hatch merged into Auto map, the per-column day/month toggles collapsed into one file-level control, blocking rules read as a single sentence beside the blocked button with duplicated fields outlined in the table, and phones stack the picker full width instead of hiding it behind sideways scroll; mapping behavior and shared UI masters are unchanged**.

Shipped addition: **member photo clipboard paste with concise dialog guidance and platform-standard Command+V / Control+V shortcuts feeding the existing validated square-crop preview and optimized WebP upload flow**.

Shipped addition: **an instant avatar hover/focus quick view across every Members tab that enlarges the already-loaded member photo for fast visual identification and keeps the applicable Details, WhatsApp reminder, and Follow-up actions beside the member name and ID without a hover-time query**.

Shipped addition: **one canonical membership checkout shared by Add member, lead conversion, trial conversion, and renewal: responsive plan/date selection; one-cycle amount/percentage discounts and bonus months; catalogue-table products/services; credit-aware invoice totals; optional deferred collection; and full or fixed no-fee 60/40 post-credit collection with the balance due after 28 account-local days on the same invoice. The browser submits structured intent while one idempotent database transaction derives authoritative prices, expiry, offer snapshots, credit application, payments, allocations, and promises; joining/conversion include first-cycle setup fees, renewals exclude them, and existing arrears remain separate. Balance-aware claim-first WhatsApp reminders still run 7, 3, 1, and 0 days before an installment deadline**.

Engineering maintenance: **membership checkout offer opt-ins now select real smart defaults—10% discount and +1 bonus month—fixed-amount selection focuses and flags its required value, clearing either offer flags its source field, unavailable immediate collection identifies the incomplete upstream section instead of presenting an unexplained disabled checkbox, and expanded offer controls remain contained at phone widths**.

Shipped: **dashboard access defense in depth that keeps every authenticated route-group page synchronized with the proxy redirect policy and independently validates the user at the server layout boundary without closing auth, invitation, onboarding, public, or tokenized flows** · **profile tenant/role isolation that blocks direct authenticated changes to `profiles.account_id` and `profiles.account_role` while preserving audited membership RPCs and self-service profile edits** · **public-schema `SECURITY DEFINER` execution hardening that closes client-role default drift, removes direct Data API access from internal/trigger helpers, preserves only internally authorized signed-in and opaque-token RPCs, and keeps AI/webhook helpers service-role-only** · **route-level operational and external-mutation authorization that blocks viewers before automation/flow service-role work or WhatsApp/Meta calls, scopes privileged parent lookups to current tenant membership, and prevents former authors from reaching old-tenant automations through `user_id`** · **storage/media policy hardening that blocks anonymous and tenant-scoped object listing, requires agent capability for chat/flow writes, preserves user-scoped avatars and private signed receipt flows, permits only user-folder-scoped avatar upload metadata returns, and explicitly retains exact-URL public exposure for Meta-delivered chat/flow media** · templated WhatsApp follow-ups · a responsive full-width WhatsApp connection flow with the manual Meta setup guide nested beside its credential form · trial tracking · a dedicated Members payment-due action queue with exact **Due today** / **Overdue** semantics and no duplicated payment-history view · manual reconciliation · **UPI AutoPay with a server-only account-scoped Razorpay connection boundary, retry-safe webhook claims that retain attempt/error context, permanent idempotency after success, and read-only missing-ledger monitoring without automatic replay or reconciliation** · billing periods / invoices · **a hardened member-profile membership and billing flow with cycle-safe edits, confirmed lifecycle actions, balance-aware renewals and payments, invoice-return navigation, exact AutoPay pricing, and responsive mobile actions** · **a focused split-layout lead conversion with a shared 18px semibold large-dialog title hierarchy, inline-editable personal information including Birthday and account-configured Gender, active editors that stay on their label's row in a rail sized to hold them, independently scrolling lead and membership panes, a footer that states the chosen plan's term, cadence, and final fee instead of repeating expiry inside Membership details, an unboxed three-movement checkout — term, optional modifiers, money — replacing the stack of bordered cards, a payment summary that itemises only where a discount, add-on, or credit actually moves the number and otherwise states one headline-step amount due, a content-sized shell, and a mobile Details disclosure that keeps the plan picker above the fold, profile photo and localized measurements beside consistently labelled and spacious plan/payment decisions, responsive height up to 96vh capped at 900px, overlap-safe matching checkbox sections with roomy revealed controls, auditable one-time amount/percentage discounts, and auditable one-time bonus months with editable +1/+2/+3 quick choices; neither offer changes the selected billing option or recurs on renewal, and both validate across field, submit, and database boundaries** · the leads module (CSV import 2.0, ownership transfer, assignment approval, board, **a compact lead follow-up queue plus counted quick views for missing follow-ups, unassigned work, personal assignments, and today's intake; no chip means all leads**) · **a conflict-resolving four-step Members CSV/XLSX import that preserves every source row in one candidate model; supports membership-only, service-only, and combined purchases; keeps latest-start current memberships while retaining valid service history; resolves phone, offering, payment, and existing-contact decisions; uses aggregate-only optional AI suggestions behind deterministic local analysis; commits included-ready customer groups atomically with stable retry keys; downloads a privacy-safe receipt; and resumes author-private revisioned drafts across devices** · attendance limits · **lead capture — public forms + Meta lead ads** (migration `064`; consent captured + audited per submission) · **a plain-language Dashboard laid out as one flat run of sections named by the action rather than the audience — Today at a glance, Quick actions, then two paired rows — Follow-ups beside Expiring memberships, Not contacted yet beside Recent work — Needs attention, then the standalone reading cards — with no grouping heading above them, including a compact Lead health score in the equal-height narrow right card beside the Messages chart, defaulting to All leads with grouped source and duration controls, a larger accessible five-axis radar with fully readable keyboard-and-mouse tooltip labels—including a closely attached, overlap-safe top label—and positive recorded follow-up outcomes, honest unavailable states, calculation detail opened from a tooltip-backed heading icon into its accessible dialog, and a Leads by stage card that labels every number it shows — Stage/Leads/Avg. time columns, a stated base under each conversion tile, and a Joined by source list with Source/Joined/Rate captions; **one fact lives in one place** — Needs attention keeps only the exceptions no other queue owns (May leave, Trials to follow up, Auto-pay problems) and stands as its own section, the Lead status donut is deleted because Leads by stage groups the same buckets and adds stage age, section and card subtitles that restated their own titles are gone, the Work to do and The full picture wrapper headings are deleted so each block is a top-level section, every card title is promoted to that section heading so no `CardTitle` remains on the page and a card keeps a header only for controls that act on its content, and lead and member follow-ups merged into one chronological queue whose audience is an All/Leads/Members filter chip rather than two separate sections, every dashboard card uses the canonical `Card` primitive, and Messages resolves both series through `--chart-1`/`--chart-2`; the former Average First Response Time chart remains implemented but is not surfaced** · a shared accessible 240px search-field master with clear and Escape behavior across data surfaces · a locale-locked `PhoneInput` master wired across public capture, contact/member forms and profiles, typed custom fields, bulk edits, imports, and template phone buttons · shared pill-shaped Sort and Filters actions with an active primary tint across data surfaces · a homogeneous Search → Filters → Sort → counted-chip toolbar order across member, lead, follow-up, and payment data lists, with single-row chevron-browsable chip overflow and compact icon-only table/board view controls · adaptive WCAG-AA semantic colour foreground tokens shared by badges, chips, alerts, icons, and destructive actions · **shared directional KPI deltas with emerald upward trends, red downward trends, and neutral unchanged values across Reports, Dashboard, and Finance** · a collapsible desktop navigation rail with hover-revealed overflow scrollbar, live Inbox unread state, a generated new-message chime, and repeating unread follow-up reminder ringtones · **feature-parity lead/member follow-up queues** with shared search, filters, sorting, counted due buckets, owner scope, table controls, bulk completion, and inline reassignment; member Reason/reminders and lead Status/Stage age stay contextual · **manual follow-up creation parity** with one shared row trigger/dialog, **Notes & follow-ups** as the profile creation path, lead Reason choices removed, standalone tasks visible in the profile even without notes, and one follow-up-first card hierarchy for standalone and note-linked tasks · **repaired lead completion outcomes** so Contacted and Trial booked are enforced consistently by the UI and database.

Member import follow-up: a valid Phone + Service mapping can now reach preview in a branch with no membership plans; the service-aware candidate model, not a stale plan-count gate, decides whether rows need resolution.

**Left:**

- **Meta lead ads: the self-healing implementation, additive Production migrations, owned recovery route, and 15-minute scheduler are live and verified.** Production records `20260822100000_meta_lead_ads_self_healing.sql` and `20260822100001_index_meta_page_config_user_id.sql` as connector-applied versions `20260822093418` and `20260822093424`; deployment commit `e13098e` serves the route, and repeated scheduled runs are healthy with zero configured Pages or queued Meta events. Business Verification, Meta Tech Provider approval, and the WhatsApp Embedded Signup review for `whatsapp_business_messaging`, `whatsapp_business_management`, and `business_management` are complete; their four renewal allowed-use certifications are also complete in the current submission. The **Capture & manage ad leads with Marketing API** use case is attached to the live Meta app and draft `1914379289558468` is scoped to `pages_show_list`, `pages_manage_metadata`, `leads_retrieval`, plus Meta-required `pages_manage_ads`, `pages_read_engagement`, and `ads_management`; unused `ads_read` and Marketing API Access Tier requests are excluded. All six permission descriptions/agreements, the data-handling assessment, and reviewer instructions are complete; the reviewer copy retains the existing test credentials, covers both integrations, and correctly keeps consumer Facebook Login marked **No** because UsefulDesk uses Facebook Login for Business only to authorize selected business assets. The separate **UsefulDesk Lead Ads** Facebook Login for Business configuration (`1039026725782445`) uses the General/user-token flow and exactly those six scopes; it neither enables Facebook sign-in to UsefulDesk nor changes the WhatsApp configuration. Disposable Page **UsefulDesk Lead Ads Test** (Page asset ID `1300231026509095`; profile URL ID `61593607592072`) exists with no public content, contact data, branding, WhatsApp link, or invited audience. Its active review-only Instant Form **UsefulDesk Lead Ads Test Form** (`2157208975142771`) collects full name, phone number, and email, points to `https://usefulmade.com/useful-desk/privacy`, and is not attached to an ad or campaign. The dedicated review account alone receives the non-secret Lead Ads configuration ID on the production domain; normal customer accounts remain dark while the global Production environment gate stays unset. The disposable Page is connected and its Page-level plus app-level `leadgen` subscriptions are healthy; Meta's official test tool confirms user lead permission, Lead Access Manager, Page administration, and clean app diagnostics. The optional `has_lead_access` diagnostic is unavailable for this Page and correctly remains unstamped. The app callback uses the stable Production endpoint, and its handshake plus signed sample succeed. Fresh dummy and custom synthetic deliveries both processed in Production; the dummy placeholder completed safely as phone-less, while the custom lead created one unassigned Meta lead and one enquiry note. The same product walkthrough screencast is saved on all six permission requests, and successful API tests cover every required scope; Meta warns usage counters can take up to 24 hours to update. After the counters update, refresh reviewer instructions to the production-domain review-account URLs and submit App Review. After approval, pass disposable Facebook and Instagram canaries and obtain explicit authorization for a Production canary. Only after that can `NEXT_PUBLIC_META_LEADS_CONFIG_ID` be enabled globally in Production; it remains the customer dark-launch gate.
- Booking.
- `received_via='automation'` remains a **reserved, unwired slot** (a future "create contact" automation step) — set it on that insert and the Leads "Received By" column lights up automatically. See `src/lib/leads/attributes.ts` (`autoReceivedLabel`).

## 🚧 Phase 3 — retention & ops

Built: attendance + plan visit limits / session packs, with separate Name and Plan register columns, All-members-parity Plan header filtering, and one left-aligned name-or-Member-ID search feeding the existing row actions · consistent name/Member-ID/phone substring search across every searchable My Members tab · **account-wide immutable Member IDs with future multi-branch/biometric-safe identity** · a persisted freezable Name column in All Members · **All Members Leads-parity sorting and paging with page-1 resets, clearable active column directions, persisted records-per-page, exact Showing X–Y of Z ranges, and Reset column widths recovery while retaining the fixed no-reorder column manager** · **All Members keeps its real and loading headers sticky inside one bounded vertical-and-horizontal table viewport, with the horizontal scrollbar reachable at the region bottom and the range/page-size/pager footer pinned outside it; frozen checkbox/Name geometry and phone overflow remain unchanged** · **All Members operational Assigned to and Trainer facets shared by the main Filters popover and matching column-header Filter submenus, including Unassigned / No trainer buckets and one RLS-invoker server contract for rows, exact totals, quick counts, select-all-matching, and CSV export** · **All Members selection-scoped bulk Edit for Assigned to, Trainer, and Churn risk only, with approval-gated assignment requests, active-only trainer choices that preserve archived display identities, returned-row proof for direct writes, honest partial outcomes, and failed-row selection retention** · **contact-first All Members selection across membership and service-only customers for rows, pages, and exact All matching results; contact-safe Edit and Add note work on service-only and mixed selections, while renewal reminders, payment recording, and owner/admin deletion are omitted for service-only selections and explicitly blocked for mixed selections until the user keeps only membership customers; completed rows leave selection and partial failures remain selected** · **owner/admin bulk deletion across the current or all search/filter-matching compatible membership selection, preserving anonymized payment-ledger entries and reporting partial failures** · at-risk members via churn-risk flags plus a missed-visit / never-checked-in outreach worklist · dormant recovery through Renewals · **full owner performance reporting consolidated into Business → Performance, with an All-staff/default and teammate-specific assignment filter shared by every metric, chart, performance breakdown, and CSV export; legacy Reports URLs redirect with branch context; overall revenue and collections trends remain only on Business → Overview; paid-social cohort performance sits beside lead-source analysis for All staff; the live all-staff Needs attention queue stays on Dashboard while its staff-scoped snapshot remains in CSV; canonical lead-source icons; Average Sale Price derived from new-member first-invoice value; divider-free section headers; expandable plan summaries; invoice/visit-accurate billing-option performance; and acquisition-source paid revenue in the UI and CSV export** · **a plain-language, decision-first daily dashboard separating owner money/renewal/retention signals from action queues named by the work itself: one merged Follow-ups queue lists every open lead and member task in due order — overdue, then today, then upcoming, with no hidden mode switch — filtered by All/Leads/Members chips carrying live counts, routing each row to its own member or lead detail sheet and completion context, and leading every row with the contact's avatar and name like the queues beside it, carrying the task type and note on one supporting line, showing the member-only Reason in an aligned column that drops entirely under the Leads chip, and the scope-specific See all only when a chip narrows the list to a queue a page owns; the four work sections sit as two rows of two peer sections — Follow-ups beside account-local next-seven-day Expiring memberships, then the lead **Not contacted yet** list beside Recent work — each capped at 480px so an overlong queue scrolls inside its own card rather than pushing the row below it down, with Members-queue deep links while expired recovery stays in the full Renewals queue, and the uncontacted list aligns avatar, name, and latest message without exposing phone numbers; dashboard creation tiles open the existing Lead/Member forms directly; the Needs attention section covers only churn risk, trials, and failed mandates, because Today at a glance already owns renewals, dues, and inactivity; and historical CRM analysis remains visible in standalone reading cards with shared conversation-range controls; Recent work left those deferred cards to join the action rows, reads on its own `view=activity` request, and dropped its **Show N more** expander because the capped card's own scroller already bounds the feed** · **shared Google Calendar-style Business period controls in the app bar across Overview, Performance, Invoices, Payments, and Expenses: the navigator is anchored 24px after the Business title while export, staff/scope selectors, and tab-specific actions remain trailing; Today, fixed-position previous/next arrows, and one fixed-width localized Month Year label stay stable** · **the Business Overview foundation: a calendar-month bird's-eye view with divider-free section headers, revenue and expense comparison, real profit, next-month renewal projection, immutable joining/renewal/sale/due/other revenue attribution with chevron-only stream summaries and five latest contributing member payments (plan only as secondary context), branch-preserving filtered ledger links, day/weekly income-and-expense cash flow with an optional previous-month four-series comparison aligned by day or ordinal seven-day bucket and truncated to the same elapsed account-local day for the live month, its comparison checkbox beside the Daily/Weekly control and series legend below the plot, invoice health, collection mix, purpose-specific recent transactions, admin-only CSV export including the aligned cash-flow comparison, and account-history-bounded Month/Year navigation with adjacent/current-month shortcuts, future guards, and no duplicate tab-level period subtitles** · **the Business Invoices master: calendar-month issued invoices with reconciled summaries led by Outstanding and Overdue, action-first All / Needs attention / Paid / Upcoming / Void quick views, human invoice-number/customer search, payment/plan/collection filters, sorting, paging, full filtered export, exact-period payment entry, immutable non-tax PDF download, agent+ application-side WhatsApp sharing, a compact desktop table plus full-fidelity responsive cards, and one scroll-contained shared detail flow with an unlabelled customer identity beside the financial headline, no duplicated summary-metric row, canonical status language, complete payment/refund/correction history, and standalone sale-customer hydration; refund-review invoices stay visible as attention work but non-collectible, while operational dues and reminders remain in Members → Payments** · **the analytical Business Payments ledger: an Invoices-parity four-card summary without a duplicate Collection mix card, account-timezone month/date scope, payment/member/gateway search, status/plan/method/source/payment-purpose/recorder filters with durable Overview deep links, live quick-view counts, database-side sorting and pagination, exact filtered totals and method split, complete CSV export, receipt audit, deep links back to the existing member sheet, and a compact standalone Payment ID column that keeps Name focused on member identity** · **the Business Expenses ledger: approved Total expenses / Recurring / One-time / Largest category cards, explicit recurring/one-time classification, daily/weekly and category analysis, server-paged filters/sorting/export, private receipts, append-preserving add/void flows, and collision-free dialog remount keys**.

Invoice delivery status: **human numbering/customer identity backfill, first-complete-profile seller finalization, private checksummed immutable non-tax PDF generation/download, and application-side WhatsApp sharing are shipped. The registry has ten exact Meta payloads. `gym_invoice_document` is not present or Approved and synced at the provider, so WhatsApp provider delivery is still pending. GST-ready and statutory documents remain deferred.**

Engineering maintenance: **invoice PDF seller/customer details now use the intended compact 9pt/1.45 line height, with rendered-content regression proof preventing React PDF's 18pt child-style default from reopening the oversized vertical gaps.**

Engineering maintenance: **Business → Invoices now loads one authorized, tenant-scoped, server-filtered/sorted/clamped 25-row ledger page with exact queue counts, summary, and rendered facets instead of hydrating the full month through seven browser requests and five dependency stages. Full filtered CSV export walks bounded server pages under a stable snapshot token, while action-only lines, payments, and refunds stay out of listing responses. Existing invoice/payment/refund/allocation realtime dependencies remain; the unused pricing-option subscription was removed from this tab. Production scale fell from roughly 1.88 MB before HTTP overhead to about 73 KB for the listing page. No evidence-backed index or Supabase compute upgrade was warranted; stop performance changes unless new telemetry identifies another user-visible bottleneck**.

Engineering maintenance: **the invoice detail dialog body is one rule-separated ledger instead of four nested bordered boxes. The masthead card, items frame, summary frame, and payment-history frame are gone, so the dialog title, item names, summary labels, and payment rows share one left edge and one money column. Items and totals read as a single ledger whose foot is the balance, set off by a rule and a size step rather than a tinted row. Section headings moved to the 16px Title step and the balance figure to the 28px Display step of the `MetricCard` recipe, replacing the file's only uppercase micro-label. The headline detail line now appears only for refund review, void, reopened balance, and nothing-to-collect; its `balance_due` and `settled` branches restated ledger rows rendered directly beneath them. From the large breakpoint the body is two columns in a 54rem dialog — the invoice on the left and a fixed 19rem payment-history rail on the right, divided by the shared vertical `Separator` — so line items and payment history stop competing for the same vertical space. The masthead spans both columns so the two section headings share one baseline and one rule; below that breakpoint the columns stack back into the single-column layout unchanged. The refund audit grid now answers to the rail's own width through a container query rather than the viewport. The footer is a single left-aligned horizontal strip with one hierarchy step: every secondary is a ghost button and Record payment is the dialog's only emphasised control, taking the trailing space through `ml-auto`. All six share one line from the extra-large breakpoint, where the dialog widens to 60rem; below it the primary wraps to its own line and the strip keeps its alignment. A settled invoice keeps its document actions on the outline variant because it has no primary to anchor the band. Every action, blocker, permission, readiness rule, and exceptional-state copy string is unchanged**.

Engineering maintenance: **the invoice detail footer is now ranked into two bands instead of one wrapping row of six equal actions. The payment-link caption claims its own line above Copy link, Send payment link, and UPI link; document actions sit beside Record payment on the closing row and recede to the ghost variant only while a collection cluster outranks them, staying outline when they are a settled invoice's only actions. Below the small breakpoint the link buttons fill their rows so a wrap never strands a short one, and the reversed mobile column is gone, so DOM, focus, and visual order agree at every width. Every action, blocker, permission, and readiness rule is unchanged**.

The shipped Business → Invoices detail flow now uses a responsive 560px desktop cap, preserves card rings inside an explicit shrinkable scroll viewport so long histories cannot escape the dialog, keeps the top-right dismiss affordance without a duplicate footer Close action, and shares one reconciled accounting summary across unpaid, part-paid, paid, no-charge, void, credited, adjusted, refunded, and refund-review states. Refunds render as dated outcome-first ledger events with explicit pending, failed, orphaned, processed, accounting-outcome, and review language plus a labelled reason/provider/source/requester audit grid; net collection carries the gross-collected/refunded breakdown once instead of competing rows.

Business → Performance uses the same Today / previous / next / localized Month Year navigator as every other Business tab and applies that calendar month consistently to staff, organization, ad-performance, and CSV data. Its title-only Member activity card switches between daily points and seven-day weekly totals, with compact day-of-month axis labels and full localized tooltip dates. It omits the duplicate Collection mix and overall collections trend; Overview owns those financial visuals, while Performance CSV retains payment-method and Manual/AutoPay source fields for historical export compatibility.

Business → Overview's built revenue-source drilldown keeps phone numbers out of nested payment rows and opens the established member detail sheet in place from any row with a live membership. Nested rows omit repeated headers and Manual/Auto-pay badges; payment method aligns with the parent Payments column while an empty Share slot preserves the parent Revenue axis across every accordion. Member identity yields space to a wider collection-date block, and longer cycle context wraps instead of truncating.

Business → Performance Ad performance places its question-mark help affordance on the trailing side of Leads acquired while keeping the cohort definition available through the existing tooltip.

Business → Performance's All staff CSV now includes branch-wide posted Expenses and Net cash for the selected and previous calendar months while teammate-scoped and organization exports keep their existing attribution boundaries. Settings → Payments now manages the current branch's expense categories with admin-gated add, rename, archive, and restore actions plus explicit read-only and recovery states; archived categories remain attached to historical expenses. New branches receive ten gym-first presets, including Staff salaries & trainer payouts and Software & subscriptions, while existing customized or archived categories are preserved.

Left: trainer payroll and class-delivery accountability beyond assigned-member performance · **Business section finance-domain integration** (`PRDs/finance_master_section.md`): provider approval and sync for the exact invoice-document WhatsApp contract; GST-ready and statutory documents remain deferred pending compliance validation; the failed-AutoPay recovery loop stays with Members → Payments.

## 🚧 Phase 4 — franchise / multi-branch

Built foundation: **organization-over-accounts multi-branch** — an organization/gym group contains existing `accounts`, and each account remains one isolated operational branch with its own WhatsApp number/inbox, members, plans, attendance, payments, finance, staff, automations, API/public surfaces, storage, and integrations. `account_memberships` is the many-to-many branch-role source of truth; durable `?branch=<account-id>` URLs plus request headers bind RLS to exactly one selected branch, while switching hard-reloads and audits the transition. Organization owners can create branches and enter them immediately through the database-authorized switch path, using a one-screen fresh path or a two-screen reuse-settings path from any accessible active same-organization source. Copying remaps identities, excludes credentials/operational history, sanitizes executable content inactive/draft, replays stable requests idempotently, and retains authoritative currency, size, lifecycle, and tenant checks without requiring plans, members, integrations, or a subjective readiness review; the owner-facing wizard uses responsive setup choices, a compact source selector, and a contextual copy screen, defaults only useful basic settings, collapses advanced choices, and omits technical counts and exclusions. Owners can also switch in expanded/collapsed/mobile chrome, archive and restore branches, permanently delete an individual branch with Storage/Auth cleanup and surviving-branch safeguards, read owner-only consolidated reports with branch, legal-entity, and separate-currency attribution, and permanently erase the complete organization through an exact-confirmation Settings flow that purges database, Storage, and exclusive Auth identities while preserving cross-organization users. Invitations are additive, staff/role/ownership RPCs are branch-explicit, duplicate discovery is warning-only, and proactive WhatsApp opt-out is organization-wide with narrow branch/purpose re-opt-in audit events.

Assignment and notification isolation is also enforced at the database boundary: contact, conversation, and follow-up assignees plus notification recipients must belong to the referenced branch, notification reads require retained membership, and member removal clears branch-local operational ownership and notification rows transactionally.

Account authority fields are function-only at the client boundary: branch admins retain direct edits for ordinary settings, while ownership, organization, and legal-entity changes require authorized lifecycle operations and are guarded by both column privileges and an invoker trigger.

Left: richer legal-entity administration and tax documents · explicit organization export flow · connection-readiness recovery tooling · broader consolidated finance/retention drilldowns · authorized duplicate-person discovery UI · branch transfer workflows. Deliberately deferred: unified live inbox, cross-branch check-in, membership portability, automatic member transfer, shared payment/WhatsApp credentials, and merged member/contact records. Family/household plans remain separate work.

## Don't build early

Branded member app · class marketplace · payroll · workout/nutrition tracking · franchise analytics · door access · loyalty.

## Optional / open

- Richer Razorpay `payment.failed` handling — an immediate "auto-pay failed, pay manually" nudge instead of waiting for `subscription.halted` → manual.
- One-click "Connect Razorpay" via OAuth: **Technology Partner onboarding, isolated Stages 1–4, owner-controlled Stage 5 Live acceptance, the real gym-owner connection-readiness pilot and ₹40 delivery/settlement, pinned-readiness recovery, Stage 6 OAuth-only retirement, and the database-owned multi-account rollout gate are complete and live in Production.** The owner-controlled account remains permanently enabled and exactly bound; VBF is the sole unbound G12 first-bind canary, with no credential or active OAuth state. VBF's Razorpay owner may now complete Live consent; then the established no-money readiness, isolation, and zero-queue checks close G12. The VBF authorization does not include a Payment Link, message, transaction, refund, or money movement. Manual keys, legacy per-account ingress, environment account/merchant pins, and in-place client-secret rotation are not rollout options. Exact evidence lives in `docs/razorpay-operations.md`.
- Auto-generating / charging _future_ invoices (a billing cron — overlaps AutoPay) · persisting the Upcoming projection.
- Account-wide pending-transfers console · lead-transfer auto-expiry cron.
- Leads board **group-by** (pivot on source / assignee instead of status) — has a real drag-semantics decision (dragging would set the grouped dimension: a direct source-write vs the approval-gated `requestLeadAssignment`), so it's a feature, not a pref.
