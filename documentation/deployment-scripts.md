# Deployment Scripts

## Standard Deploy

Use `deploy-local-build.sh` for production deploys. The script builds locally, uploads the target release, runs the configured Prisma schema sync mode, switches traffic, and keeps the WhatsApp Web Bridge worker as the only linked-device WhatsApp runtime.

Evolution containers are no longer part of deployment.

Redis is still an app dependency for queues and realtime. Standard deploys expect Redis on `127.0.0.1:6379`; when Docker is available and nothing else owns that port, deploy keeps a neutral `estio-redis` container running.

Use `scripts/ops/audit-retired-evolution-runtime.sh` for one-off decommission audits. It is intentionally not part of standard deploys.

## WhatsApp Runtime Checks

After deploy, verify the Web Bridge worker:

```bash
pm2 status estio-whatsapp-web-bridge
pm2 logs estio-whatsapp-web-bridge --lines 100
```

The worker must use a persistent `WHATSAPP_WEB_BRIDGE_SESSION_DIR`, for example `/home/martin/whatsapp-web-sessions`, so QR sessions survive app release swaps.

## Database Schema Sync

The deploy script supports:

- `PRISMA_SCHEMA_SYNC_MODE=migrate-only`
- `PRISMA_SCHEMA_SYNC_MODE=db-push`
- `PRISMA_SCHEMA_SYNC_MODE=migrate-then-push` (default)

For this removal, ensure `npx prisma migrate deploy` applies `20260516120000_remove_evolution_api`.
