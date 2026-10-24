---
name: deploy-estio
description: Prepare, run, verify, and report an Estio production deployment through deploy-local-build.sh. Use for deployment requests, release preflights, post-deploy verification, or deployment failure analysis; do not use for Vercel deployments.
---

# Deploy Estio

Deploy the current Estio working state through the repository-owned blue/green workflow. Caddy owns TLS and reverse proxying; Cloudflare provides DNS and edge proxying; the application runs on the self-managed Hetzner server. Never introduce Vercel deployment or cron assumptions.

## Establish the release state

Before any production mutation:

1. Read `AGENTS.md` and inspect `deploy-local-build.sh` if it changed since the skill was last used.
2. Report the current branch, commit, upstream relationship, and `git status --short`.
3. Treat the working tree as deployable input: the script uploads the local tree, so uncommitted changes can reach production. Identify every relevant modified or untracked file. Do not silently deploy unrelated changes.
4. Confirm `Caddyfile` and `.env.prod` exist without printing secrets. Check that required local dependencies are available.
5. Run targeted tests appropriate to the changed area. The deployment script performs the production build itself; avoid a redundant full build unless the risk or recent failure justifies it.

If the branch, commit, or dirty-tree scope is surprising, stop before mutation and obtain direction.

## Choose the schema mode

`deploy-local-build.sh` supports `migrate-only`, `db-push`, and `migrate-then-push`. Its repository default can fall back to `db push --accept-data-loss`.

For an agent-run deployment, default to `PRISMA_SCHEMA_SYNC_MODE=migrate-only`. Use `db-push` or `migrate-then-push` only when the user explicitly approves the possibility of a schema sync that accepts data loss. Include the selected mode in the approval summary.

## Approval gate

Immediately before running the deployment, show:

- branch, commit, and included working-tree changes;
- tests completed and any skipped checks;
- selected Prisma schema mode and its risk;
- the exact deployment command;
- expected production effects, including backup, upload, PM2 process changes, Caddy switch, and background-service restarts or checks.

Obtain explicit approval for this production mutation. A request to inspect, build, prepare, or diagnose is not deployment approval.

## Execute the owned workflow

Run the repository script rather than recreating its internals:

```bash
PRISMA_SCHEMA_SYNC_MODE=migrate-only ./deploy-local-build.sh
```

Use the approved schema mode if different. Do not detach the process or conceal output. The script owns backup, local build, artifact upload, dependency installation, schema sync, blue/green cutover, Caddy validation, soak checks, automatic traffic rollback on switch failure, and service checks.

If the script fails, preserve the failure output and gather read-only evidence. Do not rerun, manually switch traffic, delete a slot, change Caddy, or repair production unless the user authorizes that separate action.

## Verify and report

After a successful script exit, verify proportionately:

- `https://estio.co/api/health` responds successfully;
- `https://estio.co/api/version` matches the intended release when that endpoint is available;
- PM2 shows the expected web slot and required background services healthy;
- the public application serves through Caddy and Cloudflare;
- changed user-facing or operational behavior passes a focused smoke test.

Return a concise report containing the deployed commit and dirty-tree state, schema mode, checks run, active slot or process when known, health/version results, service state, warnings, and rollback status. Never include secret values.
