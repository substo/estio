# Estio coordinator prompts

Draft for discussion, 2026-11-03. These prompts do not activate a schedule, grant new permissions, approve a backlog item, or replace existing project rules.

## Target operating model after design discussion

This section states the recommended destination; the later local-first rollout notes describe an incremental route, not a requirement to retain a local-only dashboard.

One private operator workspace inside Estio provides a mobile-friendly product table, work board and decision inbox. Its durable records and authenticated API are available on the hosted service. The Mac worker connects outbound to claim authorized assignments and return progress/evidence; no inbound laptop port or provider credentials in the browser are needed. Keep one queue owner. Reuse Atlas's existing inventory, approval, freshness and delivery mechanics where practical, but its private SQLite/local-origin design needs an explicit migration/integration plan; it is not already a remotely hosted backend. The customer runtime must not execute development shell commands. Operator authority is separate from Location membership. Retain a local recovery/disable path if an Estio change breaks the hosted interface.

### Product table and relationships

One canonical row per page or feature, filtered by Estio/Substo/both and CRM/Studio. Columns: name, short purpose, current state, evidence freshness, open work, dependencies, last meaningful change. Expand to approved intent, observed implementation, user journey, source references, checks and decisions. Rows reference shared resources: components, APIs, data models, design tokens/fonts, external services and product rules. Relationships name their meaning (contains, uses, reads/writes, governed-by, verified-by), source evidence and revision. Shared records appear in both app views without duplication.

Use ordinary relational records and an edge table; no dedicated graph database or continuously running agent per node is needed. Derive import/route/style references mechanically where feasible. Curate semantic links such as journeys, authorization and runtime service use; label inferred, confirmed, stale and unknown coverage. Renames/removals need reconciliation of stable identities. A graph view is a secondary inspection of the same data, not a separate truth source.

### Change-driven loop

1. Observe a new source revision or a reconciled local snapshot; identify the changed files and resource records. Keep local, integrated and deployed revisions distinct.
2. Walk reverse dependencies and deduplicate affected rows. Capture the union of pre-change and post-change relationships so deleted imports/resources do not hide affected consumers. Global styles, shared rules and uncertain dependency coverage require a conservative wider check.
3. Mark affected evidence as needing verification, with the causal revision and reason. This does not declare a defect or authorize a fix. Coalesce rapid edits; unchanged scans make no AI call. Use stable job keys, atomic claims/leases, bounded retries and visible failure state. Superseded results cannot restore freshness.
4. Select proportionate checks: deterministic checks first; visual checks for fonts/layout; contract and integration checks for APIs; cross-app and tenant checks for shared behavior. Dispatch bounded analysis only when judgment is needed. Deduplicate any discovered issue against existing work.
5. Record passing evidence or propose a concrete repair. Continue within existing scope authorization; route new scope to the decision inbox. Independent review assesses the resulting revision. Serialize integration and use the owned deploy workflow only within release authority.
6. Refresh affected briefs and results. Completion states name what was implemented, checked, integrated, deployed and live accepted. Proposed intent changes require an owner decision; generated descriptions cannot approve them.

Source changes drive immediate assessment; periodic reconciliation catches missed events and stuck jobs. A weekday product review offers at most three useful decisions. A weekly journey review asks whether connected features meet approved outcomes. These routines share the same records and queue; they do not create separate dispatchers.

### Owner experience

The default phone screen answers: what needs my decision, what is progressing, and what is blocked? Each decision gives one-sentence problem, affected rows, recommendation, benefit, risk/effort, exact scope and endpoint, with evidence expandable. The full product table is for exploration; the board is for delivery. Approval records are versioned. One outcome approval covers routine in-scope work through the selected endpoint, without repeated step approvals. Bound unattended work by explicit scope, concurrency, retry and usage limits, and show worker heartbeat, last sync and pause state.

Prove the complete loop on one shared capability and two consumers before expanding inventory or automation. Acceptance requires a phone decision to reach exactly one worker assignment, an actual controlled dependency change to identify affected consumers, recorded checks, stale-result rejection and an accurate returned status. This remains a design proposal; no hosted interface, migration or scheduled worker is activated by this document.

## Purpose and ownership

Martin sets outcomes and priorities. One coordinator turns them into bounded assignments, tracks progress, proposes improvements, and brings back reviewable results. Use specialists for implementation and independent review as needed; avoid a permanent roster of idle agents.

Use the existing Atlas intake/coordinator for requests, proposals and approval references. Verify its current connection through the Estio Atlas intake skill; its saved paths may be stale. Do not create a competing Markdown task board or GitHub Issues queue. Architecture decisions remain in `documentation/how-the-app-works.md`; release state and acceptance evidence remain in `documentation/current-status.md`. Link these sources from assignments instead of copying their contents into another ledger.

T3 supplies execution: delegated tasks, worktree isolation, scheduled triggers and PR links. A schedule triggers a bounded run; it does not make a conversation continuously active. Confirm host availability and actual scheduled execution before promising unattended operation.

## Coordinator session prompt

### Model execution policy and T3 lineage

The target includes a model/provider policy, not model names embedded in role prompts. Discover actual provider instances, accounts, model IDs, options and tool capabilities. The observed T3 catalog exposes enabled Codex and Claude instances; it does not establish a third independently configured OpenAI CLI instance, remaining quota, or automatic quota failover. Discovery is not authorization: newly discovered models remain disabled until approved.

Each approved profile records provider instance/account, auth/billing mode, model, supported settings, allowed task types/tools, data scope, concurrency, usage/spend limits and ordered eligible fallbacks. Keep billing identity distinct from CLI name; different clients may share a quota bucket. Start with a few deterministic role profiles (triage, planning, implementation, independent review). Choose a qualified economical profile using task risk, tool needs, health and observed task outcomes. High-risk work retains its quality floor when capacity is exhausted. A different reviewer provider is useful when approved and capable; separate evidence is still required regardless of model diversity.

Run admission, limit detection, retry and fallback are deterministic worker operations, so they function even when the coordinator model is unavailable. Read documented provider quota telemetry where supported, retain observation time and bucket/reset identity, and honor structured limit errors. Unknown capacity remains unknown; do not invent remaining tokens or exact task counts. Classify quota exhaustion, transient transport errors, invalid authentication, missing permissions and failed verification separately. Permission waits and test failures do not trigger model rotation. Use bounded backoff for transient errors, cool down an exhausted quota bucket, and do not try another model against the same exhausted shared bucket unless documented eligibility supports it.

On confirmed exhaustion, preserve work and reconcile in-flight commands. Transfer ownership only after the previous writer has stopped; an unreachable writer blocks automatic takeover until fenced. Choose only a pre-approved fallback satisfying tool access, data permission and quality requirements. Otherwise set waiting-for-capacity with a verified reset time when available, then recheck before resuming. An unknown reset needs bounded health checks or owner action. No silent API billing, credit purchase, account switching outside the allowlist, permission broadening or downgrade below the required quality. A user pause always overrides automatic resumption.

Every attempt records the selected provider/account/model/settings, routing policy version, reason, quota observations and outcome. Portable handoffs contain task/approval references, acceptance criteria, source/base revision, owned worktree and actual working diff, completed steps, checks/log references, decisions, unresolved review findings, pending external actions and exact next step. Persist checkpoints before a limit error; the exhausted model cannot be relied on to summarize afterward. Native resume may preserve a compatible session; cross-provider continuation reconstructs task context from artifacts and a summary, not hidden model state. Revalidate permissions and working state before continuing, and reconcile ambiguous external actions before replaying them.

The hosted UI shows approved profiles and fallback rules, current provider/model, health, last quota observation, reason for switches, waiting/reset status and pause/revoke controls. Never display local credentials. The worker uses supported authenticated CLI/provider interfaces on the Mac; customer AI API configuration and operator development subscriptions are separate authorities.

Treat T3 as the preferred execution integration/reference behind a narrow adapter. Capability discovery, start, observe, stop, approvals, checkpoint and continuation form the contract; optional quota/native-resume features are explicitly negotiated. Existing MCP tools are callable in a T3-owned agent session, not proof of a standalone public service API for Estio. Inspect the supported service boundary before choosing reuse, extraction or a maintained fork. Keep one dispatcher; do not add a T3 execution queue competing with Atlas's existing bridge.

Register T3 itself as an upstream dependency in the product map: source repository, pinned revision/version, relevant feature/source references, license/notice obligations, adapter contract version and compatibility tests. Link our model routing and context handoff features to those references. Monitor upstream changes for a compatibility assessment and upgrade proposal; do not automatically ingest upstream code or enable newly advertised models. Test upgrades on a disposable task, including simulated quota exhaustion, approved fallback, no-fallback pause, duplicate prevention, partially edited worktree recovery and permissions. Actual provider telemetry and native continuation need separate live acceptance; mocks do not prove subscription behavior.

Sources inspected for this design: T3 `docs/internals/providers.md` (provider-instance isolation and portable handoffs), T3 `LICENSE`, live T3 orchestration catalog, and official Codex App Server documentation (`account/rateLimits/read`, `account/rateLimits/updated`). Precise Claude quota telemetry and full unattended cross-provider recovery are unverified prerequisites, not claimed existing capabilities.

```text
Act as Estio's project coordinator. Help Martin move the shared Estio/Substo codebase forward with minimal task-management effort.

Read AGENTS.md, documentation/how-the-app-works.md and documentation/current-status.md first. Inspect the current checkout, active tasks and recent evidence. Treat dated release statements as recorded evidence, not proof of today's production state. Follow nested instructions when relevant.

Use the existing Atlas workflow for new intake and proposals. Search before creating records; use stable intake keys. Registering or proposing work is not implementation approval. Verify saved checkout identities rather than substituting a stale path. If Atlas is unavailable, report unsaved proposals and the connection failure; do not pretend they were recorded or create a replacement queue.

Reconcile approved work with active T3 tasks before dispatch. Resume an existing assignment instead of duplicating it. Each assignment needs: record ID, outcome, approval reference and scope, owner/task ID, state, dependencies, acceptance criteria, evidence required, base commit/worktree, allowed actions, and run/retry limits. Map these onto existing Atlas fields and notes; do not invent a new schema without need.

Prioritize finishing approved work and resolving blockers before proposing more work. Keep at most three new recommendations, each with observed evidence, expected benefit, smallest useful scope, tradeoff and your recommendation. Distinguish observations from hypotheses. Never reopen explicitly deferred product work merely to keep busy.

Delegate approved implementation as one small task in an isolated worktree from a verified base commit. Uncommitted parent changes are not copied; never discard or silently include somebody else's changes. Give the worker exact scope and acceptance criteria. Retain its task ID and inspect status before retrying. Use a fresh delegated task for each independent review round, including prior findings and unresolved objections.

Carry out already-authorized reversible work without repeated permission requests. Product questions that materially change scope need Martin's decision. Preserve existing deployment authorization and use deploy-local-build.sh and its skill when deployment is in scope. Never infer new permission for paid provider acceptance, production data repair, publishing or messages from a generic instruction to make progress. Existing explicit authorization remains valid within its scope.

Verify results independently using the diff, relevant checks and acceptance evidence. A worker's summary alone is not completion evidence. Record the exact commit/artifact, commands and results, remaining risks, and any acceptance not performed. Distinguish implemented, verified, released and live-accepted. Never claim a clean typecheck or device/provider acceptance from unrelated checks or mocks.

End each run with a short report: what moved forward, evidence, blockers needing Martin, and next action. If nothing changed, say so briefly. Do not keep generating tasks to fill a schedule.
```

## Scheduled triage prompt

Proposed starting cadence: once per weekday. Configure only after selecting a cadence, confirming the scheduler timezone, and agreeing on the routine's scope. Start with proposal/triage runs before enabling implementation.

```text
Run one Estio coordinator triage cycle using documentation/project-coordinator-prompts.md and current project instructions.

Read current decisions, status and Atlas records. Reconcile active delegated tasks and existing proposals. Inspect recent repository changes and available verification evidence. Identify stalled approved work and at most three evidence-based improvements. Save genuinely new proposals through existing Atlas intake, with stable keys; do not approve them yourself.

This routine may inspect and prepare proposals only. Do not start implementation, merge, deploy, run paid acceptance, change production data, publish, or message others. Do not launch child work merely for triage. Stop after one inspection pass and report findings; no recurring self-retries. If Atlas is unavailable, report that findings were not saved. If there is no actionable change, return a brief no-change result.
```

## Approved delivery prompt

Fill in every bracket before dispatch; missing approval, scope or budget is a blocker for dependent work.

```text
Continue approved Atlas assignment [ID/link]. Outcome: [outcome]. Approval reference: [reference]. Acceptance: [observable criteria]. Base commit: [SHA]. Allowed paths/scope: [scope]. Allowed external actions and paid-use ceiling: [explicit limits]. Run limit: one implementation task, one independent review, and at most one fix/re-review round; stop and report unresolved issues after that. Any monetary limit must be enforced by the host/provider where available; prompts alone cannot enforce spend caps.

Check whether this assignment already has active work. Reuse it if so. Otherwise delegate one bounded implementation in a separate worktree. Search and reuse existing mechanics. Follow repository and applicable skills. Do not expand product scope. Return the diff/commit, verification results, acceptance evidence, residual risks and next action. Register PRs with T3 if created. No merge or deploy unless the assignment or existing explicit authorization includes it.

Have an independent reviewer inspect correctness, tenant/app boundaries where affected, regressions and acceptance evidence. Resolve findings within the run limit. Update the existing assignment with truthful state and evidence. Keep release/status documentation accurate when a release occurs; do not mark implementation as deployed.
```

## Controls to establish before unattended delivery

- Start with one active implementation task and bounded review rounds. This is a proposed operating limit, not a claim of scheduler enforcement.
- Confirm how overlapping triggers are serialized or claimed. If a single-owner claim cannot be established, skip dispatch rather than risk duplicate workers.
- Agree on model selection and cost limits; establish actual metering/enforcement before relying on a monetary budget. Retry limits do not guarantee a spend ceiling.
- Test one manual cycle, then one scheduled triage cycle. Confirm a trigger actually ran and its report was retained.
- Record the scheduler task ID when enabled. Disabling it stops future triggers; separately cancel running delegated tasks. Preserve their evidence and working changes.

## Initial focus from the recorded status

The status document last updated 2026-10-29 records sustained Mac companion acceptance as open and requiring a device; real onboarding acceptance is blocked on specified model and cost authorization. Revalidate both before assigning work. Do not start the companion unattended: the recorded warning says it can execute queued provider diagnostics and login commands. Deferred billing, integrations and free-form onboarding are not automatically eligible work.

## Decision workspace and page alignment

Follow-up design, not an implemented Atlas change:

- Use Atlas as the decision workspace. Existing code has grouped proposal stages and card lists, page briefs, feature assessments, cross-page opportunities and responsive layouts. Simultaneous Kanban columns and a concise mobile decision inbox are proposed improvements, not verified current behavior.
- Present five user-facing stages: Proposed, Approved, Working, Review, Done. Map these onto existing detailed states rather than rewriting delivery state. Show blocked status as a visible flag with its exact prerequisite. Keep deferred/dismissed items out of the default decision inbox.
- Each decision card leads with outcome, affected pages/features, why now, recommended smallest change, effort/risk and the decision requested. Expand for scope, alternatives, code evidence and checks. Approvals bind to the current revision, scope and delivery endpoint; moving a card visually must not silently approve a stale plan.
- Use columns on desktop and a focused list with stage filters on phones. Prefer explicit action buttons over requiring drag-and-drop. Default to at most three recommendations and one active implementation.
- Organize context as App → CRM/Studio → area → page → feature. A shared page has one canonical record with app applicability; do not duplicate its implementation or brief for each edition. Cross-page capabilities link to every affected page.
- Each page brief summarizes purpose, user journey, approved intent, observed source behavior, features, permissions, dependencies, gaps and acceptance evidence. Label source revision, analysis date and verification level. Generated code descriptions never overwrite approved intent.
- A shared rule registry should link to the canonical architecture decisions for Location ownership, app separation, authorization, usage and shared components. Page briefs inherit those rules and record exceptions explicitly. Shared dependency changes flag linked briefs for review; periodic product review checks journeys across pages. Keep uncertain or uninspected dependencies visible.

### Scheduling and remote access

Atlas documentation records an existing persistent source scanner and an approval/delivery bridge. Its native repeating coordinator heartbeat is paused. Verify actual runtime health before activating anything. Do not start a second queue dispatcher or manually claim bridge-owned work.

Recommended first scheduled task: one weekday triage report, bound to the coordinator conversation, using the triage prompt above. Report bridge health, source/report freshness, blockers, and at most three new decisions. Skip unchanged proposals. An optional weekly alignment review checks shared rules and cross-page journeys; it does not authorize implementation. Configure actual timezone and return the scheduler task ID and next run time when enabled.

The existing Atlas web service binds to 127.0.0.1. Its documented browser pairing is local access, not remote hosting. Phone access requires a separately designed and verified access path. Preferred first option: private authenticated access to the existing host with narrowly allowed origins and revocable sessions, after checking current local-origin enforcement. For access while the Mac sleeps, an always-on board service is required; keep the Mac execution bridge as a separate worker. Do not expose the current local bearer-secret interface directly to the public internet. Deployment and access changes belong to the Atlas project, not Estio's customer app.

Suggested delivery order: verify existing Atlas board/brief/bridge behavior; implement the concise decision view; establish authenticated phone access and test real approvals; manually run triage; activate one scheduled triage and verify its receipt; then consider bounded unattended implementation. This order is a proposal, not a new approval requirement for already-authorized work.
