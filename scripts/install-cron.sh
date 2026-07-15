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
chmod +x "${SCRIPT_DIR}/cron-scheduled-messages.sh"
chmod +x "${SCRIPT_DIR}/cron-whatsapp-outbound.sh"
chmod +x "${SCRIPT_DIR}/cron-provider-outbox.sh"
chmod +x "${SCRIPT_DIR}/cron-ai-provider-catalog.sh"

# Check if cron entry already exists (Gmail)
CRON_ENTRY_GMAIL="*/15 * * * * ${SCRIPT_DIR}/cron-gmail-sync.sh"
CRON_ENTRY_OUTLOOK="*/15 * * * * ${SCRIPT_DIR}/cron-outlook-sync.sh"
CRON_ENTRY_AI_RUNTIME="*/10 * * * * ${SCRIPT_DIR}/cron-ai-automations.sh"
CRON_ENTRY_TASK_REMINDERS="*/1 * * * * ${SCRIPT_DIR}/cron-task-reminders.sh"
CRON_ENTRY_SCHEDULED_MESSAGES="*/1 * * * * ${SCRIPT_DIR}/cron-scheduled-messages.sh"
CRON_ENTRY_WHATSAPP_OUTBOUND="*/1 * * * * ${SCRIPT_DIR}/cron-whatsapp-outbound.sh"
CRON_ENTRY_PROVIDER_OUTBOX="*/1 * * * * ${SCRIPT_DIR}/cron-provider-outbox.sh"
CRON_ENTRY_AI_PROVIDER_CATALOG="17 3 * * * ${SCRIPT_DIR}/cron-ai-provider-catalog.sh"

EXISTING_GMAIL=$(crontab -l 2>/dev/null | grep -F "cron-gmail-sync.sh" || true)
EXISTING_OUTLOOK=$(crontab -l 2>/dev/null | grep -F "cron-outlook-sync.sh" || true)
EXISTING_AI_RUNTIME=$(crontab -l 2>/dev/null | grep -F "cron-ai-automations.sh" || true)
EXISTING_TASK_REMINDERS=$(crontab -l 2>/dev/null | grep -F "cron-task-reminders.sh" || true)
EXISTING_SCHEDULED_MESSAGES=$(crontab -l 2>/dev/null | grep -E "cron-scheduled-messages\\.sh|api/cron/scheduled-messages" || true)
EXISTING_WHATSAPP_OUTBOUND=$(crontab -l 2>/dev/null | grep -F "cron-whatsapp-outbound.sh" || true)
EXISTING_PROVIDER_OUTBOX=$(crontab -l 2>/dev/null | grep -F "cron-provider-outbox.sh" || true)
EXISTING_AI_PROVIDER_CATALOG=$(crontab -l 2>/dev/null | grep -F "cron-ai-provider-catalog.sh" || true)

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

# Update Scheduled Messages Entry
if [ -n "${EXISTING_SCHEDULED_MESSAGES}" ]; then
    echo "⚠️  Scheduled Messages Cron entry already exists. Updating..."
    (crontab -l 2>/dev/null | grep -v "cron-scheduled-messages.sh" | grep -v "api/cron/scheduled-messages"; echo "${CRON_ENTRY_SCHEDULED_MESSAGES}") | crontab -
else
    (crontab -l 2>/dev/null; echo "${CRON_ENTRY_SCHEDULED_MESSAGES}") | crontab -
fi

# Update WhatsApp Outbound Recovery Entry
if [ -n "${EXISTING_WHATSAPP_OUTBOUND}" ]; then
    echo "⚠️  WhatsApp Outbound Cron entry already exists. Updating..."
    (crontab -l 2>/dev/null | grep -v "cron-whatsapp-outbound.sh"; echo "${CRON_ENTRY_WHATSAPP_OUTBOUND}") | crontab -
else
    (crontab -l 2>/dev/null; echo "${CRON_ENTRY_WHATSAPP_OUTBOUND}") | crontab -
fi

# Update Provider Outbox Recovery Entry
if [ -n "${EXISTING_PROVIDER_OUTBOX}" ]; then
    echo "⚠️  Provider Outbox Cron entry already exists. Updating..."
    (crontab -l 2>/dev/null | grep -v "cron-provider-outbox.sh"; echo "${CRON_ENTRY_PROVIDER_OUTBOX}") | crontab -
else
    (crontab -l 2>/dev/null; echo "${CRON_ENTRY_PROVIDER_OUTBOX}") | crontab -
fi

# Update AI Provider Catalog Refresh Entry
if [ -n "${EXISTING_AI_PROVIDER_CATALOG}" ]; then
    echo "⚠️  AI Provider Catalog Cron entry already exists. Updating..."
    (crontab -l 2>/dev/null | grep -v "cron-ai-provider-catalog.sh"; echo "${CRON_ENTRY_AI_PROVIDER_CATALOG}") | crontab -
else
    (crontab -l 2>/dev/null; echo "${CRON_ENTRY_AI_PROVIDER_CATALOG}") | crontab -
fi

echo "✅ Cron jobs installed!"
echo ""
echo "Current crontab:"
crontab -l | grep -E "(gmail|outlook|ai-runtime|ai-automations|task-reminders|scheduled-messages|whatsapp-outbound|provider-outbox|ai-provider-catalog|estio)" || echo "(no estio-related entries)"
echo ""
echo "📋 Manual verification:"
echo "   - Check logs: tail -f ${APP_DIR}/logs/gmail-sync-cron.log"
echo "   - Check logs: tail -f ${APP_DIR}/logs/outlook-sync-cron.log"
echo "   - Check logs: tail -f ${APP_DIR}/logs/ai-runtime-cron.log"
echo "   - Check logs: tail -f ${APP_DIR}/logs/task-reminders-cron.log"
echo "   - Check logs: tail -f ${APP_DIR}/logs/scheduled-messages-cron.log"
echo "   - Check logs: tail -f ${APP_DIR}/logs/whatsapp-outbound-cron.log"
echo "   - Check logs: tail -f ${APP_DIR}/logs/provider-outbox-cron.log"
echo "   - Check logs: tail -f ${APP_DIR}/logs/ai-provider-catalog-cron.log"
echo "   - Test manually: ${SCRIPT_DIR}/cron-gmail-sync.sh"
echo "   - Test manually: ${SCRIPT_DIR}/cron-outlook-sync.sh"
echo "   - Test manually: ${SCRIPT_DIR}/cron-ai-automations.sh"
echo "   - Test manually: ${SCRIPT_DIR}/cron-task-reminders.sh"
echo "   - Test manually: ${SCRIPT_DIR}/cron-scheduled-messages.sh"
echo "   - Test manually: ${SCRIPT_DIR}/cron-whatsapp-outbound.sh"
echo "   - Test manually: ${SCRIPT_DIR}/cron-provider-outbox.sh"
echo "   - Test manually: ${SCRIPT_DIR}/cron-ai-provider-catalog.sh"
echo ""
echo "🔐 Don't forget to set CRON_SECRET in your environment!"
