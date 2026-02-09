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

# Step 0: Determine Active/Target Slots
echo "🔍 Checking server state..."
ssh $SSH_OPTS $SERVER bash << ENDSSH > /tmp/deploy_state.log
    # Check if symlink
    if [ -L "$SYMLINK_PATH" ]; then
        TARGET=\$(readlink "$SYMLINK_PATH")
        if [[ "\$TARGET" == *"-blue"* ]]; then
            echo "CURRENT_COLOR=blue"
        else
            echo "CURRENT_COLOR=green"
        fi
    else
        # Fallback
        if [ -d "$BLUE_DIR" ]; then
             echo "CURRENT_COLOR=blue"
        else
             echo "CURRENT_COLOR=none"
        fi
    fi
ENDSSH

# Read active color from log
if grep -q "CURRENT_COLOR=blue" /tmp/deploy_state.log; then
    TARGET_DIR=$GREEN_DIR
    TARGET_COLOR="green"
    echo "🔵 Active: BLUE -> 🟢 Target: GREEN"
else
    TARGET_DIR=$BLUE_DIR
    TARGET_COLOR="blue"
    echo "🟢 Active: GREEN -> 🔵 Target: BLUE"
fi
rm -f /tmp/deploy_state.log

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
           --exclude='scripts/' \
            ./ $SERVER:$TARGET_DIR/

# Step 4: Configure Env (Use the same file we just created)
echo "🔧 Setting up environment variables..."
# Upload the env file directly via SSH pipe (more robust with multiplexing)
# Upload the env file directly via SSH pipe (more robust with multiplexing)
ssh $SSH_OPTS $SERVER "cat > $TARGET_DIR/.env" < .env.prod
# Keep local .env.prod safe

# Step 5: Install Production Deps & Finalize
echo "📦 Installing Production Dependencies on Server..."
ssh $SSH_OPTS $SERVER "cd $TARGET_DIR && npm ci --omit=dev --legacy-peer-deps && npx prisma@6.19.0 generate"

# Step 6: Deploy Evolution (Same as before - simplified)
echo "🐳 Ensuring Evolution API is up..."
ssh $SSH_OPTS $SERVER "cd $TARGET_DIR && docker rm -f evolution_api evolution_postgres evolution_redis 2>/dev/null || true && docker compose -f docker-compose.evolution.yml up -d"

# Step 7: Switch Live
echo "🔄 Switching live..."
ssh $SSH_OPTS $SERVER bash << ENDSSH
    ln -sfn "$TARGET_DIR" "$SYMLINK_PATH"
    cd "$SYMLINK_PATH"
    if pm2 describe estio-app > /dev/null 2>&1; then pm2 delete estio-app; fi
    PORT=3000 NODE_ENV=production pm2 start npm --name 'estio-app' -- start
    pm2 save
ENDSSH

echo "✅ Local Build Deployment Complete!"
