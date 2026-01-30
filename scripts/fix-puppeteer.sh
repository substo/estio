#!/bin/bash
# Check if a specific server is passed as argument, otherwise default to active logs IP
SERVER="${1:-root@37.27.194.65}"

echo "🎭 Fixing Puppeteer dependencies on $SERVER (via Google Chrome Stable)..."
echo "Note: attempting to install 'google-chrome-stable' which pulls all required libs."

ssh $SERVER "wget -q https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb && \
apt-get update && \
apt-get install -y ./google-chrome-stable_current_amd64.deb && \
rm google-chrome-stable_current_amd64.deb"

echo "✅ Puppeteer dependencies installed!"
