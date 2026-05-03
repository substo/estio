# Estio-First Conversation Architecture Progress

Last updated: 2026-05-02

## Goal

Make Estio the canonical system of record for conversations, messages, contacts, tasks, deals, AI context, realtime events, and notifications. External systems such as GHL, Google, Outlook, and Evolution should be optional provider integrations that mirror to/from Estio through explicit sync records and durable outboxes.

## Current Status

Status: **Core migration deployed; Gmail-native inbound queue wave implemented locally.**

The critical conversation path is now Estio-first:

- `Conversation.id` is the canonical ID used by new conversation flows and key UI/server paths.
- `Conversation.ghlConversationId` is nullable and treated as a legacy/provider alias.
- New local conversations no longer write fake GHL IDs such as `wa_*` into the conversation row.
- Legacy and provider IDs remain readable through resolver compatibility.
- Production Prisma migration history was repaired and the full canonical ID migration was applied.
- Deployment completed successfully on `clean-history` at commit `69fd163`.

## Completed

- Added provider sync foundations:
  - `ConversationSync`
  - `MessageSync`
  - `ProviderOutbox`
  - `DealConversationLink`
- Backfilled legacy conversation references into sync/link records.
- Added canonical conversation reference resolver for internal IDs, legacy aliases, and provider sync IDs.
- Migrated major conversation, task, deal, AI, import, contact, WhatsApp, GHL sync, and realtime paths toward internal conversation IDs.
- Added generic provider outbox worker infrastructure:
  - queue worker
  - cron route
  - retry/backoff
  - stale lock recovery
  - dead/disabled states
  - idempotency keys
- Wired WhatsApp outbound GHL mirroring through `ProviderOutbox` instead of direct blocking/fire-and-forget sync.
- Expanded provider-outbox operations for the next sync wave:
  - GHL `sync_contact`
  - GHL `mirror_conversation`
  - GHL `mirror_message` sync-row completion
  - Google `sync_contact`
  - Outlook intentionally disabled
- Refactored Gmail as a native Estio inbound provider:
  - Gmail webhooks enqueue sync work instead of awaiting full sync
  - Gmail cron queues sync/watch-renewal jobs
  - Gmail messages upsert Google `ConversationSync` and `MessageSync` aliases
  - Gmail-created conversations keep `ghlConversationId = null`
  - GHL email logging is queued through `ProviderOutbox` instead of called inline
- Added provider outbox cron script and installed production cron entry.
- Repaired production Prisma migration history for `20260423120000_legacy_crm_owner_identity`.
- Marked previously db-pushed migrations as applied where production schema already matched.
- Applied `20260502120000_full_estio_canonical_conversation_ids`.

## Verification Completed

- `npx prisma validate`
- `npx prisma generate`
- `npx tsx --test lib/integrations/provider-outbox.test.ts lib/google/gmail-sync-outbox.test.ts`
- `npx prisma migrate status --schema prisma/schema.prisma`
- Targeted tests: `19/19` passing
- Local production build: `npm run build`
- Blue/green deploy with post-switch soak checks
- Production cron install includes `cron-provider-outbox.sh`

Notes:

- `next lint` is not usable non-interactively because Next prompts for ESLint setup.
- Full `tsc` hit/defaulted into repo-scale memory/runtime limits; validation used targeted tests plus production build.

## Remaining Work

### Wave 3: Provider Sync Completion

- Finish operational hardening for Gmail-native inbound:
  - deploy/apply `GmailSyncOutbox` migration
  - install or confirm Gmail cron dispatch in production
  - smoke Gmail webhook queueing and provider-outbox GHL email mirror
- Audit calendar/task frontend flows for blocking provider sync:
  - keep `ViewingOutbox` and `ContactTaskOutbox` as the domain outboxes
  - only change UI/server actions if a blocking sync path is found
- Keep Outlook out of scope unless the product decision changes.
- Finish GHL provider operations that need explicit API/product policy:
  - `sync_status`

### Wave 4: Observability And Operations

- Add admin/provider-sync dashboard for:
  - pending jobs
  - failed jobs
  - dead-letter jobs
  - disabled jobs
  - stale sync records
  - per-provider health
- Add manual retry / disable / inspect actions for provider outbox rows.
- Add alerts for high dead-letter volume or stale provider sync.

### Wave 5: Legacy Cleanup

- Continue removing nonessential `ghlConversationId` references in logs, compatibility maps, and old fallback paths.
- Keep old URLs readable, but ensure all newly generated URLs use `Conversation.id`.
- Eventually replace remaining `DealContext.conversationIds` reads with `DealConversationLink` as the only source of truth.
- Once production has aged safely, consider dropping or renaming `ghlConversationId` to a clearer legacy alias field.

## Acceptance Criteria For Fully Finished

- Estio works completely with all external providers disconnected.
- All new internal writes use `Conversation.id`.
- GHL, Google, Outlook, and Evolution provider data resolves through sync records.
- Provider outbound work is queued, idempotent, retryable, observable, and never blocks local UX.
- Deal/task/AI/notification/realtime features use internal IDs exclusively.
- Legacy IDs remain accepted only as compatibility inputs.
- Operators can see and retry failed provider sync work from the app.
