#!/usr/bin/env bash
# Rolls the Studio worker back to the prior release (or leaves it stopped when the
# prior release has no Studio worker, e.g. first activation). Never touches the
# database, media or keys: Studio migrations are forward-only and additive.
set -uo pipefail
studio_active=${1:-}
studio_target=${2:-}
studio_worker=${3:-estio-studio-worker}
pm2 delete "$studio_worker" >/dev/null 2>&1 || true
if [ -z "$studio_active" ] || [ "$studio_active" = "$studio_target" ] || [ ! -f "$studio_active/scripts/studio-worker.ts" ]; then
    echo 'No prior Studio worker release; Studio worker left stopped (jobs stay queued under lease recovery).'
    exit 0
fi
if env -i PATH="$PATH" HOME="$HOME" PM2_HOME="${PM2_HOME:-$HOME/.pm2}" bash -s -- "$studio_active" "$studio_worker" <<'STUDIO_RESTORE'
set -euo pipefail
cd "$1"
if [ -f .env ]; then set -a; . ./.env; set +a; fi
NODE_ENV=production PROCESS_ROLE=studio-worker STUDIO_WORKER_INSTANCE="$(node -e 'process.stdout.write(require("node:crypto").randomUUID())')" \
    pm2 start npm --name "$2" --cwd "$1" --kill-timeout 30000 -- run start:studio-worker
STUDIO_RESTORE
then
    echo 'Prior Studio worker restart requested (not proof of readiness).'
    exit 0
fi
echo 'Prior Studio worker restart failed; operator recovery is required.' >&2
exit 1
