# Conversation Management & Deletion Features
**Last Updated:** 2026-03-09

## Overview
This document is the source of truth for `/admin/conversations`, including conversation lifecycles, inbox state management, deal-mode reply routing, and the Mar 2026 performance rollout (`workspaceV2`, delta polling, ranked search, and supporting indexes/observability).

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

### Performance-Oriented Indexes (Mar 2026)
The conversations performance rollout also added list, delta, timeline, and search indexes:

- `Conversation(locationId, deletedAt, archivedAt, lastMessageAt DESC, id DESC)` for inbox/archive/trash list reads.
- `Conversation(locationId, updatedAt ASC, id ASC)` for delta-cursor polling.
- `Message(conversationId, updatedAt DESC)` for thread refreshes.
- `ContactHistory(contactId, createdAt DESC)` for workspace activity timelines.
- `ContactTask(conversationId, deletedAt, status, dueAt)` and `Viewing(contactId, date ASC)` for sidebar summaries.
- Trigram + full-text search indexes for ranked conversation search across contacts, last-message previews, message bodies, and transcripts.

SQL rollout helper: `prisma/sql/conversations-performance-indexes.sql`

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

### 1.2 Workspace V2 Snapshot Payload
When `workspaceV2` is enabled for the current location, the conversations page uses a server-composed snapshot/workspace model instead of separately stitching every panel from multiple client requests.

- **Initial List Snapshot**: `fetchConversations(...)` returns the paginated list plus `deltaCursor`.
- **Thread Workspace**: `getConversationWorkspace(...)` returns:
  - `conversationHeader`
  - `messages`
  - `activityTimeline`
  - `contactContext`
  - `taskSummary`
  - `viewingSummary`
  - `agentSummary`
  - `transcriptEligibility`
  - `freshness`
- **Read Path**: Workspace reads are location-scoped and use DB-first read-only auth helpers.
- **Caching**: When `workspaceV2` is on, list snapshots and workspace metadata use cache wrappers plus explicit invalidation on write paths.

### 1.2.1 Shared Timeline Event Pipeline (Mar 2026)
Timeline rendering and AI draft context now share one normalized assembler service.

- **Normalized event kinds**:
  - `message`
  - `activity`
- **Supported activity coverage**:
  - notes / manual CRM entries
  - existing contact-history activity that should appear in timeline context
  - canonical viewing events
  - derived task state events
- **Task visibility rule**:
  - show only `TASK_OPEN` for active tasks
  - show only `TASK_DONE` for completed tasks
  - do not surface task update/delete noise in the timeline
- **Scope rules**:
  - chats mode timeline = selected conversation + related contact activity scope
  - deal mode timeline = merged deal-aware participant timeline

This shared event model is also the source used by AI Draft context assembly. For prompt compaction details, see [ai-draft-feature.md](/Users/martingreen/Projects/IDX/documentation/ai-draft-feature.md).

### 1.3 Live Inbox Refresh, Reordering, and Unread State
The inbox updates on-page without requiring a manual refresh:

- **Delta Polling**: In workspace v2, the client polls `getConversationListDelta(viewFilter, deltaCursor, activeId)` instead of refetching the whole list.
- **Legacy Fallback**: If `workspaceV2` is disabled, the client falls back to full-list polling via `fetchConversations(...)`.
- **Live Reordering**: Incoming rows are merged **incoming-first** so conversations with newer `lastMessageAt` naturally move to the top immediately.
- **Unread Badges**: Each row displays `Conversation.unreadCount` as a compact badge (`99+` cap).
- **Read Reset on Open Thread**: Opening a thread (and live-refreshing an already open thread) calls `markConversationAsRead(conversationId)` to reset unread count to `0`.
- **Active Thread Refresh**:
  - legacy mode refreshes messages when selected-thread metadata changes
  - workspace v2 refreshes the whole workspace on a slower balanced interval
  - stale WhatsApp threads can trigger `refreshConversationOnDemand(conversationId, "full_sync")` in the background, throttled per conversation
- **Thread Scroll Behavior**: When opening a conversation, ChatWindow snaps directly to the latest message on first paint. While viewing a thread, new messages only auto-scroll when the user is already near the bottom; if the user has scrolled up to read history, the current scroll position is preserved.
- **Visibility/Search Guards**: Background polling pauses when the tab is hidden or when a search query is active.

### 1.4 Feature Flags
The rollout is controlled by `lib/feature-flags.ts` per location.

Supported flags:

- `workspaceV2`
- `balancedPolling`
- `lazySidebarData`

Supported env values per flag:

- `on`
- `off`
- `canary`

Canary mode enables the flag only for location IDs listed in `CONVERSATIONS_CANARY_LOCATIONS` (or the legacy alias env keys handled in code).

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
| `getConversationWorkspace(conversationId, options?)` | Returns the unified thread workspace payload for the center/right panels. |
| `getConversationListDelta(status, sinceCursor?, activeConversationId?, options?)` | Returns changed conversation rows since the last `deltaCursor`. |
| `refreshConversationOnDemand(conversationId, mode)` | Refreshes metadata only or runs a full WhatsApp history sync for stale threads. |
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
- **Workspace V2 Panel Loading**: When enabled, the center/right panel is hydrated from a single workspace response instead of multiple unrelated round trips.
- **Lazy Sidebar Data**: Tasks/viewings/contact context cards can defer secondary work behind the workspace feature flag instead of forcing eager list-time hydration.
- **Timeline Parity**: The activity timeline and AI Draft prompt now use the same normalized event feed, so notes, viewing events, and task state entries are aligned between what the agent sees and what AI reads.
- **Unread Badges**: List rows show unread counts from `Conversation.unreadCount`.
- **Auto Read Reset**: Selecting a conversation marks it read and clears the badge.
- **Active Thread Live Updates**: While a thread is open, metadata changes trigger silent message refresh. The UI keeps the latest message visible only when the agent is already following the live edge; otherwise it preserves the current reading position.
- **Mobile-First Navigation (Mar 2026)**:
  - On mobile viewports (`<1024px`), the conversations list occupies the full page by default.
  - Selecting a conversation/deal transitions to a full-screen thread/timeline pane.
  - The thread header exposes an explicit **Back** action to return to the full-screen list.
  - Mission Control is opened separately via a dedicated header button and rendered in a right-side sheet.
  - Desktop (`>=1024px`) retains the resizable tri-panel layout.
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
  - `Suggest Viewing` to open the AI viewing suggestion dialog from selected text.
  - `Summarize` to generate and save a CRM log note into contact history.
  - `Custom` to run a user-provided prompt against selected text and optionally save the output to CRM log.
- **Viewing Suggestion Reference**: Relative-date anchoring, exact property auto-match, and timezone-safe `scheduledAtIso` apply behavior are documented in [viewing-creation-architecture.md](/Users/martingreen/Projects/IDX/documentation/viewing-creation-architecture.md).
- **Cross-Message Selection (Phase 1 Quick Win)**: Drag-selection can span multiple message bubbles/email blocks in the visible chat window; the toolbar accepts the combined selection text.
- **Batch Selection Flow (Phase 2)**:
  - The batch is conversation-scoped and dedupes repeated snippet adds from the same message/selection hash.
  - Chat header exposes `Summarize Batch (N)` plus a clear button for quick logging without opening each message.
  - `Summarize` and `Custom` dialogs switch into batch mode when snippets are queued, show a queued-snippets list, and allow per-item remove/clear.
- **Selection Model Consistency**: `Paste Lead`/`Suggest Viewing`/`Summarize`/`Custom` use the currently selected AI model from the chat toolbar, keeping tone/behavior consistent with AI Draft.
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

### Unified Timeline Event Coverage
- The deal unified timeline now renders both `message` and `activity` events in chronological order.
- Activity coverage includes:
  - notes / CRM manual entries
  - canonical viewing events
  - current-state task events (`TASK_OPEN`, `TASK_DONE`)
- This replaces the earlier messages-only behavior, so the center timeline now matches the broader deal context used for AI reasoning.

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

## Ranked Search (Mar 2026)
Conversation search now prefers a SQL-ranked search path over the older Prisma-only substring scan.

- **Primary path**: raw SQL with `plainto_tsquery`, `ts_rank_cd`, and `pg_trgm` similarity.
- **Search corpus**:
  - contact identity fields
  - `Conversation.lastMessageBody`
  - `Message.body`
  - `MessageTranscript.text`
- **Result shaping**:
  - rows are ranked first, then fetched as full conversation records
  - active deal metadata is reattached before returning UI rows
- **Fallback**: if the raw SQL path fails, the action falls back to a Prisma substring search path.

## Observability & Perf Tooling (Mar 2026)
- `lib/observability/performance.ts` provides `createTraceId()` and `withServerTiming(...)` wrappers for list, workspace, delta, and search actions.
- Client-side request counters log `[perf:conversations.client_request]` events during list/workspace polling.
- DB/index verification script: `npm run perf:conversations:db`

## Related Docs
- High-level product/AI framing: [ai-agentic-conversations-hub.md](/Users/martingreen/Projects/IDX/documentation/ai-agentic-conversations-hub.md)
- Model picker / AI defaults: [ai-configuration.md](/Users/martingreen/Projects/IDX/documentation/ai-configuration.md)
- AI draft prompt construction and timeline compaction: [ai-draft-feature.md](/Users/martingreen/Projects/IDX/documentation/ai-draft-feature.md)
