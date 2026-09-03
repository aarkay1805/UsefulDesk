---
version: 1
slug: 'mobile-src-features-inbox-screens-inbox-screen-tsx'
primary_target: 'apps/mobile/src/features/inbox/screens/inbox-screen.tsx'
related_targets:
  [
    'apps/mobile/src/features/inbox/screens/conversation-screen.tsx',
    'apps/mobile/src/features/inbox/components/conversation-composer.tsx',
    'apps/mobile/src/features/inbox/components/message-bubble.tsx',
  ]
---

# Mobile Inbox visual direction

- Platform: native Android first, with Android system back, safe-area, font scaling, and 48 dp touch-target behavior preserved.
- Reference character: Google Messages—calm, familiar, spacious, and conversation-first—without copying unavailable Google-only actions.
- Composition: pale blue-grey chrome frames a white content plane with the Android reference's 28 dp top corners. The Inbox uses 48 dp, high-contrast avatars and edge-free rows; conversation screens use the same chrome and rounded white thread plane.
- Color: the existing UsefulDesk blue remains the single action/unread accent. Incoming bubbles use a neutral surface and outgoing bubbles use a soft blue surface. All colors resolve through semantic light/dark tokens.
- Type: system typography, sentence case, clear contact-first hierarchy, restrained metadata, and no decorative type treatments.
- Shape: 24 dp high-radius message bubbles without tails, pill-shaped filters and composer, a circular 48 dp Send action, and a rounded attachment tray.
- Interaction: existing send, retry, attachment, reply, ownership, and closed-window behavior stays intact. No decorative or dead call, Gemini, or contact actions are introduced.
