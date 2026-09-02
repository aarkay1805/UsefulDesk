# Native mobile Android 11 physical smoke

**Date:** 2026-09-02
**Status:** Approved in conversation; awaiting review of this written specification

## Context

UsefulDesk mobile Inbox Stage 2 has passed automated verification and a focused
physical-iPhone layout smoke, including the development-only local conversation
fixture. Android runtime behavior is still unverified. A physical OnePlus 6 is
now connected and authorized over USB. It runs Android 11 (API 30) at
1080 × 2280 with a 450 dpi density.

This work is a release-readiness validation slice, not a new product feature.
The device smoke should prove that the current native app installs, launches,
authenticates, isolates the selected branch, renders the Inbox and conversation
layout, behaves correctly around the keyboard and Android system Back, and
survives background/foreground transitions. It must not send a customer
message or create provider-side state.

## Goals

- Install and launch the current Android development client on the connected
  physical device using the existing local mobile environment.
- Verify startup, session restoration or login, selected-account resolution,
  Inbox loading, search, All/Unread filtering, and branch isolation through
  the normal production UI and repositories.
- Verify the Stage 2 conversation and composer layout with the existing exact,
  development-only local fixture, without a network send path.
- Exercise Android 11 system Back, keyboard avoidance, app backgrounding and
  foreground resynchronization, light/dark appearance, and a large system-font
  setting.
- Capture enough device, screen, and log evidence to distinguish a passed check
  from an assumption.
- Fix only Android defects discovered by the smoke, using a failing regression
  test first and the smallest compatible implementation change.
- Restore any device appearance or font setting changed for validation.

## Non-goals

- Sending WhatsApp text, templates, media, reactions, replies, or any other
  customer-facing mutation.
- Editing contacts, assignments, memberships, payments, or other CRM data.
- Remote EAS builds, Play Store distribution, signing, push credentials, or
  changes to provider configuration.
- Stage 3 rich conversation work.
- Coverage of Android 13+ predictive Back, Android 12+ dynamic color, tablets,
  foldables, or the full Android device matrix.
- Replacing the existing iPhone evidence or declaring broad mobile release
  readiness from one Android 11 handset.

## Approved approach

Use the existing Expo development client with Metro and combine two evidence
paths:

1. The normal authenticated app exercises startup, account selection,
   branch-scoped live reads, search/filter behavior, navigation, Back, and
   lifecycle resynchronization.
2. The existing development-only local conversation deep link exercises a
   deterministic thread with message bubbles, metadata, composer, keyboard,
   and large-text layout. Its repositories are in memory, realtime is a no-op,
   and its sender fails closed before any transport call.

This is preferred over live-data-only validation because the available branch
may not contain a safe, representative conversation. A release APK is deferred:
the local fixture is deliberately excluded from production behavior, while
distribution and signing are separate release gates.

## Safety and data boundaries

- Load the existing mobile environment without printing, copying, or
  documenting credential values. No service-role, Meta, signing, or private
  API secret may enter the app or the evidence bundle.
- Use the normal branch-aware Supabase client and existing RLS for all live
  reads. The smoke may select an account and read its Inbox; it may not create,
  update, delete, or send customer data.
- Reach the local fixture only with its exact fixture conversation id and
  `fixture=local-layout` flag while `__DEV__` is true. Production routes and
  other ids continue to use the real repositories.
- The local sender must remain fail-closed. Typing a harmless draft is allowed;
  pressing Send is not.
- Keep screenshots and logs local. Review them for phone numbers, names,
  message text, tokens, and other private data before referencing or sharing
  them.
- Generated native/build output remains ignored and is not committed.

## Device smoke matrix

### 1. Build, install, and launch

- Confirm the authorized Android target before installation.
- Build/install the current development client and start Metro with the saved
  mobile environment.
- Launch from a stopped state and verify there is no native crash, red screen,
  unrecoverable JavaScript exception, or infinite loading state.
- If authentication is required, pause for the user to enter credentials on
  the device. Never request, record, or type those credentials through logs or
  commands.
- Relaunch once after authentication to verify session restoration.

### 2. Normal authenticated app

- Confirm the selected account/branch resolves and the Inbox loads through the
  normal repositories.
- Verify the All and Unread filters, Inbox search, empty/loading/error
  presentation where naturally available, and Account navigation.
- When the signed-in user has more than one branch, switch branches and verify
  prior-branch content clears before the new Inbox loads. Do not manufacture
  another account or test record if only one branch exists.
- Use Android system Back through nested navigation and verify it returns to
  the expected prior screen rather than exiting or exposing stale state.
- Background and foreground the app, then verify the current branch and Inbox
  resynchronize without duplicating rows or losing navigation state.

### 3. Deterministic local conversation fixture

- Open the exact development fixture deep link and verify chronological
  message bubbles, sender runs, timestamps, status metadata, date separation,
  and the Stage 2 composer.
- Focus the composer, type `Android layout check — do not send`, and verify the
  focused input and newest message remain visible above the keyboard.
- Clear the draft without pressing Send.
- Dismiss the keyboard and use system Back to return to Inbox.
- Confirm logs contain no transport attempt from the fixture.

### 4. Appearance and text scaling

- Record the device's original appearance and font-size settings.
- Immediately before changing either system setting, obtain the user's
  confirmation because the change affects the whole device.
- Exercise both light and dark appearance and a large standard system font.
- Recheck Inbox rows, filter/search controls, message bubbles, delivery
  metadata, composer controls, keyboard avoidance, truncation, clipping, and
  actionable touch targets.
- Restore the original appearance and font-size settings, then verify the
  restored values.

### 5. Evidence

- Retain a concise checklist of each attempted matrix item and its result.
- Capture focused screenshots for material layout checks and focused device
  logs for startup, lifecycle, or crash evidence. Avoid collecting broad logs
  longer than needed.
- Record explicit coverage limits, including any step that could not be tested
  because the account lacked suitable branch data.

## Failure handling

Device authorization, local build-tool, authentication, and data-availability
failures are reported as blockers with the exact failed step and safe evidence.
They do not authorize destructive device changes, credential handling, fake
production data, or a weaker substitute result.

For an app defect:

1. Stop the affected matrix path and capture the smallest useful reproduction
   and log evidence.
2. Add a failing automated regression test at the nearest stable boundary.
3. Implement the smallest fix consistent with existing mobile architecture and
   shared UI rules.
4. Run the focused test, the full mobile verification gate, formatting, and
   diff checks.
5. Rebuild/reload as required and rerun the failed device check plus one nearby
   regression check.

Broad refactors, dependency upgrades, new shared UI masters, and feature-scope
expansion require a separate decision. If a shared master appears necessary,
the affected call sites must be identified and the user warned before it is
edited.

## Verification and completion

The Android slice is complete only when:

- The current development client installs and launches on the connected
  Android 11 device.
- Normal authenticated startup, account/branch resolution, Inbox list,
  search/filter behavior, navigation, system Back, and lifecycle recovery are
  either observed passing or explicitly documented as blocked by unavailable
  account data.
- The development-only fixture proves conversation layout, composer focus,
  keyboard avoidance, harmless draft entry/clearing, and Back without a send
  attempt.
- Approved appearance/font checks pass and the original device settings are
  restored.
- Device logs show no crash or unhandled runtime error during the accepted
  paths.
- Any code change passes its focused regression test and the full mobile
  verification gate (`npm run mobile:verify`). Touched files pass the
  repository formatter and `git diff --check`.
- The mobile acceptance report contains the Android device evidence and honest
  coverage limits. `docs/changelog.md` and `PRDs/roadmap.md` are updated only
  for behavior actually verified or fixed.

Android 11 evidence validates classic system Back behavior only. Predictive
Back, newer platform theming, alternative form factors, and remote release
distribution remain explicit future validation gates.
