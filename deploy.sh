#!/bin/bash

# Production Rolling Deployment Script (Git -> Blue/Green)
# Deploys from GITHUB to estio.co with Zero Downtime
# Usage: ./deploy.sh [--quick]

set -e

SERVER="root@138.199.214.117"
REPO_URL="git@github.com:martingreen/estio-app.git"
BASE_DIR="/home/martin"
SYMLINK_NAME="estio-app"
SYMLINK_PATH="$BASE_DIR/$SYMLINK_NAME"
BLUE_DIR="$BASE_DIR/estio-app-blue"
GREEN_DIR="$BASE_DIR/estio-app-green"

IS_QUICK=false
for arg in "$@"; do
  if [ "$arg" == "--quick" ]; then
    IS_QUICK=true
  fi
done

echo "🚀 Starting GIT ROLLING deployment to estio.co..."
if [ "$IS_QUICK" = true ]; then
    echo "⚡ Mode: QUICK (Incremental Build)"
else
    echo "🐢 Mode: FULL (Clean Build)"
fi

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
ssh $SSH_OPTS $SERVER bash << ENDSSH 2>&1 | tee /tmp/deploy_state.log
    set -e
    
    # Check if main path is a directory (Legacy Support)
    if [ -d "$SYMLINK_PATH" ] && [ ! -L "$SYMLINK_PATH" ]; then
        echo "⚠️  Legacy directory structure detected!"
        echo "🔄 Migrating current 'estio-app' to 'estio-app-blue'..."
        mv "$SYMLINK_PATH" "$BLUE_DIR"
        ln -s "$BLUE_DIR" "$SYMLINK_PATH"
        echo "✅ Migration complete. Active: BLUE"
    fi

    # Determine Active Link
    if [ -L "$SYMLINK_PATH" ]; then
        TARGET=\$(readlink "$SYMLINK_PATH")
        if [[ "\$TARGET" == *"-blue"* ]]; then
            echo "CURRENT_COLOR=blue"
        else
            echo "CURRENT_COLOR=green"
        fi
    else
        if [ -d "$BLUE_DIR" ]; then echo "CURRENT_COLOR=blue"; else echo "CURRENT_COLOR=none"; fi
    fi
ENDSSH

if grep -q "CURRENT_COLOR=blue" /tmp/deploy_state.log; then
    ACTIVE_DIR=$BLUE_DIR
    TARGET_DIR=$GREEN_DIR
    TARGET_COLOR="green"
    echo "🔵 Active: BLUE -> 🟢 Target: GREEN"
else
    ACTIVE_DIR=$GREEN_DIR
    TARGET_DIR=$BLUE_DIR
    TARGET_COLOR="blue"
    echo "🟢 Active: GREEN -> 🔵 Target: BLUE"
fi
rm -f /tmp/deploy_state.log

# Step 1: Prepare Target Directory
echo "📁 Preparing target directory ($TARGET_DIR)..."

if [ "$IS_QUICK" = true ]; then
    ssh $SSH_OPTS $SERVER "mkdir -p $TARGET_DIR"
    echo "♻️  Cloning previous modules/build for speed..."
    ssh $SSH_OPTS $SERVER "rsync -a --delete $ACTIVE_DIR/node_modules $TARGET_DIR/ 2>/dev/null || true"
    ssh $SSH_OPTS $SERVER "rsync -a --delete $ACTIVE_DIR/.next $TARGET_DIR/ 2>/dev/null || true"
else
    echo "🧹 Cleaning previous build artifacts..."
    # Full clean: Remove entire directory and recreate
    ssh $SSH_OPTS $SERVER "rm -rf $TARGET_DIR && mkdir -p $TARGET_DIR"
fi

# Step 2: Pull Code (Git -> Server)
echo "📦 Pulling code from GitHub to $TARGET_COLOR slot..."
ssh $SSH_OPTS $SERVER bash << ENDSSH
    set -e
    # Clone or Pull
    if [ ! -d "$TARGET_DIR/.git" ]; then
        echo "Cloning repository..."
        # Clear dir if it exists but no git (just in case)
        # Note: We keep node_modules/.next if they were rsynced above, so use 'git init' or just clone into temp and move?
        # Better: Git clone into empty dir. But we populated it.
        # So: Git init, remote add, fetch, reset.
        cd "$TARGET_DIR"
        git init
        git remote add origin $REPO_URL
        git fetch origin
        git reset --hard origin/main
    else
        echo "Updating existing repository..."
        cd "$TARGET_DIR"
        git fetch origin
        git reset --hard origin/main
        git pull origin main
    fi
ENDSSH

# Step 3: Configure Env (Crucial: Keep In Sync!)
echo "🔧 Setting up environment variables..."
ssh $SSH_OPTS $SERVER "rm -f $TARGET_DIR/.env.production && cat > $TARGET_DIR/.env << 'EOF'
NODE_ENV=production
APP_BASE_URL=https://estio.co
PORT=3000
GHL_REDIRECT_URI=https://estio.co/api/oauth/callback
WIDGET_BASE_URL=https://estio.co/widget
NEXT_PUBLIC_APP_URL=https://estio.co

# Clerk (DEVELOPMENT MODE)
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_bWFnbmV0aWMtc3F1aXJyZWwtMTYuY2xlcmsuYWNjb3VudHMuZGV2JA
CLERK_SECRET_KEY=sk_test_TiBFr4mpy5hFMZeE79f3sMxPi5VFrwV9XJvNuWU4f9
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL=/
NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL=/
NEXT_PUBLIC_CLERK_IS_SATELLITE=false

# Database
DATABASE_URL=postgresql://postgres.oxxkmbxfqswtomzernzu:ropCys-dewpif-didnu7@aws-1-eu-north-1.pooler.supabase.com:6543/postgres?pgbouncer=true
DIRECT_URL=postgresql://postgres.oxxkmbxfqswtomzernzu:ropCys-dewpif-didnu7@aws-1-eu-north-1.pooler.supabase.com:5432/postgres?pgbouncer=true

# GHL
GHL_CLIENT_ID=69244fe2f2f0fa6dc9d67a03-mid87fgm
GHL_CLIENT_SECRET=c6bba766-76c6-4231-9663-6a0e8d87dd3f

# JWT & Security
JWT_SECRET=a0sal5Wocd3K8D42l3dIsuRT3A96782eAp3/uAzYhuk=
SSO_TOKEN_EXPIRY_MINUTES=5
SESSION_EXPIRY_HOURS=24
ALLOWED_GHL_ROLES=admin,user

# Cloudflare Images
CLOUDFLARE_DNS_API_TOKEN=LFakUDyWn6caY0ioZbaqJAdCXaftpmGPws_AUZaz
CLOUDFLARE_ACCOUNT_ID=a5d668404eee09103a32d81b8b7dc172
CLOUDFLARE_IMAGES_API_TOKEN=vxJZ3Ak6GzINeUpX_v845PeB84H0ThzLa-RSrD8H
NEXT_PUBLIC_CLOUDFLARE_IMAGES_ACCOUNT_HASH=CgOhaOjkCC4UB7N5l7b9sg
EOF"

# Step 4: Install & Build
echo "🏗️  Building application in $TARGET_COLOR slot..."
BUILD_CMD="cd $TARGET_DIR"

if [ "$IS_QUICK" = true ]; then
    BUILD_CMD="$BUILD_CMD && if [ ! -d node_modules ]; then npm install --legacy-peer-deps; fi"
else
    BUILD_CMD="$BUILD_CMD && npm install --legacy-peer-deps"
fi

BUILD_CMD="$BUILD_CMD && npx prisma generate && npx prisma db push --skip-generate && NODE_ENV=production npm run build"
ssh $SSH_OPTS $SERVER "$BUILD_CMD"

# Step 5: Switch Live
echo "🔄 Switching live traffic to $TARGET_COLOR..."
ssh $SSH_OPTS $SERVER bash << ENDSSH
    set -e
    ln -sfn "$TARGET_DIR" "$SYMLINK_PATH"
    cd "$SYMLINK_PATH"
    if pm2 describe estio-app > /dev/null 2>&1; then
        pm2 reload estio-app
    else
        PORT=3000 NODE_ENV=production pm2 start npm --name 'estio-app' -- start
        pm2 save
    fi
ENDSSH

echo "✅ Git Rolling Deployment Complete!"

# Step 6: Configure Caddy (Ensure it's resilient)
echo "🌐 Setting up Caddy (replacing Nginx)..."

ssh $SSH_OPTS $SERVER bash << ENDSSH
    set -e
    
    # 0.5. PRE-FIX: Unlock Caddy binary if it exists (Fixes dpkg error)
    if [ -f /usr/bin/caddy ] && command -v chattr &> /dev/null; then
        echo "🔓 Unlocking Caddy binary using chattr..."
        sudo chattr -i /usr/bin/caddy || true
    fi

    # 1. Install Caddy (if not installed or broken)
    if ! command -v caddy &> /dev/null || ! caddy version &> /dev/null; then
        echo "Installing/Reinstalling Caddy..."
        sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
        curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --batch --yes --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
        curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
        sudo apt update
        sudo apt install --reinstall -y caddy
    fi

    # 2. Stop/Disable Nginx (to free up ports 80/443)
    if systemctl is-active --quiet nginx; then
        echo "Stopping Nginx..."
        systemctl stop nginx
        systemctl disable nginx
    fi

    # 3. Apply Caddy Configuration
    echo "Applying Caddyfile..."
    # The Caddyfile is in the TARGET_DIR (uploaded via git)
    if [ -f "$TARGET_DIR/Caddyfile" ]; then
        cp "$TARGET_DIR/Caddyfile" /etc/caddy/Caddyfile
    else
         echo "⚠️ Warning: Caddyfile not found in target dir, checking symlink..."
         if [ -f "$SYMLINK_PATH/Caddyfile" ]; then
             cp "$SYMLINK_PATH/Caddyfile" /etc/caddy/Caddyfile
         else
             echo "❌ Error: Caddyfile not found! Skipping config update."
         fi
    fi
    
    # Ensure Caddy is executable (Robust Fix)
    echo "Fixing Caddy permissions..."
    
    # Try to remove immutable bit (if set)
    if command -v chattr &> /dev/null; then
        sudo chattr -i /usr/bin/caddy || true
    fi

    # Ensure ownership and permissions
    if [ -f /usr/bin/caddy ]; then
        sudo chown root:root /usr/bin/caddy || true
        sudo chmod 0755 /usr/bin/caddy || echo "⚠️ Warning: Failed to chmod caddy"
    fi

    # Format Code (Optional validation - Fail Open)
    if ! caddy fmt --overwrite /etc/caddy/Caddyfile; then
        echo "⚠️ Warning: Could not format Caddyfile (validation skipped)"
    fi

    # 4. Restart Caddy
    # Unmask Caddy if it was masked (common issue on some VPS providers or after package updates)
    if systemctl is-enabled caddy 2>/dev/null | grep -q "masked"; then
        echo "Unmasking Caddy service..."
        sudo systemctl unmask caddy
    fi

    systemctl reload caddy || systemctl restart caddy
    echo "✅ Caddy acts as the Reverse Proxy & SSL Manager"
ENDSSH

echo "🚀 Live on: $TARGET_COLOR slot"
echo "🌐 Verify: https://estio.co"
