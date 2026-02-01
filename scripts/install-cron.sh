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
chmod +x "${SCRIPT_DIR}/cron-outlook-sync.sh"

# Check if cron entry already exists (Gmail)
CRON_ENTRY_GMAIL="*/5 * * * * ${SCRIPT_DIR}/cron-gmail-sync.sh"
CRON_ENTRY_OUTLOOK="*/5 * * * * ${SCRIPT_DIR}/cron-outlook-sync.sh"

EXISTING_GMAIL=$(crontab -l 2>/dev/null | grep -F "cron-gmail-sync.sh" || true)
EXISTING_OUTLOOK=$(crontab -l 2>/dev/null | grep -F "cron-outlook-sync.sh" || true)

# Update Gmail Entry
if [ -n "${EXISTING_GMAIL}" ]; then
    echo "⚠️  Gmail Cron entry already exists. Updating..."
    (crontab -l 2>/dev/null | grep -v "cron-gmail-sync.sh"; echo "${CRON_ENTRY_GMAIL}") | crontab -
else
    (crontab -l 2>/dev/null; echo "${CRON_ENTRY_GMAIL}") | crontab -
fi

# Update Outlook Entry
if [ -n "${EXISTING_OUTLOOK}" ]; then
    echo "⚠️  Outlook Cron entry already exists. Updating..."
    (crontab -l 2>/dev/null | grep -v "cron-outlook-sync.sh"; echo "${CRON_ENTRY_OUTLOOK}") | crontab -
else
    # Add new entry
    (crontab -l 2>/dev/null; echo "${CRON_ENTRY_OUTLOOK}") | crontab -
fi

echo "✅ Cron jobs installed!"
echo ""
echo "Current crontab:"
crontab -l | grep -E "(gmail|outlook|estio)" || echo "(no estio-related entries)"
echo ""
echo "📋 Manual verification:"
echo "   - Check logs: tail -f ${APP_DIR}/logs/gmail-sync-cron.log"
echo "   - Check logs: tail -f ${APP_DIR}/logs/outlook-sync-cron.log"
echo "   - Test manually: ${SCRIPT_DIR}/cron-gmail-sync.sh"
echo "   - Test manually: ${SCRIPT_DIR}/cron-outlook-sync.sh"
echo ""
echo "🔐 Don't forget to set CRON_SECRET in your environment!"
