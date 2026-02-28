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

# Step 5: Install Production Deps & Finalize
echo "📦 Installing Production Dependencies on Server..."
ssh $SSH_OPTS $SERVER "cd $TARGET_DIR && npm ci --omit=dev --legacy-peer-deps && npx prisma@6.19.0 generate"

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
    DRAIN_SECONDS="$DRAIN_SECONDS"
    SWITCH_SOAK_SECONDS="$SWITCH_SOAK_SECONDS"
    DEPLOY_TOKEN="$DEPLOY_TOKEN"
    DEPLOY_STATE_DIR="$DEPLOY_STATE_DIR"
    CURRENT_DEPLOY_TOKEN_FILE="$CURRENT_DEPLOY_TOKEN_FILE"

    mkdir -p "\$DEPLOY_STATE_DIR"

    echo "▶️  Starting target process \$TARGET_APP_NAME on :\$TARGET_PORT"
    if pm2 describe "\$TARGET_APP_NAME" > /dev/null 2>&1; then
        pm2 delete "\$TARGET_APP_NAME" || true
    fi

    cd "\$TARGET_DIR"
    PORT="\$TARGET_PORT" NODE_ENV=production pm2 start npm --name "\$TARGET_APP_NAME" -- start

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
        PREVIOUS_CADDY_PORT=\$(grep -Eo 'reverse_proxy[[:space:]]+localhost:[0-9]+' /etc/caddy/Caddyfile | head -n1 | sed -E 's/.*:([0-9]+)/\\1/' || true)
        cp /etc/caddy/Caddyfile "/etc/caddy/Caddyfile.bak.\$(date +%Y%m%d%H%M%S)"
        sed -E -i "s#localhost:[0-9]+#localhost:\$TARGET_PORT#g" /etc/caddy/Caddyfile
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
                PORT="\$ACTIVE_PORT" NODE_ENV=production pm2 start npm --name "\$ACTIVE_APP_NAME" -- start
            fi
        fi

        echo "↩️  Rollback complete (previous upstream port: \${PREVIOUS_CADDY_PORT:-unknown}, restored to: \${ACTIVE_PORT:-none})"
        pm2 logs "\$TARGET_APP_NAME" --lines 120 || true
        exit 1
    fi
    echo "✅ Post-switch soak checks passed"

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
