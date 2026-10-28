#!/usr/bin/env bash
# Called by the owned deploy workflow with target .env already exported.
# Never call this helper as a read-only doctor: it starts/replaces the Studio worker.
set -euo pipefail
studio_target=$1
studio_active=${2:-}
studio_worker=${3:-estio-studio-worker}
cd "$studio_target"
studio_tsx="$studio_target/node_modules/.bin/tsx"
# Fail before worker replacement or public traffic activation.
NODE_ENV=production "$studio_tsx" -e 'import { assertStudioMergeReady } from "./lib/studio/merge-gate"; assertStudioMergeReady()'
if "$studio_tsx" scripts/studio-readiness.ts --mode=required; then
    :
else
    studio_status=$?
    if [ "$studio_status" -eq 2 ]; then
        echo 'Studio is dormant; no worker activation required.'
        exit 0
    fi
    exit 1
fi
# Failure here leaves the old worker and public traffic untouched.
"$studio_tsx" scripts/studio-readiness.ts --mode=dependencies
studio_instance=$(node -e 'process.stdout.write(require("node:crypto").randomUUID())')
if pm2 describe "$studio_worker" >/dev/null 2>&1; then pm2 delete "$studio_worker"; fi
studio_failed=0
NODE_ENV=production PROCESS_ROLE=studio-worker STUDIO_WORKER_INSTANCE="$studio_instance" \
    pm2 start npm --name "$studio_worker" --cwd "$studio_target" --kill-timeout 30000 -- run start:studio-worker || studio_failed=1
if [ "$studio_failed" -eq 0 ]; then
    # Each probe is bounded by the readiness service; at most six probes and five short delays.
    for studio_attempt in 1 2 3 4 5 6; do
        if studio_started_after=$(node -e 'try{const rows=JSON.parse(require("node:child_process").execFileSync("pm2",["jlist"],{encoding:"utf8",timeout:5000,maxBuffer:4194304})).filter(e=>e.name===process.argv[1]);const up=rows[0]?.pm2_env?.pm_uptime;if(rows.length!==1||rows[0].pm2_env?.status!=="online"||!Number.isSafeInteger(up)||up<=0)process.exitCode=1;else process.stdout.write(String(up))}catch{process.exitCode=1}' "$studio_worker") && \
            STUDIO_WORKER_INSTANCE="$studio_instance" STUDIO_WORKER_STARTED_AFTER="$studio_started_after" "$studio_tsx" scripts/studio-readiness.ts --mode=worker; then
            echo 'Studio target release has a fresh, capable, claim-ready worker.'
            exit 0
        fi
        if [ "$studio_attempt" -lt 6 ]; then sleep 2; fi
    done
fi
# Public traffic has not switched. Restore the prior release's worker where available.
echo 'Studio readiness failed before traffic switch; stopping candidate worker.' >&2
bash "$studio_target/scripts/studio-worker-restore.sh" "$studio_active" "$studio_target" "$studio_worker" || true
exit 1
