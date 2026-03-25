# Deployment Scripts Guide

**Last Updated:** 2026-03-25

This project uses a Blue/Green deployment layout on the production server:

- `estio-app-blue` on port `3001`
- `estio-app-green` on port `3002`
- `estio-scrape-worker` as a dedicated headless BullMQ consumer (no HTTP port binding)
- Symlink `estio-app` points to the currently live slot
- Caddy routes public traffic to the active slot

## Recommended Script

## `deploy-local-build.sh` (Primary)

This is the default and recommended deploy path.

What it does:

1. Runs `scripts/backup.sh` locally.
2. Detects active slot (`blue` or `green`) and chooses the idle slot as target.
3. Builds locally using `.env.prod` -> `.env.production.local`.
4. Uploads artifacts to target slot (excluding `.env*`, `.git`, docs, caches).
5. Uploads `.env.prod` to target slot as runtime `.env`.
6. Ensures PM2 log rotation is configured via `scripts/setup-log-rotation.sh`.
7. Runs `npm ci --omit=dev --legacy-peer-deps` and `npx prisma@6.19.0 generate` on target.
8. Applies Prisma schema sync guard before runtime cutover (`PRISMA_SCHEMA_SYNC_MODE`).
9. Starts the target PM2 process and health-checks `http://127.0.0.1:<target-port>/api/health`.
10. Updates Caddy upstream to target port and reloads Caddy.
11. Starts dedicated scrape worker via `npm run start:scrape-worker` (headless runtime).
12. Verifies scrape worker readiness (`pm2 online` + fresh Redis heartbeat) before completing deploy.
13. Keeps old slot running for a drain window, then deletes it.

### Prisma Schema Sync Guard (Mar 2026)

`deploy-local-build.sh` now enforces database/schema compatibility **before** switching live traffic.

- Env knob: `PRISMA_SCHEMA_SYNC_MODE`
- Default: `migrate-then-push`
- Supported modes:
  - `migrate-only`: run `prisma migrate deploy`, fail hard on migration errors.
  - `db-push`: run `prisma db push --skip-generate --accept-data-loss`.
  - `migrate-then-push`: try migrate first, then automatically fall back to db push if migration history drift blocks deploy.

This guard prevents runtime crashes caused by app/schema mismatch (for example Prisma `P2022` missing-column errors after cutover).

### Runtime Start Behavior (Important)

`deploy-local-build.sh` starts web slots with:

```bash
pm2 start npm --name <estio-app-color> -- start
```

It starts the dedicated scraping worker with:

```bash
pm2 start npm --name estio-scrape-worker --cwd /home/martin/estio-app -- run start:scrape-worker
```

This worker does not run `next start` and does not bind an HTTP port.

### Deploy Guardrails (Fail-Safe)

- Preflight blocks deploy when unmanaged Node/Next processes are detected on managed app paths or managed ports.
- The script does **not** auto-kill unknown processes.
- Operator must clean offending PIDs and rerun deploy.
- Deploy fails hard if scrape worker readiness cannot be proven after start.

### Optional Evolution Restart

By default, Evolution containers are **not restarted** during app deploys.

- Interactive prompt default: `No`
- Non-interactive default: `false`
- Override:

```bash
RESTART_EVOLUTION_CONTAINERS=false ./deploy-local-build.sh
RESTART_EVOLUTION_CONTAINERS=true ./deploy-local-build.sh
```

### Drain Window

Old process drain is controlled by `DRAIN_SECONDS`:

- Default: `900` seconds
- Example immediate cleanup:

```bash
DRAIN_SECONDS=0 ./deploy-local-build.sh
```

## Other Scripts

## `deploy-direct.sh` and `deploy.sh`

These scripts are now intentionally blocked for production use and exit with an instruction to use `deploy-local-build.sh`.

## Blue/Green Cutover Sequence

For each deploy run:

1. Start target slot process (`estio-app-blue` or `estio-app-green`).
2. Verify target health (`/api/health`).
3. Point Caddy to target port (`3001` or `3002`).
4. Keep old slot alive temporarily (drain).
5. Save PM2 process list.

This avoids hard downtime and reduces request drops during cutover.

## Runtime Version-Skew Protection

To reduce post-deploy client crashes (for stale Server Action IDs), runtime guards are now in place:

- `/api/version` returns runtime build id.
- `LiveDeployGuard` polls version and shows a refresh banner when build changes.
- `global-error.tsx` auto-reloads once (cooldown-based) when stale Server Action mismatch is detected.

This lowers cases where users must manually refresh after deploy.

## Post-Deploy Verification

Run these checks after deployment:

```bash
ssh root@138.199.214.117 "curl -sSI https://estio.co/"
ssh root@138.199.214.117 "curl -sSI https://estio.co/admin/conversations"
ssh root@138.199.214.117 "curl -sSI https://downtowncyprus.site/"
```

Expected:

- Main site: `200`
- Protected admin route: `307` to `/sign-in` when signed out
- Tenant site: `200`

Check PM2 process state:

```bash
ssh root@138.199.214.117 "pm2 list"
ssh root@138.199.214.117 "pm2 describe estio-app-blue"
ssh root@138.199.214.117 "pm2 describe estio-app-green"
ssh root@138.199.214.117 "pm2 describe estio-scrape-worker"
```

Tail logs (active slot):

```bash
ssh root@138.199.214.117 "pm2 logs estio-app-blue --lines 120 --nostream"
ssh root@138.199.214.117 "pm2 logs estio-app-green --lines 120 --nostream"
ssh root@138.199.214.117 "pm2 logs estio-scrape-worker --lines 120 --nostream"
```

## Operational Notes

- `.env.prod` is the source of truth for deploy-local-build runtime env.
- Every deploy overwrites target slot `.env` from local `.env.prod`.
- `documentation/` is intentionally excluded from deploy artifact sync.
- Legacy single-process `estio-app` is removed by deploy-local-build when present.

## Recovery

If local workspace is broken, you can recover from server:

```bash
rsync -avz -e "ssh" \
  --exclude '.git' \
  --exclude 'node_modules' \
  --exclude '.next' \
  --exclude '.env' \
  root@138.199.214.117:/home/martin/estio-app/ ./
```

> Warning: this overwrites local files.
