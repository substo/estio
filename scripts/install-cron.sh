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
chmod +x "${SCRIPT_DIR}/cron-public-site-domains.sh"
chmod +x "${SCRIPT_DIR}/cron-property-match-profiles.sh"
chmod +x "${SCRIPT_DIR}/cron-property-match-campaigns.sh"
chmod +x "${SCRIPT_DIR}/run-cron-endpoint.sh"

# Check if cron entry already exists (Gmail)
CRON_ENTRY_GMAIL="*/15 * * * * ${SCRIPT_DIR}/cron-gmail-sync.sh"
CRON_ENTRY_OUTLOOK="*/15 * * * * ${SCRIPT_DIR}/cron-outlook-sync.sh"
CRON_ENTRY_AI_RUNTIME="*/10 * * * * ${SCRIPT_DIR}/cron-ai-automations.sh"
CRON_ENTRY_TASK_REMINDERS="*/1 * * * * ${SCRIPT_DIR}/cron-task-reminders.sh"
CRON_ENTRY_SCHEDULED_MESSAGES="*/1 * * * * ${SCRIPT_DIR}/cron-scheduled-messages.sh"
CRON_ENTRY_WHATSAPP_OUTBOUND="*/1 * * * * ${SCRIPT_DIR}/cron-whatsapp-outbound.sh"
CRON_ENTRY_PROVIDER_OUTBOX="*/1 * * * * ${SCRIPT_DIR}/cron-provider-outbox.sh"
CRON_ENTRY_AI_PROVIDER_CATALOG="17 3 * * * ${SCRIPT_DIR}/cron-ai-provider-catalog.sh"
CRON_ENTRY_PUBLIC_SITE_DOMAINS="*/1 * * * * ${SCRIPT_DIR}/cron-public-site-domains.sh"
CRON_ENTRY_PROPERTY_MATCH_PROFILES="37 * * * * ${SCRIPT_DIR}/cron-property-match-profiles.sh"
CRON_ENTRY_PROPERTY_MATCH_CAMPAIGNS="*/1 * * * * ${SCRIPT_DIR}/cron-property-match-campaigns.sh"
CRON_ENTRY_PURGE_TRASH="0 3 * * * ${SCRIPT_DIR}/run-cron-endpoint.sh purge-trash 300"
CRON_ENTRY_SYNC_FEEDS="0 * * * * ${SCRIPT_DIR}/run-cron-endpoint.sh sync-feeds 300"
CRON_ENTRY_TASK_SYNC="*/1 * * * * ${SCRIPT_DIR}/run-cron-endpoint.sh task-sync 120"
CRON_ENTRY_SMS_RELAY_OUTBOX="*/1 * * * * ${SCRIPT_DIR}/run-cron-endpoint.sh sms-relay-outbox 120"

EXISTING_GMAIL=$(crontab -l 2>/dev/null | grep -F "cron-gmail-sync.sh" || true)
EXISTING_OUTLOOK=$(crontab -l 2>/dev/null | grep -F "cron-outlook-sync.sh" || true)
EXISTING_AI_RUNTIME=$(crontab -l 2>/dev/null | grep -F "cron-ai-automations.sh" || true)
EXISTING_TASK_REMINDERS=$(crontab -l 2>/dev/null | grep -F "cron-task-reminders.sh" || true)
EXISTING_SCHEDULED_MESSAGES=$(crontab -l 2>/dev/null | grep -E "cron-scheduled-messages\\.sh|api/cron/scheduled-messages" || true)
EXISTING_WHATSAPP_OUTBOUND=$(crontab -l 2>/dev/null | grep -F "cron-whatsapp-outbound.sh" || true)
EXISTING_PROVIDER_OUTBOX=$(crontab -l 2>/dev/null | grep -F "cron-provider-outbox.sh" || true)
EXISTING_AI_PROVIDER_CATALOG=$(crontab -l 2>/dev/null | grep -F "cron-ai-provider-catalog.sh" || true)
EXISTING_PUBLIC_SITE_DOMAINS=$(crontab -l 2>/dev/null | grep -F "cron-public-site-domains.sh" || true)
EXISTING_PROPERTY_MATCH_PROFILES=$(crontab -l 2>/dev/null | grep -F "cron-property-match-profiles.sh" || true)
EXISTING_PROPERTY_MATCH_CAMPAIGNS=$(crontab -l 2>/dev/null | grep -F "cron-property-match-campaigns.sh" || true)
EXISTING_PURGE_TRASH=$(crontab -l 2>/dev/null | grep -E "run-cron-endpoint\.sh purge-trash|api/cron/purge-trash" || true)
EXISTING_SYNC_FEEDS=$(crontab -l 2>/dev/null | grep -E "run-cron-endpoint\.sh sync-feeds|api/cron/sync-feeds" || true)
EXISTING_TASK_SYNC=$(crontab -l 2>/dev/null | grep -E "run-cron-endpoint\.sh task-sync|api/cron/task-sync" || true)
EXISTING_SMS_RELAY_OUTBOX=$(crontab -l 2>/dev/null | grep -E "run-cron-endpoint\.sh sms-relay-outbox|api/cron/sms-relay-outbox" || true)

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

if [ -n "${EXISTING_PUBLIC_SITE_DOMAINS}" ]; then
    echo "Public site domains cron entry already exists. Updating..."
    (crontab -l 2>/dev/null | grep -v "cron-public-site-domains.sh"; echo "${CRON_ENTRY_PUBLIC_SITE_DOMAINS}") | crontab -
else
    (crontab -l 2>/dev/null; echo "${CRON_ENTRY_PUBLIC_SITE_DOMAINS}") | crontab -
fi

if [ -n "${EXISTING_PROPERTY_MATCH_PROFILES}" ]; then
    echo "Property match profiles cron entry already exists. Updating..."
    (crontab -l 2>/dev/null | grep -v "cron-property-match-profiles.sh"; echo "${CRON_ENTRY_PROPERTY_MATCH_PROFILES}") | crontab -
else
    (crontab -l 2>/dev/null; echo "${CRON_ENTRY_PROPERTY_MATCH_PROFILES}") | crontab -
fi

if [ -n "${EXISTING_PROPERTY_MATCH_CAMPAIGNS}" ]; then
    echo "Property match campaigns cron entry already exists. Updating..."
    (crontab -l 2>/dev/null | grep -v "cron-property-match-campaigns.sh"; echo "${CRON_ENTRY_PROPERTY_MATCH_CAMPAIGNS}") | crontab -
else
    (crontab -l 2>/dev/null; echo "${CRON_ENTRY_PROPERTY_MATCH_CAMPAIGNS}") | crontab -
fi

if [ -n "${EXISTING_PURGE_TRASH}" ]; then
    echo "Purge trash cron entry already exists. Updating..."
    (crontab -l 2>/dev/null | grep -v -E "run-cron-endpoint\.sh purge-trash|api/cron/purge-trash"; echo "${CRON_ENTRY_PURGE_TRASH}") | crontab -
else
    (crontab -l 2>/dev/null; echo "${CRON_ENTRY_PURGE_TRASH}") | crontab -
fi

if [ -n "${EXISTING_SYNC_FEEDS}" ]; then
    echo "Property feed sync cron entry already exists. Updating..."
    (crontab -l 2>/dev/null | grep -v -E "run-cron-endpoint\.sh sync-feeds|api/cron/sync-feeds"; echo "${CRON_ENTRY_SYNC_FEEDS}") | crontab -
else
    (crontab -l 2>/dev/null; echo "${CRON_ENTRY_SYNC_FEEDS}") | crontab -
fi

if [ -n "${EXISTING_TASK_SYNC}" ]; then
    echo "Task sync cron entry already exists. Updating..."
    (crontab -l 2>/dev/null | grep -v -E "run-cron-endpoint\.sh task-sync|api/cron/task-sync"; echo "${CRON_ENTRY_TASK_SYNC}") | crontab -
else
    (crontab -l 2>/dev/null; echo "${CRON_ENTRY_TASK_SYNC}") | crontab -
fi

if [ -n "${EXISTING_SMS_RELAY_OUTBOX}" ]; then
    echo "SMS relay outbox cron entry already exists. Updating..."
    (crontab -l 2>/dev/null | grep -v -E "run-cron-endpoint\.sh sms-relay-outbox|api/cron/sms-relay-outbox"; echo "${CRON_ENTRY_SMS_RELAY_OUTBOX}") | crontab -
else
    (crontab -l 2>/dev/null; echo "${CRON_ENTRY_SMS_RELAY_OUTBOX}") | crontab -
fi

# Remove retired schedules that must never be reinstalled.
(crontab -l 2>/dev/null \
    | grep -v -E "api/cron/whatsapp-reconciliation|api/cron/contact-sync|api/cron/scheduled-tasks") \
    | crontab -

echo "✅ Cron jobs installed!"
echo ""
echo "Current crontab:"
crontab -l | grep -E "(gmail|outlook|ai-runtime|ai-automations|task-reminders|scheduled-messages|whatsapp-outbound|provider-outbox|ai-provider-catalog|public-site-domains|property-match-profiles|property-match-campaigns|purge-trash|sync-feeds|task-sync|sms-relay-outbox|estio)" || echo "(no estio-related entries)"
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
echo "   - Check logs: tail -f ${APP_DIR}/logs/public-site-domains-cron.log"
echo "   - Check logs: tail -f ${APP_DIR}/logs/property-match-profiles-cron.log"
echo "   - Check logs: tail -f ${APP_DIR}/logs/property-match-campaigns-cron.log"
echo "   - Check logs: tail -f ${APP_DIR}/logs/purge-trash-cron.log"
echo "   - Check logs: tail -f ${APP_DIR}/logs/sync-feeds-cron.log"
echo "   - Check logs: tail -f ${APP_DIR}/logs/task-sync-cron.log"
echo "   - Check logs: tail -f ${APP_DIR}/logs/sms-relay-outbox-cron.log"
echo "   - Test manually: ${SCRIPT_DIR}/cron-gmail-sync.sh"
echo "   - Test manually: ${SCRIPT_DIR}/cron-outlook-sync.sh"
echo "   - Test manually: ${SCRIPT_DIR}/cron-ai-automations.sh"
echo "   - Test manually: ${SCRIPT_DIR}/cron-task-reminders.sh"
echo "   - Test manually: ${SCRIPT_DIR}/cron-scheduled-messages.sh"
echo "   - Test manually: ${SCRIPT_DIR}/cron-whatsapp-outbound.sh"
echo "   - Test manually: ${SCRIPT_DIR}/cron-provider-outbox.sh"
echo "   - Test manually: ${SCRIPT_DIR}/cron-ai-provider-catalog.sh"
echo "   - Test manually: ${SCRIPT_DIR}/cron-public-site-domains.sh"
echo "   - Test manually: ${SCRIPT_DIR}/cron-property-match-profiles.sh"
echo "   - Test manually: ${SCRIPT_DIR}/cron-property-match-campaigns.sh"
echo "   - Test manually: ${SCRIPT_DIR}/run-cron-endpoint.sh purge-trash 300"
echo "   - Test manually: ${SCRIPT_DIR}/run-cron-endpoint.sh sync-feeds 300"
echo "   - Test manually: ${SCRIPT_DIR}/run-cron-endpoint.sh task-sync 120"
echo "   - Test manually: ${SCRIPT_DIR}/run-cron-endpoint.sh sms-relay-outbox 120"
echo ""
echo "🔐 Don't forget to set CRON_SECRET in your environment!"
