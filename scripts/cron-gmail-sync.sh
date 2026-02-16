#!/bin/bash
# =============================================================================
# Gmail Sync Cron Job
# =============================================================================
# This script is called by system crontab every 5 minutes to sync Gmail.
#
# Best Practices Implemented:
# 1. Mutual Exclusion (flock) - Prevents overlapping runs
# 2. Logging with rotation - Keeps last 7 days of logs
# 3. Timeout - Prevents hanging forever
# 4. Error reporting - Logs failures for debugging
# 5. Health monitoring - Timestamps for observability
# =============================================================================

set -e

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="${SCRIPT_DIR}/../logs"
LOG_FILE="${LOG_DIR}/gmail-sync-cron.log"
LOCK_FILE="/tmp/gmail-sync-cron.lock"
APP_URL="${APP_BASE_URL:-https://app.estio.co}"
CRON_SECRET="${CRON_SECRET:-}"
TIMEOUT_SECONDS=1800  # 30 minutes (allow long running syncs, managed by lock file)

# Ensure log directory exists
mkdir -p "${LOG_DIR}"

# Function to log with timestamp
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "${LOG_FILE}"
}

# Rotate logs (keep last 7 days)
find "${LOG_DIR}" -name "gmail-sync-cron.log.*" -mtime +7 -delete 2>/dev/null || true

# Use flock for mutual exclusion - if another instance is running, exit silently
exec 200>"${LOCK_FILE}"
if ! flock -n 200; then
    log "SKIP: Another instance is already running"
    exit 0
fi

# Main execution
log "START: Gmail sync job initiated"

# Build curl command
CURL_CMD="curl -s -m ${TIMEOUT_SECONDS} -w '%{http_code}'"

if [ -n "${CRON_SECRET}" ]; then
    CURL_CMD="${CURL_CMD} -H 'Authorization: Bearer ${CRON_SECRET}'"
fi

CURL_CMD="${CURL_CMD} '${APP_URL}/api/cron/gmail-sync'"

# Execute and capture response
RESPONSE=$(eval "${CURL_CMD}" 2>&1)
HTTP_CODE="${RESPONSE: -3}"
BODY="${RESPONSE:0:-3}"

# Log result
if [ "${HTTP_CODE}" = "200" ]; then
    log "SUCCESS: HTTP ${HTTP_CODE} - ${BODY}"
else
    log "ERROR: HTTP ${HTTP_CODE} - ${BODY}"
fi

log "END: Gmail sync job completed"

# Release lock automatically when script exits
