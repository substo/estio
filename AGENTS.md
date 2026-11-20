# Estio Repository Guidance

## Runtime and hosting

- Estio is a Next.js application hosted on a self-managed Hetzner server.
- Caddy owns TLS termination and reverse proxying.
- Cloudflare provides DNS and edge proxying; Namecheap is the registrar.
- Estio is not hosted on Vercel. Do not introduce `vercel.json`, Vercel Cron, or Vercel deployment assumptions.
- Production deployments use `deploy-local-build.sh`.
- Production schedules are owned by `scripts/install-cron.sh` and the scripts it installs.

Provider-neutral Next.js route exports such as `maxDuration` are execution hints only and do not identify the hosting provider.

## Current project context

Read [architecture and decisions](documentation/how-the-app-works.md) and [current status and tasks](documentation/current-status.md) first. For the software factory (Build at `/admin/platform/build`), read [software factory](documentation/software-factory.md). Historical checkpoints are evidence, not current instructions. Studio has no legacy URL compatibility requirement; preserve data/media and recovery safeguards.

## AI workflow capabilities

Read [AI workflows](documentation/ai-workflows.md) before changing providers, AI routing or agent instructions. The bundled runtime contract is `lib/ai/workflow-capabilities.ts`; documentation alone is not model context. Keep operation-specific adapters, authority, funding, readiness, validation and prompt-capture tests aligned.

## Video editor

- `video-editor/` is the native macOS video editor (Swift, SwiftPM) used by both apps. It is not part of the Next.js build or the server deploy. Follow `video-editor/AGENTS.md` when working there.

## Studio product direction

Read [Studio product concept](documentation/studio-product-concept.md) before changing Studio navigation, Assistant modes, or creation. Source-led research and creation share the source page and its Assistant.

## UI design

Follow [UI design principles](documentation/ui-design-principles.md). The first viewport serves the page's primary task: collection screens put existing content and browsing controls first, with secondary creation disclosed through compact actions. This does not require every form to be a modal. Verify populated/empty/mobile and keyboard disclosure states; do not surface idle automation telemetry.

## Release integration

Follow [one canonical release](documentation/release-workflow.md). Task worktrees merge into `release/studio-go-live`; deploy only its clean, committed, freshly fetched tip through the owned migrate-only script. Never deploy a sibling feature or dirty root. Preserve both parent changes and migrations. The server lease, deployed revision ancestry, immutable-input checks and release manifest are mandatory; do not bypass or delete locks. The shared root is a working branch; the dedicated canonical checkout owns deployments.

At task closeout, review the task worktree using the [local worktree closeout procedure](documentation/release-workflow.md#local-worktree-closeout). Once the work is pushed and integrated, retire the clean, idle task checkout or clear its verified build output if the checkout is still needed. Preserve active sessions, uncommitted or unpublished work, the shared root, the canonical checkout, and any running companion's checkout. Report what was reclaimed or why the checkout was kept.
