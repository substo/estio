# Conversation Management & Deletion Features
**Last Updated:** 2026-02-25

## Overview
This document outlines the architecture and logic for managing conversation lifecycles, specifically focusing on **Soft Deletion**, **Archiving**, and the **Trash** system introduced in Feb 2026.

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

## UI Implementation
- **View Filters**: `ConversationList` header uses icon buttons (Inbox, Archive, Trash) with a hoverable dropdown for quick switching.
- **Selection Mode**: Allows bulk actions (Archive, Delete, Restore) with a "Cancel" button aligned next to actions.
- **Safety**: "Delete Forever" dialog only appears when deleting items from the Trash view.
- **URL Synchronization**: View state (`active`, `archived`, `trash`) is synced to the URL (`?view=...`), allowing for bookmarking and sharing of specific lists.
- **Infinite Scroll**: The left list auto-loads more conversations near the bottom using a sentinel + `IntersectionObserver`, with a visible "Load more" fallback.
- **Deep-Link Stability**: URL-selected conversations are preserved during list refreshes and view changes, preventing the center panel from dropping back to "Select a conversation" when the selected item is older than the first page.
- **Selection Actions**: Message/email text selection in the chat panel now opens a floating action toolbar (`Paste Lead`, `Find Contact`) for explicit lead import and contact lookup workflows.

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
