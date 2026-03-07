# Conversation Management & Deletion Features
**Last Updated:** 2026-03-07

## Overview
This document outlines the architecture and logic for managing conversation lifecycles, including **Soft Deletion**, **Archiving**, **Trash**, and **live inbox/unread state behavior** introduced in Feb 2026.

## Data Model Changes
We updated the `Conversation` model in `prisma/schema.prisma` to support these features without losing data:

```prisma
model Conversation {
  // ... existing fields ...
  deletedAt     DateTime?   @db.Timestamptz(6)  // If set, conversation is in Trash
  archivedAt    DateTime?   @db.Timestamptz(6)  // If set, conversation is Archived
  deletedBy     String?     // ID of user who deleted it (audit trail)
  
  @@index([deletedAt])
  @@index([archivedAt])
}
```

## Feature Logic

### 1. View Filters
The Conversation List (`/admin/conversations`) now supports three distinct views:
- **Inbox** (`active`): Shows conversations where `deletedAt` is NULL and `archivedAt` is NULL.
- **Archived** (`archived`): Shows conversations where `archivedAt` is SET and `deletedAt` is NULL.
- **Trash** (`trash`): Shows conversations where `deletedAt` is SET (regardless of archive status).

### 1.1 Conversation List Pagination & Infinite Scroll
The Conversations list (`/admin/conversations`) is now **cursor-paginated** and loaded incrementally instead of being hard-capped to a single 50-row fetch.

- **Page Size**: Default `50` conversations per page (configurable server-side, capped to prevent heavy requests).
- **Pagination Strategy**: **Keyset/Cursor Pagination** ordered by:
  1. `lastMessageAt DESC`
  2. `id DESC` (tie-breaker for stable ordering)
- **Why**: Prevents performance degradation from loading all conversations at once and avoids duplicate/missing rows that are common with offset paging on actively changing inboxes.
- **UI Loading**: The left conversation panel uses **infinite scroll** (IntersectionObserver) and a manual **Load more** fallback button.
- **Deep Links**: If a URL-selected conversation (`?id=...`) is outside the current page window, the server injects it into the initial payload so the center/right panels can still render.

### 1.2 Live Inbox Refresh, Reordering, and Unread State
The inbox now updates on-page without requiring a manual refresh:

- **Live Polling (Inbox only)**: In `view=active` + chats mode, the client polls `fetchConversations('active', activeId)` on a short interval.
- **Live Reordering**: Incoming rows are merged **incoming-first** so conversations with newer `lastMessageAt` naturally move to the top immediately.
- **Unread Badges**: Each row displays `Conversation.unreadCount` as a compact badge (`99+` cap).
- **Read Reset on Open Thread**: Opening a thread (and live-refreshing an already open thread) calls `markConversationAsRead(conversationId)` to reset unread count to `0`.
- **Active Thread Live Refresh**: If the selected conversation’s `lastMessageDate` or `lastMessageBody` changes during polling, messages are re-fetched silently.
- **Auto-scroll**: ChatWindow auto-scrolls to the bottom whenever the message array changes, so fresh inbound messages are visible immediately when viewing that thread.

### 2. Formatting & Actions

#### Soft Delete (Move to Trash)
- **Action**: Sets `deletedAt` to current timestamp.
- **Behavior**: Item disappears from Inbox/Archive and appears in Trash.
- **Recoverability**: Fully recoverable via "Restore".
- **UI**: Shows an "Undo" toast notification immediately after deletion.

#### Archive
- **Action**: Sets `archivedAt` to current timestamp.
- **Behavior**: Item moves to "Archived" view. Does NOT count as deleted.
- **Use Case**: Cleaning up inbox without deleting history.

#### Restore
- **Action**: Resets `deletedAt` (and optionally `archivedAt`) to `NULL`.
- **Behavior**: Item reappears in Inbox.

#### Permanent Delete
- **Action**: `DELETE FROM "Conversation" WHERE id = ...` (Hard Delete).
- **Trigger**: 
  1. User periodically deletes items *already in Trash*.
  2. "Empty Trash" action.
  3. Auto-Purge Cron Job.
- **Safety**: Requires explicit confirmation in UI.

## Automated Cleanup (Cron)
To prevent the database from growing indefinitely, a background job automatically cleans up old trash.

- **Frequency**: Daily (at 00:00 UTC).
- **Rule**: Permanently deletes any conversation where `deletedAt` is older than **30 days**.
- **Endpoint**: `/api/cron/purge-trash`
- **Security**: Protected by `CRON_SECRET`.

### Configuration
Ensure `CRON_SECRET` is set in your `.env` and Vercel project settings.

```json
// vercel.json
{
  "crons": [
    {
      "path": "/api/cron/purge-trash",
      "schedule": "0 0 * * *"
    }
  ]
}
```

## API Actions (`actions.ts`)

| Function | Purpose |
| :--- | :--- |
| `fetchConversations(status, selectedConversationId?, options?)` | Fetches a paginated list based on filter (`active`, `archived`, `trash`, `all`) and returns `hasMore` / `nextCursor` for infinite scroll. |
| `deleteConversations(ids)` | Performs **Soft Delete** (sets `deletedAt`). |
| `permanentlyDeleteConversations(ids)` | Performs **Hard Delete** (removes record). |
| `restoreConversations(ids)` | Resets `deletedAt` to NULL. |
| `archiveConversations(ids)` | Sets `archivedAt`. |
| `emptyTrash()` | Permanently deletes all soft-deleted items > 30 days old (manual trigger). |
| `markConversationAsRead(conversationId)` | Resets `unreadCount` to `0` for the selected conversation (location-scoped security check). |
| `getSmsChannelEligibility(conversationId)` | Returns SMS send eligibility (`eligible`/`ineligible`/`unknown`) based on contact phone validity + GHL location SMS/phone-system readiness. |
| `getWhatsAppChannelEligibility(conversationId)` | Returns WhatsApp send eligibility based on contact phone validity + Evolution checks. |

## UI Implementation
- **View Filters**: `ConversationList` header uses icon buttons (Inbox, Archive, Trash) with a hoverable dropdown for quick switching.
- **Selection Mode**: Allows bulk actions (Archive, Delete, Restore) with a "Cancel" button aligned next to actions.
- **Safety**: "Delete Forever" dialog only appears when deleting items from the Trash view.
- **URL Synchronization**: View state (`active`, `archived`, `trash`) is synced to the URL (`?view=...`), allowing for bookmarking and sharing of specific lists.
- **Infinite Scroll**: The left list auto-loads more conversations near the bottom using a sentinel + `IntersectionObserver`, with a visible "Load more" fallback.
- **Deep-Link Stability**: URL-selected conversations are preserved during list refreshes and view changes, preventing the center panel from dropping back to "Select a conversation" when the selected item is older than the first page.
- **Live Inbox Reordering**: Inbox updates are merged with incoming-first ordering so newly active conversations move to top in real time.
- **Unread Badges**: List rows show unread counts from `Conversation.unreadCount`.
- **Auto Read Reset**: Selecting a conversation marks it read and clears the badge.
- **Active Thread Live Updates**: While a thread is open, metadata changes trigger silent message refresh; ChatWindow auto-scroll keeps the latest message visible.
- **Shared Composer Source of Truth**: Both chats mode and deal mode now render the same reusable composer component (`conversation-composer.tsx`). Composer behavior changes should be implemented once and will apply to `ChatWindow` and `UnifiedTimeline`.
- **Channel Guards**: The shared composer channel picker disables ineligible channels with a reason tooltip. SMS is blocked when phone is invalid/masked or GHL SMS is not configured; WhatsApp is blocked when eligibility checks fail.
- **AI Draft Model Picker**: The shared composer loads its model list via `getAiDraftModelPickerStateAction()` and keeps AI Draft plus selection workflows aligned on the same chosen model.
- **WhatsApp Media Composer**: In any WhatsApp-eligible reply context, the shared composer supports media upload (`image/*`, `audio/*`, and various document types like PDF/CSV) and in-app voice-note recording (`MediaRecorder`). Media is sent through the private R2 -> Evolution `sendMedia` flow and rendered inline (image preview, audio player, or document download link) from signed attachment URLs.
- **WhatsApp Media Recovery**: Message bubbles now expose `Re-fetch Media` for WhatsApp media messages/placeholders to recover missing or stale attachment storage. Source-of-truth details: [`whatsapp-integration.md`](whatsapp-integration.md#61-media-re-fetch-recovery-mar-2026).
- **Source of Truth (Selection Workflow)**: This document is the canonical reference for chat text-selection behavior, batch summarize/custom flow, and CRM-log save semantics.
- **Selection Actions**: Message/email text selection in the chat panel now opens a floating action toolbar with:
  - `Paste Lead` for AI-assisted structured lead import.
  - `Add` to queue the current snippet into a multi-message summary/custom batch.
  - `Find Contact` for phone/email/full-name lookup.
  - `Summarize` to generate and save a CRM log note into contact history.
  - `Custom` to run a user-provided prompt against selected text and optionally save the output to CRM log.
- **Cross-Message Selection (Phase 1 Quick Win)**: Drag-selection can span multiple message bubbles/email blocks in the visible chat window; the toolbar accepts the combined selection text.
- **Batch Selection Flow (Phase 2)**:
  - The batch is conversation-scoped and dedupes repeated snippet adds from the same message/selection hash.
  - Chat header exposes `Summarize Batch (N)` plus a clear button for quick logging without opening each message.
  - `Summarize` and `Custom` dialogs switch into batch mode when snippets are queued, show a queued-snippets list, and allow per-item remove/clear.
- **Selection Model Consistency**: `Paste Lead`/`Summarize`/`Custom` use the currently selected AI model from the chat toolbar, keeping tone/behavior consistent with AI Draft.
- **CRM Log Save Format**: Selection-based CRM log entries are saved as `MANUAL_ENTRY` in `ContactHistory` using format `DD.MM.YY FirstName: summary`.
- **CRM Log Dedupe Guard**: Before writing `MANUAL_ENTRY` for `Summarize` or `Custom`, the system checks the latest 30 manual entries for likely duplicates (exact/contains/high token overlap). Duplicate entries are skipped and the existing entry is returned.
- **Selection Observability**:
  - `Summarize` and `Custom` persist `AgentExecution` records (usage, model, cost estimate, request/response snapshots) and increment conversation token/cost totals.
  - `Paste Lead` persists `Analyze Lead Text` trace metadata when the user confirms import.
  - `Find Contact` is non-AI and does not produce AI usage/trace entries.

## Deal Mode Reply Routing
This document is also the source of truth for reply-target behavior in `/admin/conversations?mode=deals`.

### Participant Hydration
- Deal mode no longer relies on the paginated left chat list to infer participants.
- `getDealContext(id)` returns deal conversation summaries in the same client shape used by the messaging UI:
  - `id`
  - `contactId`
  - `contactName`
  - `contactPhone`
  - `contactEmail`
  - `status`
  - `type`
  - `lastMessageType`
  - `lastMessageDate`
  - `lastMessageBody`
  - `unreadCount`
  - `locationId`
- The client hydrates the full participant set for the selected deal, even when some participant conversations are outside the currently loaded chat page.

### Deal Contacts Selector
- Mission Control now renders a **Deal Contacts** section in deal mode.
- The list is unique by contact, not by conversation row.
- If one contact has multiple conversations inside the same deal, the UI chooses the newest conversation by `lastMessageDate` as the reply target for that contact.
- The selected contact drives:
  - the right-panel details/tasks/viewings/activity context
  - Mission Control draft approval target
  - the center-panel composer reply target

### Deterministic Selection Rules
- If URL `?id=` belongs to a conversation inside the active deal, that participant becomes the selected reply target.
- Otherwise, the previous in-memory selection is preserved if it is still valid for the deal.
- Otherwise, the newest participant conversation in the deal is selected.

### Center Panel Behavior In Deal Mode
- Deal mode keeps the **Unified Timeline** in the center panel.
- The shared composer is rendered below the unified timeline, not replaced by a single-thread `ChatWindow`.
- The composer shows `Replying to {contact}` for the currently selected participant.
- If no valid participant is available yet, the composer is disabled and shows explicit helper text instead of silently disappearing.

### Send Routing Rules
- Outbound send handlers accept an explicit target conversation rather than assuming the currently active chats-mode thread.
- Text sends, WhatsApp media sends, and Mission Control draft approvals all route to the currently selected deal participant conversation.
- Mission Control draft approval derives channel from `getMessageType(selectedConversation)` instead of hardcoding Email.

## Initiating Conversations
The `New Conversation` flow acts as a unified entry point to establish threads with local contacts or entirely new leads via external systems.
- **Google Contacts**: The system integrates the Global **Google Contact Import** tool (see [Google Contact Sync](./google-contact-sync.md#4-global-contact-import)), allowing users to look up their Google directory, import a contact, and start a message instantly.

## WhatsApp Import
We support importing `.txt` chat exports from WhatsApp directly into a specific conversation.

### Flow
1. **Trigger**: User clicks "Import WhatsApp" (upload icon) in the conversation header.
2. **Modal**: A dialog (`WhatsAppImportModal`) opens.
3. **Upload**: User drags & drops the exported `.txt` file.
4. **Parse & Map**: System parses messages and identifies authors. User selects "This is me" to correctly assign outbound messages.
5. **Import**: Messages are inserted into the conversation, skipping duplicates.

### Backend Action
`executeDirectImport(conversationId, fileContent, ownerAuthor)`:
- Validates conversation and contact.
- Parses file using `import-parser.ts`.
- Inserts messages mapped to `ownerAuthor` (outbound) and others (inbound).
- Updates `lastMessageAt` for the conversation.
