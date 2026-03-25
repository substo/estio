#!/bin/bash
# =============================================================================
# WhatsApp Outbound Recovery Cron Job
# =============================================================================
# This script sweeps due WhatsApp outbox rows and re-enqueues them for dispatch.
# It is safe to run every minute; server-side CronGuard prevents overlap.
# =============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="${SCRIPT_DIR}/../logs"
LOG_FILE="${LOG_DIR}/whatsapp-outbound-cron.log"
LOCK_FILE="/tmp/whatsapp-outbound-cron.lock"
APP_URL="${APP_BASE_URL:-https://estio.co}"
CRON_SECRET="${CRON_SECRET:-}"
TIMEOUT_SECONDS=55

mkdir -p "${LOG_DIR}"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "${LOG_FILE}"
}

find "${LOG_DIR}" -name "whatsapp-outbound-cron.log.*" -mtime +7 -delete 2>/dev/null || true

exec 200>"${LOCK_FILE}"
if ! flock -n 200; then
    log "SKIP: Another instance is already running"
    exit 0
fi

log "START: WhatsApp outbound recovery sweep initiated"

CURL_CMD="curl -s -m ${TIMEOUT_SECONDS} -w '%{http_code}'"

if [ -n "${CRON_SECRET}" ]; then
    CURL_CMD="${CURL_CMD} -H 'Authorization: Bearer ${CRON_SECRET}'"
fi

CURL_CMD="${CURL_CMD} '${APP_URL}/api/cron/whatsapp-outbound'"

RESPONSE=$(eval "${CURL_CMD}" 2>&1)
HTTP_CODE="${RESPONSE: -3}"
BODY="${RESPONSE:0:-3}"

if [ "${HTTP_CODE}" = "200" ]; then
    log "SUCCESS: HTTP ${HTTP_CODE} - ${BODY}"
else
    log "ERROR: HTTP ${HTTP_CODE} - ${BODY}"
fi

log "END: WhatsApp outbound recovery sweep completed"
