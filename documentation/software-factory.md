# Software factory (Build)

The one place to read before working on Estio's software factory. It explains what it is, how it works, what the system decides, and where it is heading. The same content appears in Build on the **How it works** tab, rendered from `lib/build/factory-guide.ts`; keep the two in step. Operational setup, safety fences and test evidence are in [Build workspace](build-workspace.md). Current release state is in [current status](current-status.md).

## What it is

A way for the owner to move Estio/Substo forward with as little effort and attention as possible. The system notices what could be better, proposes it, does the approved work, and shows the result. The owner gives feedback and keeps a few gates. The long-term goal is an autonomous loop.

- **Build** (`/admin/platform/build`, platform admin only) is the ledger and dashboard: the experience map, proposals, approvals, work, results and approved models.
- **The Mac worker** (`scripts/build-worker.ts`, LaunchAgent `co.estio.build-worker`) connects outbound to Build, scans the repository and runs approved work.
- **T3 Code is the executor.** Each assignment becomes a visible T3 thread on its own `build/…` branch worktree, so the owner can watch, steer or answer it. Starting a thread is a local `t3` command, not a model turn. This plays the role Archon plays in Cole Medin's factory.
- **The fence** (`lib/build/delivery.ts`) checks every result: only the approved files changed, no commits, no symlinks or secrets.

## Principles

1. **The system decides; the owner gives feedback.** Before adding any control for the owner, check whether the system can decide it with a rule. Decided by the system today: task difficulty, model choice, fallback when a subscription limit is hit, and which screens a code change affects.
2. **Low-token mode.** Preserve subscription limits. Prefer deterministic, zero-token rules for dispatch, routing, scanning and scheduling. There is no independent second reviewer, and no agent polls while idle.
3. **Attention is the budget** (borrowed from DeepSeek's super agent). Every message, setting and screen element must be worth the owner's attention. Show only items that need a person, speak only when a result, decision or blocker exists, and ask one question at a time.
4. **Gates stay with the owner** for irreversible or outward actions: merge, deploy, spending, and approving a new model. Everything else should become policy over time.
5. **Honest evidence.** Results are local branches with verified diffs. Failures are reported as failures, and nothing is claimed as released until it is deployed.

## The loop

```
notice ──► propose ──► approve ──► implement ──► review ──► feedback
(daily     (Build      (owner;     (T3 thread,   (owner     (next attempt /
 review,    card)       later       fenced        looks at    new proposal)
 owner)                 policy)     worktree)     the branch)
```

- **Notice:** the opt-in daily read-only review checks one stale screen per day (a screen linked to an updated watch-list item goes first). Every review ends with up to three structured proposals, which become **unapproved cards** automatically. A daily review is then marked done, because its cards are the output. The owner can also add ideas.
- **Propose:** a card with outcome, reason, scope files and acceptance criteria. On creation the server assesses difficulty (`assessDifficulty` in `lib/build/contract.ts`) and picks the model.
- **Approve:** one click by the owner, or **policy auto-approval** (see Capabilities). The mode is Off / Record only / On, set in How it works › Your setup. Record only marks each new card "Policy would approve" or "needs you (reasons)" without acting.
- **Implement:** the worker claims the card and starts a T3 thread at the approved commit. When the thread is idle, the fence verifies the result.
- **Review and feedback:** the card shows the result. The owner either **accepts** (optionally with a note) or writes what should change and presses **Redo with this note**. A redo is a fresh approval of the same scope. The worker sends only the note to the **same T3 thread** in the same worktree, so the model keeps its context, tokens stay low, and the whole conversation is visible in T3. Failed results can be redone the same way. Merge and deploy remain manual (`deploy-local-build.sh`).

## Capabilities

| Capability | Status | What the system decides | What you decide | In Build |
|---|---|---|---|---|
| Experience map | Live | Screens from routes; stale marking on code changes | Optional renames and features | Product map |
| Daily review | Live (opt-in) | Which screen; up to three proposals | Turn it on | Decisions & work |
| Findings become proposals | Live | Validation, difficulty, model; closes the daily review | Which cards to approve | Decisions & work |
| Difficulty and model choice | Live | Everything | Nothing | Each card |
| Policy auto-approval | Record only by default | Judges each new card: implementation, Routine, 3 files or fewer, no sensitive area, 5 criteria or fewer, an approved model available, 3 a day | Off / Record only / On | How it works › Your setup |
| T3 execution | Live | Starts, watches and stops threads | Watch, steer or answer if you like | T3 sidebar |
| Safety fence | Live | Verifies every result | Nothing | Card evidence |
| Feedback and redo | Live | Re-approves the same scope and continues the thread | Accept, or write a note | Result cards |
| Approved models | Live | Keeps the catalog current | Allow models once (Routine or Hard) | Model profiles |
| Watch list | Live | Daily GitHub update checks that feed the daily review | Paste links; mark adopted or not for us | Watch list |
| Screen descriptions | Live | Drafts purpose, journey and up to 5 features in the daily review's own run; undescribed screens go first | Confirm (adds features) or discard | Product map |
| For you (attention queue) | Live | Collects and orders what needs you (blocked, questions, results, proposals, drafts, watch updates, setup gaps); shows one at a time | Act on it, or choose Later | For you (default tab) |
| Merge and deploy | Stays with you | Never merges or deploys | Merge and deploy | Git / `deploy-local-build.sh` |

Auto-approved cards carry `approval.actor = "policy"` and `approval.auto = true`. They bind the same revisions as an owner approval and show "Approved by policy". The policy is `autoApprovable` and `autoApprovePolicy` in `lib/build/contract.ts`. It is evaluated on every new proposal (owner or review) by `autoDecide` in `lib/build/store.ts`. Widen it only after Record only shows good judgement.

## The experience map

The product as users see it, not as files: **section › area › screen › feature**.

- **Sections:** CRM (`/admin`), Studio (`/studio`), Public website (`/[domain]`, `/sites`, `/widget`), Platform admin (`/admin/platform`), Account & onboarding (everything else). Both apps (Estio and Substo, chosen by domain) share every screen.
- **Screens** are derived from every Next.js `page.tsx` route by `lib/build/experience.ts`, with no model call. For example `/admin/conversations/[id]` becomes "CRM › Conversations › Detail". On 2026-11-03 this produced 142 screens in 61 areas.
- **Features and journeys** sit under screens. The daily review drafts them as it reviews each screen, in the same run with no extra model turn, and screens with no description go first. A draft is kept separately (`draft`) and is never approved intent. **Confirm** makes it the screen's description and approved intent and adds its features as feature records (`contains` links). **Discard** removes it. The owner can still add or edit features by hand.
- **Code files** stay attached as evidence ("Also show code files"). Import links let a change to shared code mark every screen that uses it stale.
- The owner can rename a screen and the name is kept (`naming: "owner"`). The worker re-scans whenever the repository changes, even while the queue is paused, because scanning is read-only and costs no tokens.

## Models

- The worker reports T3's current model catalog on every poll, read from T3's own model manifest. New releases and newly enabled providers appear automatically as **Not allowed**.
- The owner approves models once on the Model profiles tab and sets each to Routine or Hard. Guidance notes in `lib/build/model-guidance.ts` suggest a level. Only approved models ever run.
- Routing picks an approved model at the task's assessed difficulty, then any other approved model. When a subscription limit is hit, it falls back to the other provider.
- Effort is T3's default for each model, because the T3 command line cannot set it.

## How to work on the factory

- **Propose a change** in conversation or as a Build card on the "Platform admin › Build" screen. Say what friction it removes and whether the system could decide it instead of the owner.
- **Agree before building.** The owner approves direction (see the roadmap). Record each decision in the decision log below and, where relevant, in `how-the-app-works.md`.
- **Keep it small and reusable.** Reuse Build's tables (BuildNode, BuildEdge, BuildJob, BuildControl) before adding new ones. Keep one name per concept.
- **Update How it works.** Every factory change updates `lib/build/factory-guide.ts` (the in-app tab) and this page: the Capabilities table, the roadmap and the decision log.
- **Verify, then deploy.** Run the focused tests (`npx tsx --test lib/build/*.test.ts`). Deploy with the owned workflow from the isolated release checkout (see current status), and update [Build workspace](build-workspace.md) with the evidence.

## Roadmap

Done: T3 executor; catalog-driven model approval; system-decided difficulty, model and fallback; experience map from routes; opt-in daily review; watch list; feedback on results; review findings become proposals; policy auto-approval (record-only first); How it works tab; screen descriptions drafted by the daily review; For you attention queue.

The planned roadmap is complete. Candidates for next, none agreed yet:

1. **Learning from feedback** ("prompts over settings", from DeepSeek): recurring redo and accept notes become standing guidance added to future prompts, which the owner can review.
2. **Widen auto-approval** once Record only has shown good calls, for example to small reviews or a larger daily budget.
3. **Merge assist:** after Accept, prepare the branch for merge (rebase on the release branch, run focused tests) and leave the final merge and deploy to the owner.
4. **Notifications:** a single phone notification when something reaches the top of For you, with nothing else sent.

## Inspiration and watch list

External references and what we take from them. **Live in Build → Watch list** (built 2026-11-03):
- Paste any link (GitHub, YouTube, any site) with an optional note on what to take, and link it to the screens it could improve. The table's suggested references can be added in one click.
- Each item is a BuildNode with `kind: "reference"` and `inspires` links to screens, with status watching / adopted / not for us.
- GitHub repos are checked once a day by the Mac worker (`checkGithub` in `lib/build/watch.ts`: plain API calls, no model, no credentials). The first check is the baseline, and later changes show as "Updated" until marked as seen.
- If the daily review is enabled, a changed reference with a linked screen takes priority. That review gets the change and the owner's note, and says what, if anything, the screen should adopt. Each change is queued once.
- Videos and other sites are one-off links, not checked.

| Reference | What it is | Taken / to consider |
|---|---|---|
| [coleam00/ai-software-factory](https://github.com/coleam00/ai-software-factory) | Thin layer over Archon: GitHub Issues as the queue, builder plus two reviewers, runtime check, merge gate, protected paths, holdout scenarios | Taken: separate executor (T3 instead of Archon), protected or sensitive paths, halt/pause. Rejected: dual reviewers (low-token mode) and GitHub Issues as the queue (Build's ledger instead) |
| [coleam00/factory-mission-control](https://github.com/coleam00/factory-mission-control) | Live dashboard of each factory's plan, issues and laps | Taken: Build is our mission control |
| [deepseek-ai/dsh-superagent-prototype](https://github.com/deepseek-ai/dsh-superagent-prototype) (MIT research prototype; video "NEW DeepSeek Harness – Super Agent") | A proactive repository agent: events from GitHub or chat become authorized tickets, each with its own session, and results go back to the conversation. A panel shows only what needs a person | To consider: attention budget (adopted as a principle); act only on request or written rule; record-only proactivity before widening; ask one question at a time; a panel that puts what needs a person first; "prompts over settings", where feedback tunes prompts instead of adding options; a ticket that resumes when the owner replies on its thread |
| Grok research notes (2026-11-03, see `project-coordinator-prompts.md`) | Coordinator, specialists, durable ledger, routines, evidence, approval gates | Taken: ledger, evidence before done, owner gates, start small |

## Decision log

- 2026-11-03: Build is the ledger and dashboard; T3 Code threads execute the work.
- 2026-11-03: No independent second reviewer (low-token mode).
- 2026-11-03: The owner approves models from T3's live catalog; no typing; only approved models run.
- 2026-11-03: The system decides difficulty and model; no owner difficulty or model choice on tasks.
- 2026-11-03: The product map follows the user experience (section › area › screen), derived from routes; files are evidence.
- 2026-11-03: Direction: remove friction, move toward autonomy; the owner gives feedback.
- 2026-11-03: Feedback on results: accept, or redo with a note that continues the same T3 thread.
- 2026-11-03: Watch list built: external references linked to screens; zero-token GitHub checks feed the daily review.
- 2026-11-04: Review findings become unapproved, auto-routed proposal cards; daily reviews close themselves.
- 2026-11-04: Policy auto-approval (Off / Record only / On), narrow deterministic rule, 3 a day; How it works tab mirrors this page.
- 2026-11-04: Screen descriptions (purpose, journey, features) drafted inside the daily review run; owner confirms or discards.
- 2026-11-04: For you is Build's default view: only what needs the owner, one at a time, with Later.
