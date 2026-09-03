# Native Mobile Inbox Stage 3 Media Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let authorized mobile agents select, validate, preview, upload, cancel, caption, send, and deliberately recover image, video, document, and audio attachments from the native Inbox without weakening branch isolation or ambiguous-send safety.

**Architecture:** Add a small cross-platform media contract for the existing public `chat-media` bucket, then compose three focused mobile units: picker normalization, an authenticated branch-scoped upload transport with real progress/abort behavior, and staged-attachment UI inside the existing conversation composer. Media sends continue through the canonical `POST /api/whatsapp/send` service and reuse the existing optimistic/API/realtime identity reconciliation; no provider logic or credentials move into the app.

**Tech Stack:** TypeScript, Expo 57, React Native 0.86, React 19, Expo Image Picker, Expo Document Picker, Supabase Storage/Postgres/RLS, XMLHttpRequest upload progress, HeroUI Native masters, Jest/React Native Testing Library, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-01-mobile-native-inbox-chat-design.md`

## Global Constraints

- Work directly in the saved `main` checkout because the human explicitly authorized it; do not create or use a Git worktree and do not push.
- Preserve all unrelated dirty dashboard, follow-up, roadmap, changelog, and UI-pattern work byte-for-byte. Stage only files and exact documentation hunks owned by this task.
- This plan implements only Stage 3 media. Quoted replies, reactions, push notifications, advanced actions, camera capture, and microphone recording remain deferred.
- Image/video selection uses Expo Image Picker; document/audio selection uses Expo Document Picker. Audio means choosing an existing Meta-accepted audio file, not recording.
- Accepted MIME types and ceilings match the existing `chat-media` bucket: PNG/JPEG/WebP images up to 5 MiB; MP4/3GPP video, allowed office/PDF/text documents, and OGG/MPEG/AAC/MP4/AMR audio up to 16 MiB.
- A missing, mismatched, or unsupported picker MIME type fails before upload with safe application copy; no extension-only fallback may silently reinterpret an unsafe file.
- Storage paths retain the canonical `account-<account_id>/<timestamp>-<safe-basename>.<ext>` form and are created only for the currently selected active branch.
- Upload uses the current Supabase bearer session and public anon key against the existing `chat-media` Storage endpoint, includes the explicit selected-branch header, reports genuine byte progress, supports abort, and retries at most once after one 401 refresh. A 403 never retries as another branch.
- Storage RLS and the canonical `agent+` capability remain authoritative. Viewer and inactive-branch surfaces expose no attachment controls.
- The mobile bundle contains only the already-approved public Supabase URL, anon key, API base URL, and app environment; no service-role, Meta, signing, or private credential is added.
- Media is free-form WhatsApp content and may be sent only inside the open 24-hour service window. If the window closes after selection/upload begins, keep the staged shell and route Send to the existing template-resolution blocker without contacting the provider.
- The regular text draft remains intact while an attachment is staged and returns after the attachment is sent or discarded. Non-audio media accepts a caption capped at 1,024 characters; audio never sends a caption or filename.
- Selection cancellation is silent. Picker, validation, upload, and provider errors are explicit and recoverable without losing the staged local asset.
- An upload failure offers deliberate Retry and Cancel. Cancelling an in-flight upload aborts it. Discarding an uploaded-but-unsent attachment best-effort deletes its object under RLS.
- A confirmed media send transfers object ownership to the persisted message and must not delete it. A delivery-unconfirmed send locks duplicate Retry and must not delete the object because the provider may still fetch it; the agent must check the conversation before clearing the local shell.
- Optimistic media rows carry the real media kind, public URL, caption, and local document filename. API acknowledgement and realtime INSERT reconcile to exactly one row in either arrival order.
- Branch change/sign-out/unmount aborts in-flight work, clears staged local state, and best-effort removes only a confirmed-unsent uploaded object. No offline or background automatic send queue is introduced.
- Feature code imports UsefulDesk native masters from `apps/mobile/src/ui`; it does not import web UI, DOM, Next.js, or browser-only modules.
- Use the existing native Button, IconButton, ComposerField, semantic chat colours, 48pt minimum targets, Dynamic Type, accessible labels/live regions, and non-circular action geometry. A domain-specific attachment preview/progress composition is allowed; do not add or edit a shared UI master.
- Automated tests use injected transports and picker modules and must never open a real picker, upload an object, contact Meta, or send a customer message.
- Follow strict TDD for each behavior: write the smallest behavior test, run it and record the expected failure, add minimal production code, then rerun to green before refactoring.
- Completion updates both `docs/changelog.md` and `PRDs/roadmap.md` without claiming physical-device, provider-delivery, or remote-EAS evidence that was not exercised.

## File Structure

- `src/lib/storage/media-contract.ts`: pure shared media kinds, MIME allow-list, per-kind limits, validation, and canonical path construction; browser storage helpers re-export the existing public names.
- `apps/mobile/src/features/inbox/media-picker.ts`: Expo picker adapters and strict normalization into one staged local asset shape.
- `apps/mobile/src/features/inbox/media-upload-client.ts`: branch-aware authenticated Storage upload/delete transport, progress, abort, one refresh retry, public URL resolution, and safe typed failures.
- `apps/mobile/src/features/inbox/send-message-client.ts`: adds the media request variant while preserving text/template behavior and response safety.
- `apps/mobile/src/features/inbox/outbound-message-state.ts`: adds optimistic media construction without changing the identity reconciliation rules.
- `apps/mobile/src/features/inbox/use-message-thread.ts`: exposes media send/retry commands using the existing scope/feed generation guards.
- `apps/mobile/src/features/inbox/components/conversation-composer.tsx`: owns picker menu, staged asset, preview/caption, upload progress/cancel/retry, send safety, object cleanup, and text-draft preservation.
- `apps/mobile/src/features/inbox/screens/conversation-screen.tsx`: keeps a staged composer mounted through a service-window transition and connects the existing template resolution.
- `apps/mobile/app.config.ts`, `apps/mobile/package.json`, and root `package-lock.json`: register/install the two focused Expo picker modules only.

---

### Task 1: Native Inbox media end to end

**Files:**

- Create: `src/lib/storage/media-contract.ts`
- Create: `src/lib/storage/media-contract.test.ts`
- Modify: `src/lib/storage/upload-media.ts`
- Modify: `src/lib/storage/upload-media.test.ts`
- Create: `apps/mobile/src/features/inbox/media-picker.ts`
- Create: `apps/mobile/src/features/inbox/media-picker.test.ts`
- Create: `apps/mobile/src/features/inbox/media-upload-client.ts`
- Create: `apps/mobile/src/features/inbox/media-upload-client.test.ts`
- Modify: `apps/mobile/src/features/inbox/send-message-client.ts`
- Modify: `apps/mobile/src/features/inbox/send-message-client.test.ts`
- Modify: `apps/mobile/src/features/inbox/inbox-types.ts`
- Modify: `apps/mobile/src/features/inbox/outbound-message-state.ts`
- Modify: `apps/mobile/src/features/inbox/outbound-message-state.test.ts`
- Modify: `apps/mobile/src/features/inbox/use-message-thread.ts`
- Modify: `apps/mobile/src/features/inbox/use-message-thread.test.tsx`
- Modify: `apps/mobile/src/features/inbox/components/conversation-composer.tsx`
- Modify: `apps/mobile/src/features/inbox/components/conversation-composer.test.tsx`
- Modify: `apps/mobile/src/features/inbox/screens/conversation-screen.tsx`
- Modify: `apps/mobile/src/features/inbox/screens/conversation-screen.test.tsx`
- Modify: `apps/mobile/app.config.ts`
- Modify: `apps/mobile/package.json`
- Modify: `package-lock.json`
- Modify after implementation: `docs/changelog.md`
- Modify after implementation: `PRDs/roadmap.md`

**Interfaces:**

- Produces: `MediaKind = 'image' | 'video' | 'document' | 'audio'`, a literal MIME contract, `validateMediaAsset(...)`, and the existing `buildMediaPath(...)`/`MEDIA_MAX_BYTES_BY_KIND` public surface without breaking web callers.
- Produces: `pickConversationMedia(kind, dependencies?): Promise<PickedMediaAsset | null>` where `null` is user cancellation and a normalized asset contains `kind`, local `uri`, `name`, `mimeType`, and `size`.
- Produces: `uploadConversationMedia(input, dependencies?): { promise: Promise<UploadedMedia>; abort(): void }`, with progress values in `[0, 1]`, one 401 refresh, explicit branch checks, and `{ publicUrl, path }` success.
- Extends: `MobileSendInput` with `{ kind: 'media'; accountId; conversationId; mediaKind; mediaUrl; caption?; filename? }`, serialized to the existing route keys `message_type`, `media_url`, `content_text`, and `filename`.
- Produces: optimistic media rows through a generic or media-specific append helper while preserving all current text exports and tests.
- Extends: `UseMessageThreadResult` with media send/retry behavior; its state commands preserve current scope/feed generation and ambiguous-send rules.
- Extends: `ConversationComposer` with injected/default picker and uploader boundaries, `onSendMedia`, staged-state notification, `sessionExpired`, and template resolution while preserving current text behavior.

- [ ] **Step 1: Add the shared contract tests and verify RED**

  Test literal MIME/kind acceptance, mismatched or missing MIME rejection, 5 MiB/16 MiB boundaries, safe path normalization, extension handling, and preservation of the existing browser exports. Name the production mutation each test catches.

  Run: `npm test -- src/lib/storage/media-contract.test.ts src/lib/storage/upload-media.test.ts`

  Expected: FAIL because the shared contract does not exist.

- [ ] **Step 2: Implement the shared pure contract and restore GREEN**

  Move only pure constants/path logic out of `upload-media.ts`; keep its existing exports as re-exports so browser call sites remain unchanged. Do not change bucket policies or migrations.

  Run: `npm test -- src/lib/storage/media-contract.test.ts src/lib/storage/upload-media.test.ts`

  Expected: PASS.

- [ ] **Step 3: Add picker normalization tests and verify RED**

  Cover image/video picker options, document/audio MIME filters, successful complete asset normalization, picker cancellation, unsupported/missing MIME, wrong kind, zero-byte/missing size, and over-limit files. Mock only the two native picker boundaries.

  Run: `npm --prefix apps/mobile test -- --runInBand src/features/inbox/media-picker.test.ts`

  Expected: FAIL because `media-picker.ts` does not exist.

- [ ] **Step 4: Install/configure the two Expo modules and implement picker normalization**

  Use `npx expo install expo-image-picker expo-document-picker` from `apps/mobile` so Expo chooses SDK-compatible versions and updates the root lockfile. Add their config plugins without camera/microphone scope; do not enable iCloud storage or capture permissions. Implement the narrow adapters and return `null` on user cancellation.

  Run: `npm --prefix apps/mobile test -- --runInBand src/features/inbox/media-picker.test.ts && npm --prefix apps/mobile run typecheck`

  Expected: PASS.

- [ ] **Step 5: Add upload transport tests and verify RED**

  Inject the XHR/blob/auth/branch dependencies. Cover exact Storage URL/path and public URL, bearer/anon/branch/content headers, genuine progress clamping, abort, current-token acquisition, branch mismatch before any request, 401 refresh exactly once, second 401 secure recovery, 403 without branch retry, object-exists recovery only for the same stable attempt path, safe error mapping, and best-effort delete of the exact account path.

  Run: `npm --prefix apps/mobile test -- --runInBand src/features/inbox/media-upload-client.test.ts`

  Expected: FAIL because `media-upload-client.ts` does not exist.

- [ ] **Step 6: Implement the upload/delete client and restore GREEN**

  Read the local URI into a Blob once, create the stable canonical path once, upload raw bytes to the existing bucket with XHR progress/abort, and use the current session plus one refresh retry. Re-check the selected branch before each attempt. Never log tokens, local URIs, or provider/storage response bodies.

  Run: `npm --prefix apps/mobile test -- --runInBand src/features/inbox/media-upload-client.test.ts && npm --prefix apps/mobile run typecheck`

  Expected: PASS.

- [ ] **Step 7: Add media request and optimistic reconciliation tests and verify RED**

  Cover all four exact route payloads, audio omission of caption/filename, 1,024-character caption boundary, optimistic row shape, API-first and realtime-first one-row reconciliation, provider failure, safe retry through the same temporary row, and duplicate retry coalescing.

  Run: `npm --prefix apps/mobile test -- --runInBand src/features/inbox/send-message-client.test.ts src/features/inbox/outbound-message-state.test.ts src/features/inbox/use-message-thread.test.tsx`

  Expected: FAIL because media inputs and thread commands are absent.

- [ ] **Step 8: Implement media send/state/thread behavior and restore GREEN**

  Extend the existing discriminated request type and optimistic state rather than forking transport/reconciliation. Preserve text exports. Keep document filename only as optional local optimistic metadata; persisted/realtime rows remain authoritative. Apply the same scope/feed guards and unsafe-ambiguity lock as text.

  Run: `npm --prefix apps/mobile test -- --runInBand src/features/inbox/send-message-client.test.ts src/features/inbox/outbound-message-state.test.ts src/features/inbox/use-message-thread.test.tsx && npm --prefix apps/mobile run typecheck`

  Expected: PASS.

- [ ] **Step 9: Add composer/screen behavior tests and verify RED**

  Cover the four accessible attachment choices, silent selection cancellation, validation errors, local image preview and non-image summary, regular text-draft preservation, caption/audio rules, upload progress/live announcements, in-flight abort, failed-upload Retry/Cancel, uploaded-draft cleanup on discard/unmount, successful-send ownership transfer, safe provider retry, ambiguous-send lock/no-delete, duplicate-press guards, viewer/inactive omission, and a staged shell surviving an open-to-closed window transition with only template resolution allowed.

  Run: `npm --prefix apps/mobile test -- --runInBand src/features/inbox/components/conversation-composer.test.tsx src/features/inbox/screens/conversation-screen.test.tsx`

  Expected: FAIL because attachment presentation/integration is absent.

- [ ] **Step 10: Implement the native staged-attachment UI and restore GREEN**

  Compose only existing masters plus Inbox-domain presentation. Keep all controls at least 48pt, captions Dynamic-Type-safe, upload state accessible, and action geometry non-circular. Keep the same composer component mounted while a staged item exists so backgrounding or a service-window transition does not discard it.

  Run: `npm --prefix apps/mobile test -- --runInBand src/features/inbox/components/conversation-composer.test.tsx src/features/inbox/screens/conversation-screen.test.tsx && npm --prefix apps/mobile run lint && npm --prefix apps/mobile run typecheck`

  Expected: PASS with no new warnings.

- [ ] **Step 11: Run the focused media regression set and self-review**

  Run:

  ```bash
  npm test -- src/lib/storage/media-contract.test.ts src/lib/storage/upload-media.test.ts
  npm --prefix apps/mobile test -- --runInBand \
    src/features/inbox/media-picker.test.ts \
    src/features/inbox/media-upload-client.test.ts \
    src/features/inbox/send-message-client.test.ts \
    src/features/inbox/outbound-message-state.test.ts \
    src/features/inbox/use-message-thread.test.tsx \
    src/features/inbox/components/conversation-composer.test.tsx \
    src/features/inbox/screens/conversation-screen.test.tsx
  ```

  Expected: PASS. Review every changed line against the global constraints and record any concern before committing.

- [ ] **Step 12: Update completion docs without absorbing unrelated dirty hunks**

  Append one terse changelog entry naming the mobile files and the upload/safety gotcha. In the Phase 2 mobile paragraph, move Stage 3 media to built and leave replies, reactions, push, and advanced actions deferred. Do not rewrite or stage any pre-existing unrelated documentation change.

- [ ] **Step 13: Run complete verification**

  Run:

  ```bash
  npm --prefix apps/mobile run verify
  npm --prefix apps/mobile exec expo-doctor
  npm --prefix apps/mobile exec expo export --platform ios --output-dir /tmp/usefuldesk-stage3-media-ios
  npm --prefix apps/mobile exec expo export --platform android --output-dir /tmp/usefuldesk-stage3-media-android
  npm run lint
  npm run typecheck
  npm test -- --runInBand
  npm run build
  git diff --check
  ```

  Expected: every command exits 0. If repository-wide formatting still stops only at the unchanged tracked baseline already recorded in the roadmap, report that exact evidence instead of claiming the aggregate gate passes.

- [ ] **Step 14: Commit only task-owned changes**

  Commit code/tests/config/dependency changes and the new plan with an explicit path list. For dirty shared docs, stage only the exact new media hunks (for example with a generated patch applied to the index) and verify `git diff --cached` contains none of the pre-existing dashboard/follow-up/doc work.

  Suggested commit: `feat(mobile): add native Inbox media sending`
