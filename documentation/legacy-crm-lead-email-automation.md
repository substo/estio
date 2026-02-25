# Legacy CRM Lead Email Automation

## Overview

This document covers the legacy CRM lead notification email automation used during migration from the old CRM to Estio.

Goal:
- Keep using the old CRM as the lead source temporarily
- Detect lead notification emails (for example Mailgun-routed notifications)
- Convert those emails into Estio leads/conversations using the existing "Paste Lead" import path
- Optionally auto-generate a first-contact draft

This feature is designed for transition periods where teams still receive leads in the old CRM but want processing, visibility, and automation inside Estio.

## What This Feature Does

When enabled for a location:
- Outlook-synced emails are checked against configured legacy CRM notifier sender(s)/domain(s)
- Matching lead notification emails are classified and parsed
- A message-level processing status record is stored
- Users can manually process or reprocess the email from the conversation UI
- Auto-processing can run in the background after email sync
- Optional auto-draft creates a first outreach draft using the existing AI draft pipeline

## Where It Is Configured

Admin page:
- `/admin/settings/crm`

Settings added (location-level):
- `Enable legacy CRM lead email detection`
- `Sender Email(s)` (one per line)
- `Sender Domain(s) (Optional)` (one per line; useful for Mailgun relay domains like `mg.downtowncyprus.com`)
- `Subject Pattern(s)` (one per line)
- `Pin notifier conversation to top`
- `Auto-process matching emails`
- `Auto-draft first contact after processing`

Default examples in UI:
- Sender: `info@downtowncyprus.com`
- Sender domain: `mg.downtowncyprus.com`
- Subjects:
  - `You have been assigned a new lead!`
  - `You need to follow up on a lead!`

## Expected Email Structure (Legacy CRM Notifications)

The parser is deterministic and expects the email body to contain:
- `Lead Overview`

Then labeled fields (order can vary, missing fields allowed):
- `Name`
- `Tel`
- `Email`
- `Goal`
- `Source`
- `Follow Up`
- `Next Action`
- `Notes`

Classification:
- `new_lead` if subject matches the "assigned new lead" pattern
- `follow_up` if subject contains "follow up on a lead"

Minimum identity requirement for processing:
- At least one of `Name`, `Tel`, or `Email` must be extractable

## Detection Rules (How an Email Is Considered a Legacy CRM Lead Notification)

An email must pass all of these checks:
1. Subject matches configured subject patterns (case-insensitive contains match)
2. Body contains `Lead Overview`
3. Sender matches configured sender email(s) or sender domain(s)

Sender match modes used internally:
- `exact`
- `domain`
- `unconfigured`
- `none`

If any required check fails, the email is stored as `ignored` (when processing is attempted) with a reason.

## End-to-End Processing Flow

### 1. Email Ingestion (Outlook Sync)

Outlook sync (OWA and Graph):
- Saves the email as a `Message`
- Persists `emailMessageId`
- Sets `source` (`OUTLOOK_OWA_SYNC` or `OUTLOOK_GRAPH_SYNC`)
- Updates conversation `lastMessage*` summary fields

After save/upsert, sync schedules legacy CRM lead auto-processing (if enabled).

### 2. Classification + Parsing

Processing logic:
- Loads location legacy CRM settings
- Loads the email message (`Message`) by internal `messageId` or `emailMessageId`
- Parses subject/sender/body
- Extracts:
  - classification (`new_lead` / `follow_up`)
  - sender
  - old CRM lead URL (if present)
  - old CRM lead ID (if derivable from URL)
  - structured fields (`Name`, `Tel`, etc.)

### 3. Reuse Existing Lead Import Path ("Paste Lead" path)

The feature intentionally reuses the existing parsed lead creation flow rather than creating a separate pipeline.

It calls:
- `createParsedLead(...)`

This gives the same core behavior as paste import:
- contact find-or-create/update
- conversation create/reuse
- property reference matching from notes/body text
- internal note / inbound message creation
- normal conversation records and downstream UI behavior

### 4. Contact Enrichment After Import

After a successful import, the processor patches lead-specific contact fields when available:
- `leadGoal`
- `leadSource`
- `leadNextAction`
- `leadFollowUpDate` (parsed from `Follow Up`)

### 5. Optional Auto-Draft (First Contact)

If enabled:
- `Auto-draft first contact after processing`

The system attempts to generate a proactive first-contact draft using the existing `generateDraft(...)` path.

Important behavior:
- Skips if the conversation already has outbound messages (unless force reprocess)
- Stores result metadata in the processing record
- Uses normal draft generation infrastructure so it appears in the usual AI draft/agent execution flow

## Manual Processing in Conversation UI

Email messages can show an "Old CRM" processing badge/status when they are:
- already processed/tracked, or
- detected as a matching legacy CRM email (Outlook-synced email + detection enabled)

Available actions in the message bubble:
- `Process Lead`
- `Reprocess`
- `Open Lead` (Estio contact page)
- `Old CRM` (external old CRM lead URL, if extracted)

Status labels shown in UI:
- `Pending`
- `Processing`
- `Processed`
- `Failed`
- `Ignored`

## Processing Status Storage (Database)

Model:
- `LegacyCrmLeadEmailProcessing`

Purpose:
- idempotency
- audit trail
- parser output storage
- error tracking
- UI status rendering

Key fields:
- `messageId` (unique)
- `locationId`
- `status` (`pending`, `processing`, `processed`, `failed`, `ignored`, `duplicate`)
- `classification`
- `legacyLeadUrl`
- `legacyLeadId`
- `extracted` (JSON, parser/detection metadata)
- `parsedLeadPayload` (JSON)
- `processResult` (JSON)
- `processedContactId`
- `processedConversationId`
- `attempts`
- `processedAt`
- `error`

## Auto-Processing Queue (BullMQ + Redis)

Queue module:
- `lib/queue/legacy-crm-lead-email.ts`

Behavior:
- Tries to enqueue a BullMQ job (`legacy-crm-lead-email`)
- Job ID is deterministic: `locationId:messageId` (prevents duplicates at queue level)
- Worker calls the same processing helper as the manual button

If Redis/BullMQ is unavailable:
- Falls back to inline async processing (best-effort)
- Logs a warning, then runs processing directly

Queue settings (current implementation):
- retries with exponential backoff
- worker concurrency: `2`

## Pinning the Notifier Conversation

If `Pin notifier conversation to top` is enabled:
- Conversation list fetch reorders the notifier contact thread to the top when the contact email matches configured sender/domain rules

Current behavior (important):
- It reorders within the fetched conversation list window
- It does not currently fetch a separate pinned thread if it falls outside the normal query window (unless the conversation is already selected via deep-link)

## Idempotency and Reprocessing Rules

By default, processing skips if status is already:
- `processing`
- `processed`

`Reprocess` forces processing and can:
- re-run parsing/import
- retry after failure/ignored
- re-attempt auto-draft (subject to outbound-message guard unless forced)

## Operational Requirements

### Required for Feature Use

- Outlook email sync configured and running (OWA and/or Graph)
- Legacy CRM notifier settings configured in `/admin/settings/crm`
- Database schema pushed and Prisma client generated (for the processing model/fields)

### Required for Queue-Backed Auto-Processing

- Redis reachable by app process
- Env vars (if non-default):
  - `REDIS_HOST`
  - `REDIS_PORT`

If Redis is not available, auto-processing still attempts inline fallback.

## Troubleshooting

### Prisma CLI not seeing DB env vars

Prisma CLI loads:
- `.env`

It does not automatically prefer:
- `.env.local`

If `prisma migrate` / `prisma db push` fails with missing `DATABASE_URL` / `DIRECT_URL`, ensure the values exist in `.env`.

### Supabase `DIRECT_URL` connectivity (`P1001`)

In this project environment, the direct host (`db.<project>.supabase.co:5432`) may be unreachable.

Working pattern used:
- `DATABASE_URL` -> Supabase pooler `:6543` (`pgbouncer=true`)
- `DIRECT_URL` -> Supabase pooler host `:5432` (session mode)
- add `sslmode=require`

### Auto-processing not triggering

Check:
1. `Enable legacy CRM lead email detection` is ON
2. `Auto-process matching emails` is ON
3. Email source is Outlook sync (`OUTLOOK_*`)
4. Sender/domain and subject patterns actually match
5. Email body contains `Lead Overview`
6. Message is saved as `type` email

### Badge does not show on an email

Badge is shown when:
- a processing record exists, or
- detection is enabled and the email is Outlook-synced and matches parser detection rules

Non-Outlook emails are intentionally not auto-badged unless already processed.

## Recommended Setup (Transition Period)

1. Enable legacy CRM lead email detection
2. Configure exact sender email and Mailgun sender domain
3. Keep subject patterns broad but specific (case-insensitive partial match)
4. Enable pinning for the notifier thread
5. Start with manual `Process Lead` validation on a few emails
6. Enable auto-process after confirming parsing quality
7. Enable auto-draft only after reviewing generated drafts on real samples

## Key Code References

- CRM settings UI: `app/(main)/admin/settings/crm/page.tsx`
- CRM settings actions: `app/(main)/admin/settings/crm/actions.ts`
- Parser + processing actions: `app/(main)/admin/conversations/actions.ts`
- Message bubble UI badges/actions: `app/(main)/admin/conversations/_components/message-bubble.tsx`
- Auto-process queue: `lib/queue/legacy-crm-lead-email.ts`
- Outlook OWA sync trigger: `lib/microsoft/owa-email-sync.ts`
- Outlook Graph sync trigger: `lib/microsoft/outlook-sync.ts`
- Prisma models: `prisma/schema.prisma`

## Known Limitations / Future Improvements

- Notifier/system mailbox contacts may still appear as normal lead contacts unless additionally tagged/badged at contact level
- Pinning currently only reorders within the fetched conversation window
- Parsing is designed for the current legacy CRM email format; template changes in the old CRM may require parser updates
