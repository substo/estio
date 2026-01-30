#!/bin/bash
set -e

# Provisioning Script for Hetzner Server
# Installing: Node.js 20, Nginx, PM2, Certbot, UFW

SERVER="root@138.199.214.117"

echo "🚀 Starting server provisioning on $SERVER..."

ssh -o StrictHostKeyChecking=no $SERVER bash <<'EOF'
set -e

echo "🔄 Updating system packages..."
apt update && apt upgrade -y

echo "🛠️ Installing essential tools..."
apt install -y build-essential curl git unzip ufw nginx certbot
# Remove python3-certbot-nginx if installed to avoid conflicts with snap, standardizing on snap for certbot
apt remove -y certbot || true

echo "🎭 Installing Puppeteer dependencies (via Google Chrome)..."
wget -q https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
apt-get install -y ./google-chrome-stable_current_amd64.deb
rm google-chrome-stable_current_amd64.deb

echo "🟢 Installing Node.js 20 (LTS)..."
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

echo "📦 Installing global NPM packages (PM2)..."
npm install -g pm2
pm2 startup systemd

echo "🔥 Configuring Firewall (UFW)..."
ufw allow OpenSSH
ufw allow 'Nginx Full'
# Enable UFW non-interactively
ufw --force enable

echo "✅ Server provisioning complete!"
node -v
npm -v
nginx -v
EOF
