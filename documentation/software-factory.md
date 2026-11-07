# Software factory (Build)

The one place to read before working on Estio's software factory. It explains what it is, how it works, what the system decides, and where it is heading. Build shows a short version under Settings › How Build works, from `lib/build/factory-guide.ts`; keep the two in step. Operational setup, safety fences and test evidence are in [Build workspace](build-workspace.md). Current release state is in [current status](current-status.md).

## What it is

A way for the owner to move Estio/Substo forward with as little effort and attention as possible. The system notices what could be better, proposes it, does the approved work, and shows the result. The owner gives feedback and keeps a few gates. The long-term goal is an autonomous loop.

- **Build** (`/admin/platform/build`, platform admin only) is one page, top to bottom: **Talk** (one "Talk to Build" line; conversations open in a side sheet), **Needs you** (only what waits on the owner, with the decision inline), **Product** (one list of what the product is: features, pages with work, background processes and technologies, each once, with a status of Ideas, Doing now or Done; see The product list), **The app** (section › page › features, names only), and **Playbook** (collapsed: the agents' instructions, editable, plus the repository's guidance and skills, read-only). Models, autopilot and the daily review sit behind **Settings**.
- **The Mac worker** (`scripts/build-worker.ts`, LaunchAgent `co.estio.build-worker`) connects outbound to Build, scans the repository and runs approved work.
- **T3 Code is the executor.** Each assignment becomes a visible T3 thread on its own `build/…` branch worktree, so the owner can watch, steer or answer it. Starting a thread is a local `t3` command, not a model turn. This plays the role Archon plays in Cole Medin's factory.
- **The fence** (`lib/build/delivery.ts`) checks every result: only the approved files changed, no commits, no symlinks or secrets.

## Principles

1. **The system decides; the owner gives feedback.** Before adding any control for the owner, check whether the system can decide it with a rule. Decided by the system today: task difficulty, model choice, fallback when a subscription limit is hit, and which screens a code change affects.
2. **Low-token mode.** Preserve subscription limits. Prefer deterministic, zero-token rules for dispatch, routing, scanning and scheduling. There is no independent second reviewer, and no agent polls while idle.
3. **Attention is the budget** (borrowed from DeepSeek's super agent). Every message, setting and screen element must be worth the owner's attention. Show only items that need a person, speak only when a result, decision or blocker exists, and ask one question at a time.
4. **Gates stay with the owner** for irreversible or outward actions: merge, deploy, spending, and approving a new model. Everything else should become policy over time.
5. **Honest evidence.** Results are local branches with verified diffs. Failures are reported as failures, and nothing is claimed as released until it is deployed.

## Talk

The owner says what they want on the Build page (or in T3). The Mac worker relays each message to one T3 thread per conversation, titled "Talk: …", in its own worktree at the latest scanned code. The thread is told to plan only, never edit. The worker syncs the thread's messages back every few seconds while it runs, so the conversation can continue in T3 and still show on the page. A reply takes a few seconds longer than in T3 because the Mac relays it.

The agent brainstorms, asks at most three short questions at a time and reads the code. When the owner agrees, it ends a message with a `{"plan":[…]}` block. The page shows it as task cards with one **Start**. Start approves every task (server-decided difficulty and model, tied to mapped files where they exist), and resumes a paused queue. Each task then runs like any other: its own T3 thread and branch, the fence, results under Needs you. "Ask or change something here" on a screen, and "Ask for a change to this file" on a guidance document, open a new conversation with that context. Code: `lib/build/talk.ts` (server), `talkTurn` in `lib/build/t3.ts` (worker), `app/(main)/admin/platform/build/talk.tsx` (page). Conversations are stored in `BuildTalk`.


**On the page (2026-11-07).** Talk stays out of the way: one "Talk to Build" line, the open conversations as small chips under it, and **Past conversations** beside it. A conversation opens in a side sheet over the page (Close, Escape, or tap outside), so the Product list never moves. **Done with this conversation** archives it; archived ones are listed under Past conversations, readable and reopenable. A conversation **archives itself** when its whole plan was started and every task it started is finished (done, that is accepted or merged, or dropped; at least one done; no merge in flight), not while the agent is replying or asking, and not again after the owner reopens it until a new plan is started. It is checked whenever the Build page loads. When and why is recorded on the conversation's plan JSON (`plan.archived`: at, by owner or auto, reason; no new column). **Linked both ways:** the plan in a conversation lists each started task with its live status and **Open in Product**, which closes the sheet and opens that work item in its feature; a work item that came from a conversation says **From conversation: …** and opens it. The link is the task key (`talk-<conversation>-…`) or `checkpoint.talkId` (`lib/build/conversations.ts`). Needs you shows a conversation with a plan to start or a question waiting in T3. "Ask or change something" anywhere opens a new conversation with the subject filled in. Conversations continued in T3 can still be opened and archived here.
**Execution conversations from work cards.** Open a piece of Work inside a feature, then **Open conversation** to read its execution thread on mobile, with its current task status, **Back to task**, **Planning conversation** and **Open in T3**. External T3 work uses the same viewer. Before execution opens a thread, the planning conversation stays available. The Mac relays messages without starting a model turn. A read-only mirror reuses BuildTalk (`state: execution`, `plan.executionJobId`); execution output never creates proposals, changes memory or approves work. Mirrors stay out of the open planning chips and archive list. Returned results (review/failed) allow a reply, explicitly queued as a fresh approval of the same scope through the existing Redo action; running and completed tasks remain readable with an Open in T3 link. The relay fetches 60 recent messages first; **Load earlier messages** expands in batches to 1,000. Responses are capped at 3 MB and 20,000 characters per message; older or shortened content is clearly identified and available in T3. This is the user/assistant conversation, not a copy of tool logs or internal reasoning. Archived planning conversations must be reopened to fetch older history.

## Playbook

The instructions Build sends are shown on the page and editable: **Talking with you**, **Doing a task** and **Daily review** (`lib/build/playbook.ts` has the defaults; edits are stored on BuildControl with the previous version kept). New threads use the current text. The formats Build parses (plan and proposal json, screen drafts) are appended separately, so an edit can't break them. Repository guidance (`AGENTS.md`, this page, `build-workspace.md`, `video-editor/AGENTS.md`) and skills (`.agents/skills/*/SKILL.md`) are reported by the Mac when they change and shown read-only; changing them is a task, so it lands on a branch.

## Work stories

The owner reads Build on an iPad, so each piece of work reads as a short story in plain language, not as code, commit hashes or build IDs: the **concept** (what it is and why), what was **achieved**, **how it works** (what a user sees and does) and what's **next** in that area, plus the product **area** (for example Business data, Onboarding, Studio Library, Build), which places the work in the Product list. Opening a feature shows its story; each piece of work under it opens to its own story (when different), outcome and status, with branches, threads, reports and evidence under **Technical details**, collapsed.

- **Where it lives:** `checkpoint.story` on the BuildJob (`lib/build/story.ts`, zod-validated: area up to 60 characters, concept up to 600, at most 12 achieved, 12 how-it-works and 8 next bullets of up to 280 characters; backticks and commit hashes are stripped). Not the spec: the spec is the approved, immutable scope, and a story is description that changes as work moves on. No new table. Setting a story never bumps the record's revision, so approvals and external revisions stay valid. The server keeps the story whenever the worker or an external report rewrites the checkpoint.
- **From tasks:** the "Doing a task" playbook asks every report to end with a "Story:" section (Area, Concept, Achieved, How it works, Next) before "Decisions:". On completion the server parses it (`storyOf`) into the record, keeping the previous area if the report gives none. Long reports keep their start and end, so the story survives truncation.
- **From anywhere else:** the owner action `{"action":"story","id","story"}` on `/api/build`, and the same command on `/api/build/external` with the worker credential (client: `scripts/build-external.ts`, also with `--database`). External reports can carry `story` too, and an optional `key` so one T3 thread can report several pieces of work (`external-t3:<thread>:<key>`).
- **Seeding:** `scripts/build/seed-stories.ts` (dry run by default, `--apply` to write) writes the stories for Business data consolidation, Business onboarding, Studio Library and Build, registering the missing ones as external work.

## The product list

One list, organised by what the product is rather than by work state, so it stays readable with hundreds of entries. It is derived on every load from the existing tables (`lib/build/features.ts`, no model call, no new table, no stored mapping) and shows each thing once:

- **Entries.** Feature records (BuildNode `kind: "feature"`: concepts such as `concept-continuous-research`, and features confirmed from a screen description); story areas of work records that match no record (for example Studio Library, Onboarding, Business data, Build); pages that have work but no area; background processes (each `app/api/cron/*/route.ts` and `lib/queue/*.ts` worker, one entry per name); and technologies.
- **Work belongs to exactly one entry**, in this order: a feature record it names in `nodeIds`; an entry whose name equals its story area (so a record with area "WhatsApp" lands on the WhatsApp technology); its story area as a feature of its own; the page it names, or the page importing a file it names; otherwise itself, under its title. Dropped work is left out.
- **Status.** Doing now (amber) when any attached work is approved, running, in review, failed, stuck or merging; Done (green) when there is finished work and nothing open; Ideas (grey) when there are only suggestions, or a concept nobody has started. Processes, technologies and features confirmed from a screen exist, so with no work they are Done. Done is hidden until **Show done**.
- **Technologies** are recognised from file paths only (`technologies` in `features.ts`: AI, WhatsApp, Google, Microsoft, Puppeteer, Web scraping, Old CRM, GoHighLevel, SMS, Mac companion, Clerk, Cloudflare). An entry uses a technology when one of its files matches: scope files for work, linked files for feature records, a page or process and what it imports two steps deep. Add a technology by adding a line there.
- **Area and app** come from the entry's pages and files: Studio → Substo; CRM and the public website → Estio (Substo sites → Substo); Platform (Build, onboarding, business data, accounts) → both. Filters: search, app, kind, technology, status and area.
- **Opened**, an entry shows its story (from the record covering the most of it), the technologies it uses (tap to filter), and collapsible **Work**, related features, pages, background processes, what uses it (for a process or technology) and files. Addresses, file paths and record IDs appear only there. `#<record id>` links (returned by the external-work API) open the entry holding that record.
- **Merged work** says "Merged and deployed" or "Merged, not deployed yet" only when the server can read the live release manifest written by the owned deploy (`current-release.json`: the live revision and when it was published; `BUILD_RELEASE_MANIFEST` overrides the path). Merged work is deployed when the live revision is its merge commit or was published after the merge, because every deploy ships the then-current release branch. Without the manifest it just says "Merged".

## Usage, merge and memory

- **Usage.** Every 5 minutes the Mac worker reads remaining Codex and Claude allowance through QuotaCell's bundled helper (`CodexBarCLI usage --source cli`, QuotaCell's own environment, no Keychain, no model call; `lib/build/usage.ts`). The header shows one gauge per subscription (the lowest of the session and weekly windows, as in QuotaCell; tap for windows and resets). Routing prefers the subscription with the most allowance left (10% bands), treats 3% or less as used up, holds the daily review and autopilot below 15%, and clears a recorded limit automatically once a fresh reading shows allowance again. Readings older than 30 minutes are ignored. No cost estimates.
- **Which model talks.** A new conversation uses Auto (an allowed Hard model with the most allowance left) unless the owner picks one from the "Model" chip; the conversation shows "Talking with …". A thread keeps its model; to switch, start a new conversation.
- **Merge from the page.** A verified result shows **Merge** (accept and merge) or **Accept, merge later** (Merge stays on the work item inside its feature). The Mac first checks the files are exactly what was reviewed, commits them on the task branch, and merges into `release/studio-go-live` in a temporary detached worktree, so the owner's checkout is never switched. The merge is pushed as a fast-forward of the release branch (a moved branch is merged again, never overwritten), and the owner's checkout fast-forwards when it is on that branch and clean. A conflict goes to an agent in its own T3 thread ("Merge: …", an allowed Hard model). It merges, resolves keeping both sides and commits; Build pushes only if the result is a merge of exactly the release tip and the task, has no conflict markers, and changes no file the task didn't. Clean merges use no model. Deploy stays with the owner. Code: `lib/build/merge.ts`, merge loop in `scripts/build-worker.ts`.
- **Product memory.** A living record kept by Build with no model call: what was accepted, merged and redone (with the note), what was decided in conversations (agents add `{"remember":[…]}` when the owner states a lasting preference), and the owner's own notes. New conversations get up to 4,000 characters of it, tasks up to 1,500: pinned notes first, then the latest. Shown under Playbook › Product memory, where the owner can add, pin and remove entries (`lib/build/memory.ts`).

## The loop

```
notice ──► propose ──► approve ──► implement ──► review ──► feedback
(daily     (Build      (owner;     (T3 thread,   (owner     (next attempt /
 review,    card)       later       fenced        looks at    new proposal)
 owner)                 policy)     worktree)     the branch)
```

- **Talk:** the owner's own ideas start as a conversation (see Talk) and become started tasks.
- **Notice:** the opt-in daily read-only review checks one stale screen per day (a screen linked to an updated watch-list item goes first). Every review ends with up to three structured proposals, which become **unapproved cards** automatically. A daily review is then marked done, because its cards are the output. The owner can also add ideas.
- **Propose:** a card with outcome, reason, scope files and acceptance criteria. On creation the server assesses difficulty (`assessDifficulty` in `lib/build/contract.ts`) and picks the model.
- **Approve:** one click by the owner, or **policy auto-approval** (see Capabilities). Autopilot is Off / Watching (record only) / On, set in Settings. Watching marks each new card "Policy would approve" or "needs you (reasons)" without acting.
- **Implement:** the worker claims the card and starts a T3 thread at the approved commit. When the thread is idle, the fence verifies the result.
- **Review and feedback:** the card shows the result. The owner either **accepts** or presses **Redo…** and writes what should change. A redo is a fresh approval of the same scope. The worker sends only the note to the **same T3 thread** in the same worktree, so the model keeps its context, tokens stay low, and the whole conversation is visible in T3. Failed results can be redone the same way. Merge and deploy remain manual (`deploy-local-build.sh`).

## Capabilities

| Capability | Status | What the system decides | What you decide | On the page |
|---|---|---|---|---|
| Talk | Live | Model for the conversation; difficulty and model per task; resumes the queue on Start; archives a conversation when all its work is done | What you want; Start; Done with this conversation | Talk to Build (side sheet) |
| Needs you | Live | Collects only what waits on you: results, questions, failures, stuck tasks, suggestions, screen drafts, watch updates, setup gaps | The decision shown inline | Needs you |
| Experience map | Live | Screens from routes; stale marking on code changes | Nothing; ask in Talk to change a screen | The app |
| Daily review | Live (opt-in) | Which screen; its model; up to three suggestions | Turn it on | Settings |
| Findings become suggestions | Live | Validation, difficulty, model; closes the daily review | Start or Not now | Needs you |
| Difficulty and model choice | Live | Everything | Nothing | Technical details of each work item |
| Autopilot (policy auto-approval) | Off by default | Judges each new suggestion: implementation, Routine, 3 files or fewer, no sensitive area, 5 criteria or fewer, an allowed model available, 3 a day | Off / Watching / On | Settings |
| T3 execution | Live | Starts, watches and stops threads | Watch, steer or answer if you like | T3 sidebar |
| Safety fence | Live | Verifies every result | Nothing | Result details |
| Feedback and redo | Live | Re-approves the same scope and continues the thread | Accept, or Redo with a note | Needs you |
| Allowed models | Live | Keeps the catalog current | Allow models once (everyday or hard tasks) | Settings |
| Watching for ideas | Live | Daily GitHub update checks that feed the daily review | Add a link and why; mark adopted or not for us | The app › Watching for ideas |
| Screen descriptions | Live | Drafts purpose, journey and up to 5 features in the daily review's own run; undescribed screens go first | Yes or No | Needs you |
| Playbook | Live | Appends the formats it parses | Edit the instructions; read guidance and skills | Playbook |
| Product list | Live | One entry per feature, page with work, background process and technology; attaches every work record to exactly one entry; derives status (Ideas / Doing now / Done) and technologies; hides Done until asked | Filter by area, app, kind, technology, status, or search | Product |
| Work stories | Live | Reads the "Story:" section of every task report into the record; keeps it when the record is updated | Nothing; sessions outside Build set stories through the API | Product |
| Usage gauges and usage-aware routing | Live | Reads allowance every 5 minutes; routes to the subscription with most left; holds background work when low | Nothing | Header |
| Merge assist | Live | Verifies, commits, merges and pushes; an agent resolves conflicts, checked before push | Press Merge | Needs you, Product |
| Product memory | Live | Records accepted, merged, redone and decided work; gives it to new conversations and tasks | Add, pin or remove notes | Playbook |
| Deploy | Stays with you | Never deploys | Deploy | `deploy-local-build.sh` |

Auto-approved cards carry `approval.actor = "policy"` and `approval.auto = true`. They bind the same revisions as an owner approval and show "Approved by policy". The policy is `autoApprovable` and `autoApprovePolicy` in `lib/build/contract.ts`. It is evaluated on every new proposal (owner or review) by `autoDecide` in `lib/build/store.ts`. Widen it only after Watching shows good judgement.

## The experience map

The product as users see it, not as files: **section › area › screen › feature**.

- **Sections:** CRM (`/admin`), Studio (`/studio`), Public website (`/[domain]`, `/sites`, `/widget`), Platform admin (`/admin/platform`), Account & onboarding (everything else). Both apps (Estio and Substo, chosen by domain) share every screen.
- **Screens** are derived from every Next.js `page.tsx` route by `lib/build/experience.ts`, with no model call. For example `/admin/conversations/[id]` becomes "CRM › Conversations › Detail". On 2026-11-03 this produced 142 screens in 61 areas.
- **Features and journeys** sit under screens. The daily review drafts them as it reviews each screen, in the same run with no extra model turn, and screens with no description go first. A draft is kept separately (`draft`) and is never approved intent. **Confirm** makes it the screen's description and approved intent and adds its features as feature records (`contains` links). **Discard** removes it. The owner can still add or edit features by hand.
- **Code files** stay attached as evidence and are not shown. Import links let a change to shared code mark every screen that uses it stale.
- On the page The app is a list of sections; a section opens to its pages (names only, never addresses), a page opens to its description, its features (each opens in the Product list), work touching it, rules and watched links, with its address shown there. Changes go through Talk. Owner renames are kept (`naming: "owner"`). The worker re-scans whenever the repository changes, even while the queue is paused, because scanning is read-only and costs no tokens.

## Models

- The worker reports T3's current model catalog on every poll, read from T3's own model manifest. New releases and newly enabled providers appear automatically as **Not allowed**.
- The owner allows models once in Settings, each for everyday (Routine) or hard tasks. Guidance notes in `lib/build/model-guidance.ts` suggest a level. Only approved models ever run.
- Routing picks an approved model at the task's assessed difficulty, then any other approved model. When a subscription limit is hit, it falls back to the other provider.
- Effort is T3's default for each model, because the T3 command line cannot set it.

## How to work on the factory

- **Propose a change** in Talk on the Build page, or in conversation. Say what friction it removes and whether the system could decide it instead of the owner.
- **Agree before building.** The owner approves direction (see the roadmap). Record each decision in the decision log below and, where relevant, in `how-the-app-works.md`.
- **Keep it small and reusable.** Reuse Build's tables (BuildNode, BuildEdge, BuildJob, BuildControl) before adding new ones. Keep one name per concept.
- **Keep the page simple.** No new tabs or forms; anything the owner should understand goes here, and the page stays conversation-first. Every factory change updates this page (Capabilities, roadmap, decision log) and, if the loop changes, `lib/build/factory-guide.ts`.
- **Verify, then deploy.** Run the focused tests (`npx tsx --test lib/build/*.test.ts`). Deploy with the owned workflow from the isolated release checkout (see current status), and update [Build workspace](build-workspace.md) with the evidence.

## Roadmap

Done: T3 executor; catalog-driven model approval; system-decided difficulty, model and fallback; experience map from routes; opt-in daily review; watch list; feedback on results; review findings become proposals; policy auto-approval (record-only first); screen descriptions drafted by the daily review; conversation-first redesign (Talk, one page, Playbook) replacing the tabs and forms; usage gauges and usage-aware routing; merge assist with agent conflict resolution; product memory.

The planned roadmap is complete. Candidates for next, none agreed yet:

1. **Learning from feedback** ("prompts over settings", from DeepSeek): recurring redo and accept notes become standing guidance added to future prompts, which the owner can review.
2. **Widen auto-approval** once Record only has shown good calls, for example to small reviews or a larger daily budget.
3. **Screenshots on results:** each task attaches screenshots of the screen it changed, so results can be judged from the iPad.
4. **Notifications** (deferred by the owner, 2026-11-04): a single phone notification when something new appears under Needs you.

## Inspiration and watch list

External references and what we take from them. **Live in Build → The app › Watching for ideas** (built 2026-11-03):
- Add any link (GitHub, YouTube, any site) with why it's interesting. Each item shows why it's here and which screens it could improve. Suggested references can be added in one click.
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
- 2026-11-04: Owner rejected the tabbed, form-based page as over-engineered. Build is conversation-first: Talk replaces forms, one page replaces six tabs (Needs you, The app, Progress, Playbook), settings move behind one button, and explanations live here rather than in the page. The agents' instructions are editable on the page; repository guidance and skills are shown read-only.
- 2026-11-04: Usage from QuotaCell's helper drives routing (no cost estimates). The conversation model is Auto with an optional choice per new conversation. Merge from the page: Build merges and pushes to the release branch; an agent resolves conflicts and Build checks its result before pushing; deploy stays manual. A product memory kept by Build and conversations goes into new threads. Notifications deferred; the worker stays on the local Mac.
- 2026-11-04: No file-count limit on tasks: scope lists files or folders and the fence enforces it; size only affects difficulty and autopilot. Plans contain independent tasks only; dependent steps are planned after a merge.
- 2026-11-06: Progress cards read as stories (concept, achieved, how it works, next, area), with technical evidence collapsed. Stored on the record's checkpoint, not the spec or a new table; parsed from a "Story:" section in every task report; settable by owner or worker for any record, including external work. Cards show area and status; difficulty and model moved into Technical details. No grouping by area beyond the area label, to keep the page simple.
- 2026-11-07: The Progress board (Next · Now · Done) is replaced by one Product list organised by what the product is: features, pages with work, background processes and technologies, each shown once with a status (Ideas grey, Doing now amber, Done green, hidden by default). Derived from existing records with no new table or stored mapping; work attaches to exactly one entry; technologies come from file paths. The app lists section › page › features without addresses. Merged work only says "not deployed" when the live release manifest shows it. The header drops the autopilot and model-count pills (both live in Settings) and Playbook is collapsed.
- 2026-11-07: Talk moves out of the way: a single "Talk to Build" line, conversations in a side sheet with Close and "Done with this conversation", archived ones under Past conversations (reopenable). Conversations archive themselves when every task they started is finished, recorded on the plan JSON. Conversations and Product work link both ways.
- 2026-11-04: Results show the agent's own decisions ("check before merging") and every changed file, readable on the page. Agreed architecture decisions are kept as pinned product memory.


- 2026-11-07: Work subcards open their linked execution conversation through the existing Mac relay; returned-result replies use the same scoped Redo approval, and the planning conversation remains linked.

## Externally executing T3 work

Owner-authorized work already running in T3 can be recorded without dispatching another implementation. `lib/build/external.ts` writes the existing BuildJob ledger under `external-t3:<thread UUID>` (or `external-t3:<thread UUID>:<key>` when one thread reports several pieces of work), with immutable scope, revision-checked updates and bounded status/evidence history. External states never enter the worker claim/lease lifecycle, auto-approval or merge flow. The Product list shows these as reported external work; reports are not independent verification or release evidence. Stale reports retain their timestamp rather than pretending a live heartbeat.

An operator posts JSON to `/api/build/external`, authenticated with the existing private worker bearer credential. `node --env-file=.env.build-worker.local --import tsx scripts/build-external.ts < command.json` is the client. For registration before the endpoint is deployed, an operator with existing database authority can use `node --env-file=.env.prod --import tsx scripts/build-external.ts --database < command.json`. Never copy credentials into commands or reports. Neither path queues work or authorizes merge/deploy.

Registration requires `threadId`, `spec` (the existing jobSpec), `status` and `note`, and may add `key` and a plain-language `story` (see Work stories). Updates require `threadId`, the last returned `revision`, `status`, `note`, and optionally `evidence` (required for `review` or `done`); omit `spec`. Status is working / blocked / review / done / failed. The returned ID and dashboard fragment are stable. External done means the executor reports completion, not owner acceptance, merge or deployment.

## Canonical integration and deployment

Build still merges reviewed task worktrees into `release/studio-go-live` with fast-forward pushes. A dirty shared checkout is preserved. Deployment uses the clean dedicated canonical checkout, never a task/sibling branch; production ancestry and current remote tip must both survive. The owned script enforces immutable inputs, a server-held lease, drift checks, rollback and a post-soak release manifest. [Release workflow](release-workflow.md) owns the procedure. No second dispatcher or CI platform is introduced.

## Conversation sync and plan cards (2026-11-07)

Open idle/waiting conversations are read from T3 alongside active turns: at most five of each per poll, oldest synced first, with the existing worker in-flight guard. Archived conversations stay untouched. This uses no model calls. A concrete scoped plan creates stable proposed BuildJobs; Product and the conversation show the same records. Exact initial `About "Name" (feature):` context attaches to one existing feature; directory scopes resolve existing source records. A replacement plan drops only earlier unstarted proposals and preserves started work.

Start on a task or plan uses the existing approval/dispatch path. A new provenance-bearing T3 user message exactly `Start` or `Start it` can approve an already saved preceding concrete plan once, including while its reply is still running. The most recent concrete plan must match the saved tasks; interim assistant text is never a plan. Historical messages are baselined, and Start before plan creation never grants later approval. The reported Onboarding conversation therefore remains Ready to start; this fix does not implement onboarding.

Acceptance: regression checks cover idle/waiting selection and the preceding-plan/user/provenance/replay boundary. Manual acceptance still requires signed-in Product/task linkage and desktop/mobile/keyboard checks; no production tasks were started during implementation.
