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
chmod +x "${SCRIPT_DIR}/cron-ai-automations.sh"
chmod +x "${SCRIPT_DIR}/cron-task-reminders.sh"

# Check if cron entry already exists (Gmail)
CRON_ENTRY_GMAIL="*/15 * * * * ${SCRIPT_DIR}/cron-gmail-sync.sh"
CRON_ENTRY_OUTLOOK="*/15 * * * * ${SCRIPT_DIR}/cron-outlook-sync.sh"
CRON_ENTRY_AI_RUNTIME="*/10 * * * * ${SCRIPT_DIR}/cron-ai-automations.sh"
CRON_ENTRY_TASK_REMINDERS="*/1 * * * * ${SCRIPT_DIR}/cron-task-reminders.sh"

EXISTING_GMAIL=$(crontab -l 2>/dev/null | grep -F "cron-gmail-sync.sh" || true)
EXISTING_OUTLOOK=$(crontab -l 2>/dev/null | grep -F "cron-outlook-sync.sh" || true)
EXISTING_AI_RUNTIME=$(crontab -l 2>/dev/null | grep -F "cron-ai-automations.sh" || true)
EXISTING_TASK_REMINDERS=$(crontab -l 2>/dev/null | grep -F "cron-task-reminders.sh" || true)

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

# Update AI Runtime Entry
if [ -n "${EXISTING_AI_RUNTIME}" ]; then
    echo "⚠️  AI Runtime Cron entry already exists. Updating..."
    (crontab -l 2>/dev/null | grep -v "cron-ai-automations.sh"; echo "${CRON_ENTRY_AI_RUNTIME}") | crontab -
else
    (crontab -l 2>/dev/null; echo "${CRON_ENTRY_AI_RUNTIME}") | crontab -
fi

# Update Task Reminders Entry
if [ -n "${EXISTING_TASK_REMINDERS}" ]; then
    echo "⚠️  Task Reminders Cron entry already exists. Updating..."
    (crontab -l 2>/dev/null | grep -v "cron-task-reminders.sh"; echo "${CRON_ENTRY_TASK_REMINDERS}") | crontab -
else
    (crontab -l 2>/dev/null; echo "${CRON_ENTRY_TASK_REMINDERS}") | crontab -
fi

echo "✅ Cron jobs installed!"
echo ""
echo "Current crontab:"
crontab -l | grep -E "(gmail|outlook|ai-runtime|ai-automations|task-reminders|estio)" || echo "(no estio-related entries)"
echo ""
echo "📋 Manual verification:"
echo "   - Check logs: tail -f ${APP_DIR}/logs/gmail-sync-cron.log"
echo "   - Check logs: tail -f ${APP_DIR}/logs/outlook-sync-cron.log"
echo "   - Check logs: tail -f ${APP_DIR}/logs/ai-runtime-cron.log"
echo "   - Check logs: tail -f ${APP_DIR}/logs/task-reminders-cron.log"
echo "   - Test manually: ${SCRIPT_DIR}/cron-gmail-sync.sh"
echo "   - Test manually: ${SCRIPT_DIR}/cron-outlook-sync.sh"
echo "   - Test manually: ${SCRIPT_DIR}/cron-ai-automations.sh"
echo "   - Test manually: ${SCRIPT_DIR}/cron-task-reminders.sh"
echo ""
echo "🔐 Don't forget to set CRON_SECRET in your environment!"
