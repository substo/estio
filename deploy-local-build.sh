#!/bin/bash

# Local Build Deployment Script
# Builds LOCALLY to avoid Server OOM/Thrashing, then uploads artifacts.

set -e

SERVER="root@138.199.214.117"
BASE_DIR="/home/martin"
SYMLINK_NAME="estio-app"
SYMLINK_PATH="$BASE_DIR/$SYMLINK_NAME"
BLUE_DIR="$BASE_DIR/estio-app-blue"
GREEN_DIR="$BASE_DIR/estio-app-green"
BLUE_PORT=3001
GREEN_PORT=3002
APP_NAME_PREFIX="estio-app"
SCRAPE_WORKER_APP_NAME="estio-scrape-worker"
VIEWING_RELAY_APP_NAME="estio-viewing-live-relay"
VIEWING_RELAY_DEFAULT_PORT=8788
LEGACY_SCRAPE_WORKER_PORT=3010
PRISMA_CLI_VERSION="${PRISMA_CLI_VERSION:-6.19.0}"
# Schema sync modes:
# - migrate-only: strict migration deploy, fail on any migration error.
# - db-push: force schema sync with db push.
# - migrate-then-push: try migrate deploy first, fall back to db push on drift/errors.
PRISMA_SCHEMA_SYNC_MODE="${PRISMA_SCHEMA_SYNC_MODE:-migrate-then-push}"

# Keep previous color process alive briefly after traffic switch to reduce abrupt cutovers.
# Override with DRAIN_SECONDS=0 for immediate cleanup.
DRAIN_SECONDS="${DRAIN_SECONDS:-900}"
# Verify proxy health for this many seconds after switch. Roll back on failure.
SWITCH_SOAK_SECONDS="${SWITCH_SOAK_SECONDS:-20}"
# Token identifies this deploy so stale delayed cleanups cannot delete the live slot.
DEPLOY_TOKEN="deploy-$(date -u +%Y%m%d%H%M%S)-$RANDOM"
DEPLOY_STATE_DIR="$BASE_DIR/.deploy-state"
CURRENT_DEPLOY_TOKEN_FILE="$DEPLOY_STATE_DIR/current-deploy-token"

echo "🚀 Starting LOCAL BUILD deployment to estio.co..."

# AUTOMATED BACKUP
./scripts/backup.sh

# SSH Multiplexing
SSH_CONTROL_PATH="/tmp/estio-deploy-mux-%r@%h:%p"
SSH_OPTS="-S $SSH_CONTROL_PATH"

echo "🔌 Setting up SSH multiplexing..."
ssh -M -S "$SSH_CONTROL_PATH" -fnNT $SERVER

cleanup() {
    echo "🔌 Closing SSH connection..."
    ssh -S "$SSH_CONTROL_PATH" -O exit $SERVER 2>/dev/null || true
}
trap cleanup EXIT

# Optional: Restart Evolution containers during this deploy?
# Default is NO to avoid disconnecting WhatsApp sessions on app-only deploys.
# Override non-interactively with: RESTART_EVOLUTION_CONTAINERS=true|false
RESTART_EVOLUTION_CONTAINERS="${RESTART_EVOLUTION_CONTAINERS:-}"
if [ -z "$RESTART_EVOLUTION_CONTAINERS" ]; then
    if [ -t 0 ]; then
        echo "🐳 Evolution API containers restart is optional (recommended: skip for app-only deploys)."
        read -p "🔁 Restart Evolution API containers during this deploy? [y/N] " -r RESTART_EVOLUTION_REPLY
        echo
        case "$RESTART_EVOLUTION_REPLY" in
            [Yy]|[Yy][Ee][Ss])
                RESTART_EVOLUTION_CONTAINERS="true"
                ;;
            *)
                RESTART_EVOLUTION_CONTAINERS="false"
                ;;
        esac
    else
        RESTART_EVOLUTION_CONTAINERS="false"
        echo "🐳 Non-interactive shell detected; skipping Evolution container restart by default."
    fi
fi

# Step 0: Determine Active/Target Slots
echo "🔍 Checking server state..."
CURRENT_SYMLINK_COLOR=$(ssh $SSH_OPTS $SERVER "if [ -L '$SYMLINK_PATH' ]; then LINK=\$(readlink '$SYMLINK_PATH'); if [[ \"\$LINK\" == *'-blue'* ]]; then echo blue; elif [[ \"\$LINK\" == *'-green'* ]]; then echo green; else echo none; fi; else echo none; fi")
CURRENT_CADDY_PORT=$(ssh $SSH_OPTS $SERVER "if [ -f /etc/caddy/Caddyfile ]; then grep -Eo 'reverse_proxy[[:space:]]+localhost:[0-9]+' /etc/caddy/Caddyfile | head -n1 | sed -E 's/.*:([0-9]+)/\\1/' || true; fi")

if [ "$CURRENT_CADDY_PORT" = "$BLUE_PORT" ]; then
    CURRENT_COLOR="blue"
elif [ "$CURRENT_CADDY_PORT" = "$GREEN_PORT" ]; then
    CURRENT_COLOR="green"
else
    CURRENT_COLOR="$CURRENT_SYMLINK_COLOR"
fi

if [ "$CURRENT_COLOR" != "$CURRENT_SYMLINK_COLOR" ]; then
    echo "⚠️  Detected slot mismatch (symlink=$CURRENT_SYMLINK_COLOR, caddy_port=$CURRENT_CADDY_PORT). Using caddy-derived active slot: $CURRENT_COLOR"
fi

case "$CURRENT_COLOR" in
    blue)
        ACTIVE_DIR=$BLUE_DIR
        ACTIVE_COLOR="blue"
        ACTIVE_PORT=$BLUE_PORT
        TARGET_DIR=$GREEN_DIR
        TARGET_COLOR="green"
        TARGET_PORT=$GREEN_PORT
        echo "🔵 Active: BLUE:${BLUE_PORT} -> 🟢 Target: GREEN:${GREEN_PORT}"
        ;;
    green)
        ACTIVE_DIR=$GREEN_DIR
        ACTIVE_COLOR="green"
        ACTIVE_PORT=$GREEN_PORT
        TARGET_DIR=$BLUE_DIR
        TARGET_COLOR="blue"
        TARGET_PORT=$BLUE_PORT
        echo "🟢 Active: GREEN:${GREEN_PORT} -> 🔵 Target: BLUE:${BLUE_PORT}"
        ;;
    *)
        ACTIVE_DIR=""
        ACTIVE_COLOR="none"
        ACTIVE_PORT=""
        TARGET_DIR=$BLUE_DIR
        TARGET_COLOR="blue"
        TARGET_PORT=$BLUE_PORT
        echo "⚪ Active: NONE -> 🔵 Target: BLUE:${BLUE_PORT}"
        ;;
esac

# Step 1: LOCAL BUILD
echo "🏗️  Building LOCALLY (Bypassing Server Limits)..."
# Ensure we have dependencies
if [ ! -d "node_modules" ]; then
    echo "📦 Installing Local Dependencies..."
    npm install --legacy-peer-deps
fi

# Create Production Env File for Build & Deploy
# Check for .env.prod
if [ ! -f .env.prod ]; then
    echo "❌ Error: .env.prod file not found!"
    echo "Please create .env.prod with production secrets before deploying."
    exit 1
fi

echo "✅ Found .env.prod"

# Use this for local build (forcing Next.js to use these vars)
cp .env.prod .env.production.local

# Run Build
echo "⚡ Running Next.js Build..."
# Clean previous build to prevent cache corruption
rm -rf .next

# We don't need to pass vars inline anymore; .env.production.local takes precedence
NODE_OPTIONS='--max-old-space-size=8192' npm run build

# Cleanup local override immediately after build to prevent accidents
rm .env.production.local

# Step 2: Prepare Target Directory
echo "📁 Preparing target directory ($TARGET_DIR)..."
ssh $SSH_OPTS $SERVER "rm -rf $TARGET_DIR || (echo '⚠️ First rm failed, retrying...' && rm -rf $TARGET_DIR) && mkdir -p $TARGET_DIR"

# Step 3: Upload Code + Artifacts
echo "📦 Uploading Pre-Built Artifacts to $TARGET_COLOR slot..."
# Simple rsync: upload everything EXCEPT what we explicitly exclude
rsync -avz --progress -e "ssh $SSH_OPTS" \
           --exclude='.next/cache' \
           --exclude='node_modules' \
           --exclude='node_modules_trash' \
           --exclude='node_modules_bak' \
           --exclude='node_modules_old' \
           --exclude='.next_bak' \
           --exclude='Down-Town-Cyprus-Website-Redesign' \
           --exclude='.git' \
           --exclude='.env*' \
           --exclude='*.log' \
           --exclude='debug*.ts' \
           --exclude='check_*.py' \
           --exclude='check_*.js' \
           --exclude='*.bak' \
           --exclude='tmp/' \
           --exclude='documentation/' \
            ./ $SERVER:$TARGET_DIR/

# Step 4: Configure Env (Use the same file we just created)
# Step 4: Configure Env (Use the same file we just created)
echo "🔧 Setting up environment variables..."
# Upload the env file directly via SSH pipe (more robust with multiplexing)
ssh $SSH_OPTS $SERVER "cat > $TARGET_DIR/.env" < .env.prod

# Step 4.5: Ensure Log Rotation is Configured
echo "🔄 Verifying Log Rotation Configuration..."
# We need to upload the script separately since we excluded scripts/ folder
ssh $SSH_OPTS $SERVER "mkdir -p $TARGET_DIR/scripts"
rsync -avz -e "ssh $SSH_OPTS" ./scripts/setup-log-rotation.sh $SERVER:$TARGET_DIR/scripts/setup-log-rotation.sh
ssh $SSH_OPTS $SERVER "chmod +x $TARGET_DIR/scripts/setup-log-rotation.sh && $TARGET_DIR/scripts/setup-log-rotation.sh"

# Step 5: Install Production Deps & Schema Sync
echo "📦 Installing Production Dependencies on Server..."
echo "🗄️  Applying Prisma schema sync mode: $PRISMA_SCHEMA_SYNC_MODE (CLI $PRISMA_CLI_VERSION)"
ssh $SSH_OPTS $SERVER /bin/bash -s << ENDSSH
    set -euo pipefail
    TARGET_DIR="$TARGET_DIR"
    PRISMA_CLI_VERSION="$PRISMA_CLI_VERSION"
    PRISMA_SCHEMA_SYNC_MODE="$PRISMA_SCHEMA_SYNC_MODE"

    cd "\$TARGET_DIR"
    npm ci --omit=dev --legacy-peer-deps
    npx prisma@"\$PRISMA_CLI_VERSION" generate

    case "\$PRISMA_SCHEMA_SYNC_MODE" in
        migrate-only)
            npx prisma@"\$PRISMA_CLI_VERSION" migrate deploy
            ;;
        db-push)
            npx prisma@"\$PRISMA_CLI_VERSION" db push --skip-generate --accept-data-loss
            ;;
        migrate-then-push)
            if npx prisma@"\$PRISMA_CLI_VERSION" migrate deploy; then
                echo "✅ Prisma migrate deploy succeeded."
            else
                echo "⚠️ Prisma migrate deploy failed (likely migration history drift). Falling back to db push..."
                npx prisma@"\$PRISMA_CLI_VERSION" db push --skip-generate --accept-data-loss
                echo "✅ Prisma db push fallback completed."
            fi
            ;;
        *)
            echo "❌ Unknown PRISMA_SCHEMA_SYNC_MODE='\$PRISMA_SCHEMA_SYNC_MODE'."
            echo "   Allowed: migrate-only | db-push | migrate-then-push"
            exit 1
            ;;
    esac
ENDSSH

# Step 6: Evolution Containers (Optional)
if [[ "$RESTART_EVOLUTION_CONTAINERS" == "true" ]]; then
    echo "🐳 Restarting Evolution API containers (user requested)..."
    ssh $SSH_OPTS $SERVER "cd $TARGET_DIR && docker rm -f evolution_api evolution_postgres evolution_redis 2>/dev/null || true && docker compose -f docker-compose.evolution.yml up -d"
else
    echo "⏭️  Skipping Evolution API container restart (app-only deploy)."
    echo "   Set RESTART_EVOLUTION_CONTAINERS=true or answer 'y' to restart them."
    ssh $SSH_OPTS $SERVER "docker ps --filter name=evolution --format 'table {{.Names}}\t{{.Status}}' || true"
fi

# Step 7: Runtime-Safe Blue/Green Switch
TARGET_APP_NAME="${APP_NAME_PREFIX}-${TARGET_COLOR}"
if [[ "$ACTIVE_COLOR" == "none" ]]; then
    ACTIVE_APP_NAME=""
else
    ACTIVE_APP_NAME="${APP_NAME_PREFIX}-${ACTIVE_COLOR}"
fi

echo "🔄 Switching live with health-checked runtime cutover..."
ssh $SSH_OPTS $SERVER bash << ENDSSH
    set -euo pipefail

    TARGET_APP_NAME="$TARGET_APP_NAME"
    TARGET_PORT="$TARGET_PORT"
    TARGET_DIR="$TARGET_DIR"
    SYMLINK_PATH="$SYMLINK_PATH"
    ACTIVE_APP_NAME="$ACTIVE_APP_NAME"
    ACTIVE_PORT="$ACTIVE_PORT"
    ACTIVE_DIR="$ACTIVE_DIR"
    ACTIVE_COLOR="$ACTIVE_COLOR"
    SCRAPE_WORKER_APP_NAME="$SCRAPE_WORKER_APP_NAME"
    VIEWING_RELAY_APP_NAME="$VIEWING_RELAY_APP_NAME"
    VIEWING_RELAY_DEFAULT_PORT="$VIEWING_RELAY_DEFAULT_PORT"
    BLUE_PORT="$BLUE_PORT"
    GREEN_PORT="$GREEN_PORT"
    LEGACY_SCRAPE_WORKER_PORT="$LEGACY_SCRAPE_WORKER_PORT"
    DRAIN_SECONDS="$DRAIN_SECONDS"
    SWITCH_SOAK_SECONDS="$SWITCH_SOAK_SECONDS"
    DEPLOY_TOKEN="$DEPLOY_TOKEN"
    DEPLOY_STATE_DIR="$DEPLOY_STATE_DIR"
    CURRENT_DEPLOY_TOKEN_FILE="$CURRENT_DEPLOY_TOKEN_FILE"

    mkdir -p "\$DEPLOY_STATE_DIR"

    VIEWING_RELAY_PORT="\$VIEWING_RELAY_DEFAULT_PORT"
    if [ -f "\$TARGET_DIR/.env" ]; then
        RAW_VIEWING_RELAY_PORT=\$(grep -E '^VIEWING_SESSION_RELAY_PORT=' "\$TARGET_DIR/.env" | tail -n1 | sed -E 's/^[^=]+=//' | tr -d "'\"" | tr -d '[:space:]' || true)
        if [[ "\$RAW_VIEWING_RELAY_PORT" =~ ^[0-9]+$ ]]; then
            VIEWING_RELAY_PORT="\$RAW_VIEWING_RELAY_PORT"
        fi
    fi

    echo "🔎 Preflight: unmanaged runtime drift check is temporarily skipped (hotfix)."

    echo "▶️  Starting target process \$TARGET_APP_NAME on :\$TARGET_PORT"
    if pm2 describe "\$TARGET_APP_NAME" > /dev/null 2>&1; then
        pm2 delete "\$TARGET_APP_NAME" || true
    fi

    cd "\$TARGET_DIR"
    PORT="\$TARGET_PORT" NODE_ENV=production PROCESS_ROLE=web pm2 start npm --name "\$TARGET_APP_NAME" -- start

    echo "🩺 Waiting for target health check..."
    for i in \$(seq 1 45); do
        if curl -fsS "http://127.0.0.1:\$TARGET_PORT/api/health" > /dev/null 2>&1; then
            echo "✅ Target process healthy"
            break
        fi

        if [ "\$i" -eq 45 ]; then
            echo "❌ Target health check failed on :\$TARGET_PORT"
            pm2 logs "\$TARGET_APP_NAME" --lines 80 || true
            exit 1
        fi
        sleep 1
    done

    # Keep symlink aligned with active release directory for operational visibility.
    ln -sfn "\$TARGET_DIR" "\$SYMLINK_PATH"

    # Update Caddy upstream to point at target color port, then reload gracefully.
    if [ -f /etc/caddy/Caddyfile ]; then
        PREVIOUS_CADDY_PORT=\$(grep -Eo 'reverse_proxy[[:space:]]+localhost:(3001|3002)' /etc/caddy/Caddyfile | head -n1 | sed -E 's/.*:([0-9]+)/\\1/' || true)
        cp /etc/caddy/Caddyfile "/etc/caddy/Caddyfile.bak.\$(date +%Y%m%d%H%M%S)"

        if ! grep -q 'IDX_VIEWING_RELAY_BEGIN' /etc/caddy/Caddyfile; then
            awk -v relay_port="\$VIEWING_RELAY_PORT" '
                BEGIN { inserted = 0 }
                {
                    print \$0
                    if (!inserted && \$0 ~ /^estio\.co[[:space:]]*\{[[:space:]]*$/) {
                        print "    # IDX_VIEWING_RELAY_BEGIN"
                        print "    handle_path /viewings-live-relay/* {"
                        print "        reverse_proxy 127.0.0.1:" relay_port
                        print "    }"
                        print "    # IDX_VIEWING_RELAY_END"
                        print ""
                        inserted = 1
                    }
                }
            ' /etc/caddy/Caddyfile > /etc/caddy/Caddyfile.tmp && mv /etc/caddy/Caddyfile.tmp /etc/caddy/Caddyfile
            echo "🔌 Added viewing relay websocket route to Caddy (port \$VIEWING_RELAY_PORT)."
        fi

        sed -E -i "s#localhost:(3001|3002)#localhost:\$TARGET_PORT#g" /etc/caddy/Caddyfile
        sed -E -i "s#reverse_proxy[[:space:]]+localhost([[:space:]]|$)#reverse_proxy localhost:\$TARGET_PORT\\\\1#g" /etc/caddy/Caddyfile

        caddy validate --config /etc/caddy/Caddyfile
        systemctl reload caddy || systemctl restart caddy
        echo "🌐 Caddy now routes to localhost:\$TARGET_PORT"
    else
        echo "⚠️  /etc/caddy/Caddyfile not found; skipping proxy switch"
    fi

    echo "🩺 Running post-switch soak checks for \$SWITCH_SOAK_SECONDS seconds..."
    SOAK_ATTEMPTS="\$SWITCH_SOAK_SECONDS"
    if ! [[ "\$SOAK_ATTEMPTS" =~ ^[0-9]+$ ]] || [ "\$SOAK_ATTEMPTS" -lt 1 ]; then
        SOAK_ATTEMPTS=1
    fi

    SOAK_FAILED=0
    for i in \$(seq 1 "\$SOAK_ATTEMPTS"); do
        if ! curl -kfsS --resolve estio.co:443:127.0.0.1 "https://estio.co/api/health" > /dev/null 2>&1; then
            SOAK_FAILED=1
            break
        fi
        if ! curl -fsS "http://127.0.0.1:\$TARGET_PORT/api/health" > /dev/null 2>&1; then
            SOAK_FAILED=1
            break
        fi
        sleep 1
    done

    if [ "\$SOAK_FAILED" -eq 1 ]; then
        echo "❌ Post-switch soak failed. Rolling back traffic."
        if [ -n "\$ACTIVE_PORT" ] && [ -f /etc/caddy/Caddyfile ]; then
            sed -E -i "s#localhost:[0-9]+#localhost:\$ACTIVE_PORT#g" /etc/caddy/Caddyfile
            sed -E -i "s#reverse_proxy[[:space:]]+localhost([[:space:]]|$)#reverse_proxy localhost:\$ACTIVE_PORT\\\\1#g" /etc/caddy/Caddyfile
            caddy validate --config /etc/caddy/Caddyfile
            systemctl reload caddy || systemctl restart caddy
        fi

        if [ -n "\$ACTIVE_DIR" ]; then
            ln -sfn "\$ACTIVE_DIR" "\$SYMLINK_PATH"
        fi

        if [ -n "\$ACTIVE_APP_NAME" ] && [ -n "\$ACTIVE_DIR" ] && [ -n "\$ACTIVE_PORT" ]; then
            if ! pm2 describe "\$ACTIVE_APP_NAME" > /dev/null 2>&1; then
                cd "\$ACTIVE_DIR"
                PORT="\$ACTIVE_PORT" NODE_ENV=production PROCESS_ROLE=web pm2 start npm --name "\$ACTIVE_APP_NAME" -- start
            fi
        fi

        echo "↩️  Rollback complete (previous upstream port: \${PREVIOUS_CADDY_PORT:-unknown}, restored to: \${ACTIVE_PORT:-none})"
        pm2 logs "\$TARGET_APP_NAME" --lines 120 || true
        exit 1
    fi
    echo "✅ Post-switch soak checks passed"

    echo "🧠 Ensuring dedicated scraping worker is running (\$SCRAPE_WORKER_APP_NAME)..."
    if pm2 describe "\$SCRAPE_WORKER_APP_NAME" > /dev/null 2>&1; then
        pm2 delete "\$SCRAPE_WORKER_APP_NAME" || true
    fi
    NODE_ENV=production PROCESS_ROLE=scrape-worker \
        pm2 start npm --name "\$SCRAPE_WORKER_APP_NAME" --cwd "\$SYMLINK_PATH" -- run start:scrape-worker

    echo "🩺 Waiting for scrape worker readiness..."
    WORKER_READY=0
    for i in \$(seq 1 45); do
        if SCRAPE_WORKER_APP_NAME="\$SCRAPE_WORKER_APP_NAME" SCRAPE_WORKER_ENV_PATH="\$SYMLINK_PATH/.env" node <<-'NODE'
const { execSync } = require('child_process');
const fs = require('fs');

function parseEnvFile(path) {
    const values = {};
    if (!path || !fs.existsSync(path)) return values;
    const content = fs.readFileSync(path, 'utf8');
    for (const rawLine of content.split('\n')) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;
        const index = line.indexOf('=');
        if (index <= 0) continue;
        const key = line.slice(0, index).trim();
        let value = line.slice(index + 1).trim();
        if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
        ) {
            value = value.slice(1, -1);
        }
        values[key] = value;
    }
    return values;
}

(async () => {
    const appName = process.env.SCRAPE_WORKER_APP_NAME || 'estio-scrape-worker';
    const envPath = process.env.SCRAPE_WORKER_ENV_PATH || '';

    let pm2List = [];
    try {
        pm2List = JSON.parse(execSync('pm2 jlist', { encoding: 'utf8' }));
    } catch {
        process.exit(2);
    }

    const worker = pm2List.find((entry) => entry && entry.name === appName);
    const workerPid = Number(worker?.pid || 0);
    const workerStatus = String(worker?.pm2_env?.status || worker?.status || '');
    if (workerStatus !== 'online' || !Number.isFinite(workerPid) || workerPid <= 0) {
        process.exit(3);
    }

    const envValues = parseEnvFile(envPath);
    const redisHost = envValues.REDIS_HOST || process.env.REDIS_HOST || '127.0.0.1';
    const redisPortRaw = envValues.REDIS_PORT || process.env.REDIS_PORT || '6379';
    const redisPort = Number(redisPortRaw);
    if (!Number.isFinite(redisPort) || redisPort <= 0) {
        process.exit(4);
    }

    const Redis = require('ioredis');
    const redis = new Redis({ host: redisHost, port: redisPort, lazyConnect: true });

    try {
        await redis.connect();
        const pattern = 'scraping-worker:heartbeat:instance:*';
        let cursor = '0';
        const keys = [];
        do {
            const [nextCursor, batch] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
            cursor = nextCursor;
            for (const key of batch) keys.push(key);
        } while (cursor !== '0');

        if (keys.length === 0) {
            process.exit(5);
        }

        const values = await redis.mget(...keys);
        const now = Date.now();
        let hasReadyHeartbeat = false;

        for (const value of values) {
            if (!value) continue;
            try {
                const payload = JSON.parse(value);
                const role = String(payload?.role || '');
                const updatedAtMs = new Date(payload?.updatedAt || '').getTime();
                const ageMs = now - updatedAtMs;
                if ((role === 'scrape-worker' || role === 'all') && Number.isFinite(ageMs) && ageMs <= 60_000) {
                    hasReadyHeartbeat = true;
                    break;
                }
            } catch {
                // Ignore malformed heartbeat payloads.
            }
        }

        if (!hasReadyHeartbeat) {
            process.exit(6);
        }

        process.exit(0);
    } catch {
        process.exit(7);
    } finally {
        try {
            await redis.quit();
        } catch {
            redis.disconnect();
        }
    }
})();
NODE
        then
            WORKER_READY=1
            echo "✅ Scrape worker is online and heartbeat-ready"
            break
        fi
        sleep 1
    done

    if [ "\$WORKER_READY" -ne 1 ]; then
        echo "❌ Scrape worker failed readiness checks (PM2 online + heartbeat)."
        pm2 describe "\$SCRAPE_WORKER_APP_NAME" || true
        pm2 logs "\$SCRAPE_WORKER_APP_NAME" --lines 120 --nostream || true
        exit 1
    fi

    echo "🔌 Ensuring viewing live relay process is running (\$VIEWING_RELAY_APP_NAME) on :\$VIEWING_RELAY_PORT..."
    if pm2 describe "\$VIEWING_RELAY_APP_NAME" > /dev/null 2>&1; then
        pm2 delete "\$VIEWING_RELAY_APP_NAME" || true
    fi
    NODE_ENV=production PROCESS_ROLE=viewing-live-relay \
        pm2 start npm --name "\$VIEWING_RELAY_APP_NAME" --cwd "\$SYMLINK_PATH" -- run start:viewing-live-relay

    echo "🩺 Waiting for viewing live relay readiness..."
    RELAY_READY=0
    for i in \$(seq 1 45); do
        if curl -fsS "http://127.0.0.1:\$VIEWING_RELAY_PORT/health" > /dev/null 2>&1; then
            RELAY_READY=1
            echo "✅ Viewing live relay is healthy"
            break
        fi
        sleep 1
    done

    if [ "\$RELAY_READY" -ne 1 ]; then
        echo "❌ Viewing live relay failed readiness checks on :\$VIEWING_RELAY_PORT."
        pm2 describe "\$VIEWING_RELAY_APP_NAME" || true
        pm2 logs "\$VIEWING_RELAY_APP_NAME" --lines 120 --nostream || true
        exit 1
    fi

    # Mark this deployment as current so stale delayed cleanup jobs become no-ops.
    printf "%s\n" "\$DEPLOY_TOKEN" > "\$CURRENT_DEPLOY_TOKEN_FILE"

    # Remove legacy single-process deployment if present.
    if pm2 describe estio-app > /dev/null 2>&1; then
        pm2 delete estio-app || true
    fi

    # Drain old color process after a grace window.
    if [ -n "\$ACTIVE_APP_NAME" ] && [ "\$ACTIVE_APP_NAME" != "\$TARGET_APP_NAME" ]; then
        if [ "\$DRAIN_SECONDS" -gt 0 ] 2>/dev/null; then
            DRAIN_SCRIPT="/tmp/\${ACTIVE_APP_NAME}-drain-\${DEPLOY_TOKEN}.sh"
            {
                echo '#!/usr/bin/env bash'
                echo "sleep \"\$DRAIN_SECONDS\""
                echo
                echo "CURRENT_DEPLOY_TOKEN_FILE=\"\$CURRENT_DEPLOY_TOKEN_FILE\""
                echo "DEPLOY_TOKEN=\"\$DEPLOY_TOKEN\""
                echo "ACTIVE_PORT=\"\$ACTIVE_PORT\""
                echo "ACTIVE_APP_NAME=\"\$ACTIVE_APP_NAME\""
                cat << 'DRAIN_EOF'
CURRENT_TOKEN=\$(cat "\$CURRENT_DEPLOY_TOKEN_FILE" 2>/dev/null || true)
if [ "\$CURRENT_TOKEN" != "\$DEPLOY_TOKEN" ]; then
    exit 0
fi

LIVE_PORT=\$(grep -Eo 'reverse_proxy[[:space:]]+localhost:[0-9]+' /etc/caddy/Caddyfile 2>/dev/null | head -n1 | sed -E 's/.*:([0-9]+)/\1/' || true)
if [ "\$LIVE_PORT" = "\$ACTIVE_PORT" ]; then
    exit 0
fi

pm2 delete "\$ACTIVE_APP_NAME" >/dev/null 2>&1 || true
pm2 save >/dev/null 2>&1 || true
rm -f "\$0"
DRAIN_EOF
            } > "\$DRAIN_SCRIPT"
            chmod +x "\$DRAIN_SCRIPT"
            nohup "\$DRAIN_SCRIPT" >/dev/null 2>&1 &
            echo "⏳ Scheduled old process drain: \$ACTIVE_APP_NAME in \$DRAIN_SECONDS seconds"
        else
            LIVE_PORT=\$(grep -Eo 'reverse_proxy[[:space:]]+localhost:[0-9]+' /etc/caddy/Caddyfile 2>/dev/null | head -n1 | sed -E 's/.*:([0-9]+)/\\1/' || true)
            if [ "\$LIVE_PORT" = "\$ACTIVE_PORT" ]; then
                echo "⚠️  Skipping immediate drain for \$ACTIVE_APP_NAME because it appears to be live on :\$LIVE_PORT"
            else
                pm2 delete "\$ACTIVE_APP_NAME" || true
                echo "🧹 Removed old process immediately: \$ACTIVE_APP_NAME"
            fi
        fi
    fi

    pm2 save
    pm2 list
ENDSSH

echo "✅ Local Build Deployment Complete!"
