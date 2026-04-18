# Fire-and-Forget Sync Pattern
**Last Updated:** 2026-04-18

## Purpose

This document defines Estio's **mandatory pattern** for handling external provider synchronization (GoHighLevel, Google Contacts, Google Tasks, etc.) in user-facing server actions.

All user-facing mutations **MUST** return immediately after the local database write. External sync work runs in the background and must **never block** the HTTP response.

> [!IMPORTANT]
> This is the standard for enterprise SaaS development. Every new server action that touches an external provider **must** follow this pattern. No exceptions for user-facing flows.

## Industry Context

### Why enterprise SaaS products separate writes from syncs

1. **Responsiveness is non-negotiable.** Users expect sub-200ms response times for CRUD operations. External API calls (GHL search, Google People API push, WhatsApp delivery) routinely take 200-2000ms each. Chaining them before responding makes the UI feel broken.

2. **External APIs are unreliable.** Third-party services experience downtime, rate limits, and latency spikes. A user should never be told "Failed to save" because Google's API had a hiccup — the data is safely in our database.

3. **Resilience through decoupling.** If an external provider goes down, the local system continues operating normally. Sync catches up when the provider recovers.

4. **Auditability.** Separating the write from the sync makes it trivial to log, retry, and debug sync failures independently.

### Industry examples
- **Salesforce:** Local record saves are instant; sync to connected apps happens via Change Data Capture events.
- **HubSpot:** CRM writes are immediate; workflow actions (email sends, external API calls) are queued.
- **Linear:** Issues save instantly; integrations sync asynchronously through webhooks and polling.

## Pattern Tiers

Estio uses two tiers of fire-and-forget, depending on the criticality of the sync:

### Tier 1: Durable Outbox (highest reliability)

Used when sync **must eventually succeed** and failures need automated retry with dead-letter visibility.

**Components:**
- Outbox table (e.g., `ContactTaskOutbox`, `WhatsAppOutboundOutbox`)
- Cron worker that drains the queue (e.g., `/api/cron/task-sync`)
- `syncVersion` for idempotency and stale-job supersession

**Current usage:**
- ✅ Task sync-out (`ContactTaskOutbox` → GHL + Google Tasks)
- ✅ WhatsApp outbound messages (`WhatsAppOutboundOutbox`)

**Code pattern:**
```ts
// After DB write
void Promise.allSettled([
  enqueueTaskSyncJobs({ taskId: task.id, operation: 'create' }),
  rebuildTaskReminderJobs(task.id),
]).catch((err) => console.error('[task-sync] background enqueue error:', err));

return { success: true, task };
```

### Tier 2: Simple Fire-and-Forget (good enough for most cases)

Used when sync is **best-effort** and manual retry (re-saving the form) is an acceptable fallback.

**Components:**
- `void Promise.allSettled([...]).catch(...)` or `void fn().catch(...)`
- No outbox table, no cron worker
- Errors are logged but don't affect the user

**Current usage:**
- ✅ Contact create/update → GHL sync
- ✅ Contact create/update → Google auto-sync
- ✅ Property save → embedding update
- ✅ New conversation → Google auto-sync (via `runDetachedTask`)

**Code pattern:**
```ts
// After DB write — return immediately
void Promise.allSettled([
  // 1. Sync to GoHighLevel
  (async () => {
    try {
      const location = await db.location.findUnique({ ... });
      if (location?.ghlAccessToken && location?.ghlLocationId) {
        const ghlId = await syncContactToGHL(location.ghlLocationId, { ... }, existingGhlContactId);
        if (ghlId && !existingGhlContactId) {
          await db.contact.update({ where: { id }, data: { ghlContactId: ghlId } });
        }
      }
    } catch (err) {
      console.error('[updateContact] GHL Sync Failed:', err);
    }
  })(),
  // 2. Google auto-sync
  runGoogleAutoSyncForContact({ ... }),
]).catch(err => console.error('[updateContact] background sync error:', err));

return { success: true, message: 'Contact updated successfully.' };
```

## When to Use Which Tier

| Criteria | Tier 1 (Durable Outbox) | Tier 2 (Simple Fire-and-Forget) |
|---|---|---|
| Business impact of sync failure | High (e.g., message never delivered) | Low (e.g., GHL contact slightly stale) |
| User can manually retry | No | Yes (re-save the form) |
| Needs automated retry/backoff | Yes | No |
| Needs dead-letter visibility | Yes | No |
| Needs `syncVersion` idempotency | Yes | No |
| Schema overhead | Outbox table + cron route | None |

## Implementation Checklist for New Server Actions

When writing a new server action that touches an external provider:

1. **Write to local DB first** — this is the source of truth
2. **Return success to the client immediately** after the DB write
3. **Wrap all external calls** in `void Promise.allSettled([...]).catch(...)` or `void fn().catch(...)`
4. **Log errors** inside each background job — never swallow silently
5. **Pass known provider IDs** (e.g., `ghlContactId`) to skip redundant search API calls
6. **Never `await`** an external sync call in the return path of a user-facing action

### Anti-patterns (DO NOT do this)

```ts
// ❌ WRONG — blocks the response
const ghlId = await syncContactToGHL(locationId, { name, email, phone });
await runGoogleAutoSyncForContact({ ... });
return { success: true };

// ❌ WRONG — swallows errors silently
void syncContactToGHL(locationId, { ... });

// ❌ WRONG — .then() without .catch() creates unhandled rejection
syncContactToGHL(locationId, { ... }).then(id => { ... });
```

### Correct patterns

```ts
// ✅ CORRECT — fire-and-forget with error logging
void Promise.allSettled([
  syncContactToGHL(locationId, { ... }),
  runGoogleAutoSyncForContact({ ... }),
]).catch(err => console.error('background sync error:', err));

return { success: true };

// ✅ ALSO CORRECT — single async job
void runGoogleAutoSyncForContact({ ... })
  .catch(err => console.error('Google sync error:', err));

return { success: true };
```

## Codebase Compliance Audit (2026-04-18)

### ✅ Compliant (fire-and-forget)

| File | Context | Pattern |
|---|---|---|
| `tasks/actions.ts` | All 4 mutation actions (create, update, complete, delete) | `void Promise.allSettled([enqueueTaskSyncJobs(), rebuildTaskReminderJobs()])` |
| `contacts/actions.ts` | `createContact` → GHL sync | `.then().catch()` (fire-and-forget) |
| `contacts/actions.ts` | `createContact` → Google sync | `void fn().catch()` |
| `contacts/actions.ts` | `updateContactCore` → GHL + Google sync | `void Promise.allSettled([...]).catch()` |
| `conversations/actions.ts` | New conversation → Google auto-sync | `runDetachedTask(...)` wrapper |
| `conversations/actions.ts` | Paste lead → Google auto-sync | `runDetachedTask(...)` wrapper |
| `properties/actions.ts` | Property save → embedding update | `fn().catch()` (fire-and-forget) |
| `properties/actions.ts` | `upsertContactRole` → GHL sync | `void (async () => { ... })()` |
| `properties/actions.ts` | `upsertCompanyRole` → GHL sync | `void (async () => { ... })()` |
| `app/actions/subscription.ts` | `subscribe` → GHL sync | `void (async () => { ... })()` |

### ⚠️ Acceptable (blocking but in non-user-facing or intentional contexts)

| File | Context | Reason |
|---|---|---|
| `contacts/actions.ts` | `resolveGoogleSyncConflictAction` (line 1513) | **Intentional** — user explicitly clicked "Overwrite Google". The sync result IS the response. |
| `contacts/actions.ts` | `autoHealBrokenGoogleLink` (line 2409) | **Background repair** — called from page load, already has `.catch()`, and revalidates after. Acceptable since it's not blocking a form submit. |
| `lib/google/automation.ts` | `runGoogleAutoSyncForContact` internals | **Library code** — `await` inside the function is correct because callers control whether to await or fire-and-forget. |
| `lib/ai/tools.ts` | `createViewing` → GHL contact sync (line 918) | **AI tool execution** — runs inside an AI agent session where the GHL contact ID is needed for the immediate subsequent `createAppointment` call. The sync result feeds into the next step. |
| `app/api/google/sync/route.ts` | Manual sync endpoint | **Intentional** — user explicitly triggered sync from settings UI. |

### ⚠️ Should Migrate (blocking in user-facing form actions)

**None remaining.** All user-facing actions are now compliant as of 2026-04-18.

## Key Files

### Pattern implementations
- [`app/(main)/admin/tasks/actions.ts`](/Users/martingreen/Projects/IDX/app/(main)/admin/tasks/actions.ts) — Gold standard Tier 1 reference
- [`app/(main)/admin/contacts/actions.ts`](/Users/martingreen/Projects/IDX/app/(main)/admin/contacts/actions.ts) — Tier 2 reference (createContact, updateContactCore)

### Sync infrastructure
- [`lib/tasks/sync-engine.ts`](/Users/martingreen/Projects/IDX/lib/tasks/sync-engine.ts) — Outbox enqueue + worker drain
- [`lib/ghl/stakeholders.ts`](/Users/martingreen/Projects/IDX/lib/ghl/stakeholders.ts) — GHL contact/company sync
- [`lib/google/automation.ts`](/Users/martingreen/Projects/IDX/lib/google/automation.ts) — Google auto-sync orchestrator

### Related documentation
- [`tasks-implementation-reference.md`](/Users/martingreen/Projects/IDX/documentation/tasks-implementation-reference.md) — Task outbox pattern details
- [`whatsapp-integration.md`](/Users/martingreen/Projects/IDX/documentation/whatsapp-integration.md) — WhatsApp outbound outbox
- [`conversations-speed-architecture-and-roadmap.md`](/Users/martingreen/Projects/IDX/documentation/conversations-speed-architecture-and-roadmap.md) — Conversation speed optimizations
