#!/bin/bash
# =============================================================================
# Install Cron Jobs for Estio
# =============================================================================
# Run this script on the production server to set up scheduled tasks.
# Usage: ./scripts/install-cron.sh
# =============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(dirname "${SCRIPT_DIR}")"

echo "📅 Installing Estio Cron Jobs..."

# Make scripts executable
chmod +x "${SCRIPT_DIR}/cron-gmail-sync.sh"

# Check if cron entry already exists
CRON_ENTRY="*/5 * * * * ${SCRIPT_DIR}/cron-gmail-sync.sh"
EXISTING=$(crontab -l 2>/dev/null | grep -F "cron-gmail-sync.sh" || true)

if [ -n "${EXISTING}" ]; then
    echo "⚠️  Cron entry already exists. Updating..."
    # Remove old entry and add new one
    (crontab -l 2>/dev/null | grep -v "cron-gmail-sync.sh"; echo "${CRON_ENTRY}") | crontab -
else
    # Add new entry
    (crontab -l 2>/dev/null; echo "${CRON_ENTRY}") | crontab -
fi

echo "✅ Cron job installed!"
echo ""
echo "Current crontab:"
crontab -l | grep -E "(gmail|estio)" || echo "(no estio-related entries)"
echo ""
echo "📋 Manual verification:"
echo "   - Check logs: tail -f ${APP_DIR}/logs/gmail-sync-cron.log"
echo "   - Test manually: ${SCRIPT_DIR}/cron-gmail-sync.sh"
echo ""
echo "🔐 Don't forget to set CRON_SECRET in your environment!"
