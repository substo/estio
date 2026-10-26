#!/bin/bash
# =============================================================================
# AI Provider Catalog Refresh Cron Job
# =============================================================================
# Refreshes dynamic AI provider catalogs, including Google Gemini model
# availability and official Gemini pricing metadata. Also refreshes OpenAI
# model names and official organization cost telemetry when configured.
# Intended to run once per day so user-facing AI calls do not fetch provider
# pricing or model catalogs on the hot path.
# =============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="${SCRIPT_DIR}/../logs"
LOG_FILE="${LOG_DIR}/ai-provider-catalog-cron.log"
LOCK_FILE="/tmp/ai-provider-catalog-cron.lock"
APP_URL="${APP_BASE_URL:-https://estio.co}"
# Use the credential for the currently deployed app. Crontab values can lag
# behind a rotated .env credential after a blue/green release.
# Clear the inherited value so Node's env-file reader prefers the deployed file.
# Node 20+ provides this without a dependency in the standalone bundle.
APP_CRON_SECRET="$(cd "${SCRIPT_DIR}/.." && env -u CRON_SECRET node --env-file=.env -e 'process.stdout.write(process.env.CRON_SECRET || "")' 2>/dev/null || true)"
CRON_SECRET="${APP_CRON_SECRET:-${CRON_SECRET:-}}"
TIMEOUT_SECONDS=240

mkdir -p "${LOG_DIR}"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "${LOG_FILE}"
}

find "${LOG_DIR}" -name "ai-provider-catalog-cron.log.*" -mtime +14 -delete 2>/dev/null || true

exec 200>"${LOCK_FILE}"
if ! flock -n 200; then
    log "SKIP: Another instance is already running"
    exit 0
fi

log "START: AI provider catalog refresh initiated"

CURL_ARGS=(-s -m "${TIMEOUT_SECONDS}" -w '%{http_code}')

if [ -n "${CRON_SECRET}" ]; then
    CURL_ARGS+=(-H "Authorization: Bearer ${CRON_SECRET}")
fi

RESPONSE=$(curl "${CURL_ARGS[@]}" "${APP_URL}/api/cron/ai-provider-catalog" 2>&1)
HTTP_CODE="${RESPONSE: -3}"
BODY="${RESPONSE:0:-3}"

if [ "${HTTP_CODE}" = "200" ]; then
    log "SUCCESS: HTTP ${HTTP_CODE} - ${BODY}"
else
    log "ERROR: HTTP ${HTTP_CODE} - ${BODY}"
fi

log "END: AI provider catalog refresh completed"
