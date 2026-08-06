#!/bin/bash
# Run a named Estio cron route with consistent locking, authentication, and logs.

set -e

JOB_NAME="${1:-}"
TIMEOUT_SECONDS="${2:-120}"

if [[ ! "${JOB_NAME}" =~ ^[a-z0-9-]+$ ]]; then
    echo "Usage: $0 <job-name> [timeout-seconds]" >&2
    exit 2
fi

if [[ ! "${TIMEOUT_SECONDS}" =~ ^[0-9]+$ ]] || [ "${TIMEOUT_SECONDS}" -lt 1 ]; then
    echo "Timeout must be a positive integer" >&2
    exit 2
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="${SCRIPT_DIR}/../logs"
LOG_FILE="${LOG_DIR}/${JOB_NAME}-cron.log"
LOCK_FILE="/tmp/${JOB_NAME}-cron.lock"
APP_URL="${APP_BASE_URL:-https://estio.co}"
CRON_SECRET="${CRON_SECRET:-}"

mkdir -p "${LOG_DIR}"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "${LOG_FILE}"
}

find "${LOG_DIR}" -name "${JOB_NAME}-cron.log.*" -mtime +14 -delete 2>/dev/null || true

exec 200>"${LOCK_FILE}"
if ! flock -n 200; then
    log "SKIP: Another instance is already running"
    exit 0
fi

AUTH_ARGS=()
if [ -n "${CRON_SECRET}" ]; then
    AUTH_ARGS=(-H "Authorization: Bearer ${CRON_SECRET}")
fi

log "START: ${JOB_NAME}"

if ! RESPONSE=$(curl -sS -m "${TIMEOUT_SECONDS}" -w $'\n%{http_code}' "${AUTH_ARGS[@]}" "${APP_URL}/api/cron/${JOB_NAME}" 2>&1); then
    log "ERROR: curl failed - ${RESPONSE}"
    exit 1
fi

HTTP_CODE="${RESPONSE##*$'\n'}"
BODY="${RESPONSE%$'\n'*}"

if [ "${HTTP_CODE}" = "200" ]; then
    log "SUCCESS: HTTP ${HTTP_CODE} - ${BODY}"
else
    log "ERROR: HTTP ${HTTP_CODE} - ${BODY}"
    exit 1
fi

log "END: ${JOB_NAME}"
