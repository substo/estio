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

Read [architecture and decisions](documentation/how-the-app-works.md) and [current status and tasks](documentation/current-status.md) first. Historical checkpoints are evidence, not current instructions. Studio has no legacy URL compatibility requirement; preserve data/media and recovery safeguards.

## Video editor

- `video-editor/` is the native macOS video editor (Swift, SwiftPM) used by both apps. It is not part of the Next.js build or the server deploy. Follow `video-editor/AGENTS.md` when working there.
