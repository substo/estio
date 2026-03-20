# Conversations Performance Architecture, Change History, and Enterprise Roadmap
**Last Updated:** 2026-03-20

## Purpose
This document captures the full performance-improvement thread for `/admin/conversations`:
- what was researched
- what has been implemented
- what still needs to be implemented
- enterprise best practices to keep the experience fast and reliable at scale

Use this doc as the performance-focused source of truth.  
For full functional behavior and API details, see `documentation/conversation-management.md`.

## Target Outcomes (SLO / UX)
- Thread switch latency:
  - `conversationSwitchWorkspaceCore` p95 `<= 700ms` (cold path)
  - warm-cache click-to-visible-thread p95 `<= 350ms`
- Delta list refresh p95 `<= 500ms`
- No visible top-to-bottom scroll travel on initial thread open.
- Realtime-first updates with automatic polling fallback.

## Research Summary: Why Thread Open Was Slow
Baseline measurements before the split+hydration rollout showed thread switch latency above target (internal runs of `npm run perf:conversations:db` reported p95 values around ~1.84s and worse single-sample tails).

Main causes identified:
1. Switch path fetched too much data up front (messages + activity + sidebar fanout) before first paint.
2. URL updates triggered router navigation churn on each selection.
3. Duplicate/near-duplicate reads happened around initial selection and immediate polling.
4. Message/timeline queries were not fully bounded at DB read stage in earlier flow.
5. First hydration snapped to bottom after initial render, creating visible scroll jank.

## Change History (Implementation Thread)
| Date | Commit | Change |
|---|---|---|
| 2026-02-25 | `3597693` | Cursor pagination + infinite scroll for conversation list. |
| 2026-02-27 | `333d508` | Live unread badges + realtime thread sync baseline. |
| 2026-03-07 | `2af1097` | Workspace/search optimization groundwork. |
| 2026-03-07 | `9a74a2b` | Initial thread-open snap-to-latest fix. |
| 2026-03-07 | `032f877` | Added rollout smoke/perf verification command. |
| 2026-03-08 | `a77ee67` | Unified timeline pipeline used by chat and AI drafts. |
| 2026-03-09 | `e374c3f` | Split workspace loading + SSE realtime with polling fallback. |
| 2026-03-10 | `df84407` | Faster read-state reset path. |
| 2026-03-10 | `c7b410a` | Faster Gemini draft experience (adjacent UX perf). |
| 2026-03-10 | `11420df` | Instant open via progressive hydration + no visible scroll jank. |
| 2026-03-20 | `2e54c54` | Fire-and-forget outbound send with optimistic reconciliation. |
| 2026-03-20 | `52e82e5` | Optimistic unread badge clearance override during list polling. |

## Current Architecture (As Implemented)

### 1) Client-side Thread Open Pipeline
`ConversationInterface` now uses staged hydration:

1. Stage 1 (blocking, first paint):
   - fetch only newest window using viewport-derived limit
   - limit calculation: clamp `35..60`, fallback `40`
   - activity excluded in this phase (`includeActivity: false`)
2. Stage 2 (deferred, non-blocking):
   - backfill older messages in background to target `250`
   - load activity timeline separately in deferred path

Hydration state is tracked per conversation snapshot:
- `status`: `partial` or `full`
- cursors and counts: `oldestCursor`, `newestCursor`, `initialCount`, `targetCount`, `requestedLimit`

Other implemented client speedups:
- in-memory LRU cache of workspace core snapshots (`limit = 30`)
- immediate render from cache on revisit + background revalidation
- idle prefetch of top likely-next conversations (`slice(0,3)`) and hover prefetch
- active-thread polling starts after grace delay (`ACTIVE_POLL_GRACE_MS = 2500`)
- realtime/poll refresh is skipped while hydration/backfill is in-flight to avoid duplicate work
- shallow URL sync via `history.replaceState` when enabled, with `popstate` state restoration
- fire-and-forget outbound message send with optimistic UI + targeted reconciliation (see §6 below)
- optimistic unread badge clearance protected against stale background polling via `readResetInFlightRef` (see §7 below)

### 2) No-Scroll-Jank Opening Behavior
`ChatWindow` removes first-open travel effects:
- first hydrated frame is snapped directly to bottom
- timeline is hidden until initial bottom position is applied (`isTimelineReady`)
- container smooth-scroll is not used for initial open
- smooth scrolling remains only for explicit user actions (e.g. jump-to-message)
- mount animation is suppressed during initial hydration/backfill and retained for true realtime tail arrivals
- prepend anchor compensation preserves viewport when older messages are inserted:
  - `nextScrollTop = previousScrollTop + (nextScrollHeight - previousScrollHeight)`

### 3) Server-side API Split and Bounded Reads
Workspace split:
- `getConversationWorkspaceCore(conversationId, options)`
  - header + messages + activity timeline + transcript eligibility + freshness + `messageWindow`
- `getConversationWorkspaceSidebar(conversationId)`
  - contact/task/viewing/agent summaries
- legacy `getConversationWorkspace` remains wrapper for compatibility

Message read path:
- `fetchMessages(conversationId, { take, beforeCursor, includeLegacyEmailMeta })`
- DB reads newest-first with bounded `take`, then reversed for UI chronology

Timeline read path:
- `assembleTimelineEvents(..., { take, beforeCursor })`
- each source bounded at DB layer before merge/sort
- final merged list bounded by requested `take`

### 4) Realtime Transport + Reliability
Implemented SSE channel: `/api/conversations/events`
- location-scoped auth
- heartbeat every 20s
- `Last-Event-ID` replay support from Redis history
- event envelope:
  - `{ id, ts, locationId, conversationId, type, payloadVersion, payload }`
- idempotent/out-of-order merge guard on client:
  - dedupe by event id
  - reject older timestamp for same conversation
- automatic fallback to polling if SSE remains unhealthy/disconnected (>10s)
- reconnect triggers a single delta resync

### 6) Outbound Message Send Pipeline (Mar 2026)
`handleSendMessage` uses **fire-and-forget + optimistic reconciliation**:

1. **Optimistic insert**: A local message with `status: 'sending'` is appended immediately. The input box clears and the UI is free.
2. **Non-blocking server call**: `sendReply(...)` runs as a detached `.then()/.catch()` — the main thread is never blocked.
3. **Server fast-ack**: `sendReply` returns as soon as the Evolution API confirms and the DB message row is created. Conversation metadata update (`updateConversationLastMessage`) and GHL sync both run fire-and-forget on the server.
4. **Targeted reconciliation**: On success, the client fetches only the latest 5 messages (`fetchMessages(id, { take: 5 })`) and swaps the optimistic stub for the real DB message with deduplication.
5. **Failure handling**: If the server action fails, the optimistic message is marked `status: 'failed'` with a red badge + toast notification.
6. **SSE safety net**: If the SSE realtime event (`message.outbound`) arrives before reconciliation, the existing realtime merge guards prevent duplicates.

### 7) Optimistic Unread Badge Clearance (Mar 2026)
When an unread conversation is clicked, the UI clears the badge instantly locally. However, if a background poll or SSE fetch occurs before the server completes the `markConversationAsRead` background core action, the server may reply with a stale `unreadCount > 0`.
To prevent the UI from flashing the unread badge back on, list merge functions (`applyConversationDeltaPayload`, `replaceConversationListFromResponse`, etc.) intercept the incoming server payload. If `readResetInFlightRef.current` tracks that a read reset was recently initiated for a conversation, the client actively overrides the incoming `unreadCount` to `0`, ensuring the badge remains seamlessly cleared.

### 5) Data, Index, and Query-plan Safety
Performance indexes and query-plan checks are in place for:
- conversation list ordering/filtering
- message thread reads
- contact history timeline reads

Validation tooling:
- `npm run perf:conversations:query-plan`
- `npm run perf:conversations:db`

## What Has Been Implemented vs Pending

### Implemented
- Split core/sidebar workspace loading.
- Realtime SSE + polling fallback model.
- Bounded `fetchMessages` and bounded timeline source reads.
- Shallow URL sync path to avoid router churn.
- Per-conversation LRU workspace cache + prefetch.
- Two-stage thread hydration (initial window + deferred backfill/activity).
- Initial-open no-jank behavior (bottom-first reveal, no smooth travel).
- Realtime dedupe and out-of-order guards.
- Dedicated tests for hydration helpers, cache behavior, realtime merge/replay.
- Perf scripts with pass/fail thresholds for DB and UI benchmarks.
- Fire-and-forget outbound send with optimistic reconciliation (no UI freeze on message send).

### Partially Implemented / Gaps
- UI benchmark currently detects active thread activation (`data-chat-active-conversation-id`) and is a useful proxy, but should be extended to exact first-message-paint instrumentation for stricter UX SLO enforcement.
- Heavy-media threads can still have client render/layout cost spikes even with bounded message count.
- Timeline/history virtualization is not yet implemented; rendering cost still scales with visible DOM nodes.

## Why Some Conversations Still Occasionally Feel Slow
Thread size alone is no longer the primary factor because initial reads are bounded. Tail latency now mostly comes from payload complexity and client render cost:

1. The newest 35-60 messages may include media/transcripts and expensive bubble layouts.
2. Image/audio/embed late layout can add additional repaint/reflow work.
3. Cold cache + network jitter + server read variance still affects p95/p99.
4. Background sync or read-reset writes can contend for resources during active switching.

## Enterprise Best Practices (Messaging Performance)
Use these as operating standards:

1. Budget every hop with explicit SLOs.
   - Example budget for cold open p95 `<= 700ms`: network `<= 150ms`, server `<= 250ms`, client render `<= 300ms`.
2. Make first paint minimal and deterministic.
   - Render latest visible window first; defer non-critical metadata and full history.
3. Always provide dual-mode transport.
   - Realtime-first (SSE/WebSocket) plus robust polling fallback with auto-switch.
4. Keep reads bounded and cursor-based.
   - Never fetch unbounded message/timeline sets on interactive paths.
5. Design cache for perceived speed.
   - Per-thread snapshot cache with stale-while-revalidate and request coalescing.
6. Control rollout blast radius.
   - Feature flags (`on/off/canary`), canary cohorts, fast rollback.
7. Instrument both server and client latency.
   - Track first paint, full hydration, backfill counts, fallback rates, and error rates.
8. Guard correctness under realtime disorder.
   - Idempotency keys, replay support, out-of-order drop rules.
9. Verify index usage continuously.
   - Query-plan CI checks for critical read paths.
10. Treat p99 as a product requirement, not a nice-to-have.
   - Optimize for worst-case heavy threads and low-end client devices.

## Recommended Next Roadmap (Prioritized)

### P0 (High impact, near-term)
1. Add strict browser metric for `click_to_first_message_paint_ms`.
   - Wire into Playwright benchmark + pass/fail gate in CI.
2. Add lightweight media placeholders with known dimensions.
   - Reduce layout shifts/reflow on media-heavy latest-window opens.
3. Add server/client sampling for heavy-thread diagnostics.
   - Correlate `initial_message_count`, media count, payload bytes, render time.

### P1 (Important)
1. Virtualize long timeline rendering (windowed list).
   - Keep DOM node count flat for 250+ history windows.
2. Incremental message enrichment.
   - Render core message first, enrich optional metadata after paint.
3. Adaptive initial limit by device class.
   - Lower initial count on low-end/mobile CPU profiles.

### P2 (Scale hardening)
1. Regional colocation enforcement checks in deployment pipeline.
2. Optional read replicas for heavy read load with replica-lag safeguards.
3. Periodic load test in production-like environment with p95/p99 trend alerts.

## Test and Verification Runbook
Run after major performance changes:

1. Unit/integration reliability:
   - `npm run test:conversations:realtime`
2. DB load-path latency:
   - `npm run perf:conversations:db`
3. Query-plan/index regression check:
   - `npm run perf:conversations:query-plan`
4. Browser switching benchmark:
   - `npm run perf:conversations:ui-playwright`

Pass criteria:
- `conversationSwitchWorkspaceCore` p95 `<= 700ms`
- `listDelta` p95 `<= 500ms`
- warm thread switch p95 `<= 350ms`
- cold thread switch p95 `<= 700ms`

## Observability Metrics to Keep
Client:
- `thread_open_initial_ms`
- `thread_open_full_ms`
- `initial_message_count`
- `backfill_count`
- `realtime_refresh_skipped_hydration`
- `active_delta_poll_skipped_hydration`

Server:
- `conversations.workspace_core` server timing
- `perf:conversations.workspace_core_window` logs
- SSE error/fallback rate

## File References (Implementation)
- `app/(main)/admin/conversations/_components/conversation-interface.tsx`
- `app/(main)/admin/conversations/_components/chat-window.tsx`
- `app/(main)/admin/conversations/_components/message-bubble.tsx`
- `app/(main)/admin/conversations/actions.ts`
- `lib/conversations/thread-hydration.ts`
- `lib/conversations/workspace-core-cache.ts`
- `lib/conversations/realtime-merge.ts`
- `lib/conversations/timeline-events.ts`
- `lib/realtime/conversation-events.ts`
- `app/api/conversations/events/route.ts`
- `scripts/perf/conversations-db-load-check.js`
- `scripts/perf/conversations-query-plan-check.js`
- `scripts/perf/conversations-ui-benchmark-playwright.js`

## Relationship to Other Docs
- Functional/source-of-truth behavior doc:
  - `documentation/conversation-management.md`
- This document:
  - performance architecture, timeline, enterprise standards, and roadmap
