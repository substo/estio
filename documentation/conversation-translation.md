# Conversation Translation
**Last Updated:** 2026-04-18

This document is the source of truth for conversation-thread translation in `/admin/conversations`: internal viewing language, outbound reply language overrides, manual send-time translation, cached translation overlays, and the shared composer/thread UI contract.

## Overview

Conversation translation is intentionally split into three separate concepts:

1. **Viewing language**
   - Internal language used by agents when reading inbound messages in the thread UI.
   - Current implementation resolves this from the agent's browser/UI language, with English fallback.
   - This affects translation overlays only. It never mutates canonical message content.

2. **Reply language**
   - Outbound target language used when an agent wants replies sent in a specific language.
   - Stored per conversation in `Conversation.replyLanguageOverride`, with location-level fallback from `location.ai.defaultReplyLanguage`.
   - Manual override must persist until cleared. It must not auto-switch just because a lead writes in another language.

3. **Draft review language**
   - Language used for AI Draft so the agent can read and edit the draft before send.
   - Current implementation uses the agent's browser/UI language, with English fallback.
   - AI Draft is not automatically generated in the client-facing reply language.

## Current UX Contract

### Inbound Reading
- Inbound message bubbles support per-message translation.
- When repeated likely foreign-language inbound messages are detected, the thread can switch into translated view by default.
- Thread-level preference is presentation-only and persists when the thread is reopened.
- Agents can toggle:
  - `Show translation`
  - `Show original`

### Outbound Sending
- Manual typed sends support translation preview before send.
- Agents can choose:
  - `Send translated`
  - `Send original`
- When `Send translated` is used:
  - canonical timeline content remains the exact text sent to the client
  - internal source/authored text is kept only in translation metadata and internal toggles

### AI Draft
- AI Draft is generated in the agent review language, not the reply/send language.
- The composer should clearly communicate the split:
  - `Viewing in English`
  - `Drafting in English for review`
  - `Replying in Greek`

## Language Resolution

### Viewing Language
- Current source: `window.navigator.language`
- Fallback: `en`
- Used for:
  - choosing the active translation overlay shown to the agent
  - thread-level translate-visible actions
  - translated/default thread presentation

### Reply Language
- Resolution order:
  1. explicit target passed to translation preview/send actions
  2. `Conversation.replyLanguageOverride`
  3. `location.ai.defaultReplyLanguage`
  4. final fallback `en`
- Used for:
  - send-time translation preview
  - translated outbound sends
  - outbound intent/policy expectations

### Draft Language
- Current source: `window.navigator.language`
- Fallback: `en`
- Used for:
  - composer AI Draft
  - deal timeline draft entry points
  - Mission Control quick draft entry

## Data Model

### Conversation
```prisma
model Conversation {
  replyLanguageOverride String? // Optional normalized BCP-47 code, null = Auto
}
```

### Translation Cache
```prisma
model MessageTranslationCache {
  id                     String   @id @default(cuid())
  messageId              String
  conversationId         String
  locationId             String
  targetLanguage         String
  sourceHash             String
  sourceText             String   @db.Text
  translatedText         String   @db.Text
  detectedSourceLanguage String?
  detectionConfidence    Float?
  status                 String   @default("completed") // completed | failed
  provider               String?
  model                  String?
  error                  String?
  createdAt              DateTime @default(now())
  updatedAt              DateTime @updatedAt

  @@unique([messageId, targetLanguage, sourceHash])
}
```

## Payload Contract

Conversation messages expose:
- `detectedLanguage`
- `detectedLanguageConfidence`
- `translations`
- `translation`

`translation` is a UI state object:
- `active`: preferred overlay for the current viewing language
- `available`: cached variants
- `viewDefault`: `original` or `translated`

Canonical message text still lives in `Message.body`.

## Server Actions

### `previewTranslatedReply(conversationId, sourceText, channel, targetLanguage?)`
- Generates send-time translation preview without mutating the message.
- Uses reply-language resolution, not viewing-language resolution.

### `translateConversationMessage(messageId, targetLanguage?)`
- Translates a single inbound message into the requested viewing language.
- Reuses cached successful entries when available.

### `translateConversationThread(conversationId, targetLanguage?, visibleMessageIds?)`
- Batch-translates the visible inbound thread window.
- Used by the thread-level assist banner and translated-view flow.

## Realtime

Translation writes emit:
- `conversation.message_translation.created`
- `conversation.thread_translation.created`

Active threads can refresh overlays without full reload.

## Implementation Notes

- Internal viewing language and outbound reply language are intentionally decoupled.
- Per-message outbound toggles can show internal source text for translated sends, but only as an internal overlay.
- The current implementation derives viewing/draft language from the browser. A future improvement would be a persisted user- or location-level internal language setting.

## Related Docs

- [Conversation Management](./conversation-management.md)
- [AI Communication Policy](./ai-communication-policy.md)
- [AI Draft Feature](./ai-draft-feature.md)
