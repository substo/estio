#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="${SCRIPT_DIR}/../logs"
LOG_FILE="${LOG_DIR}/public-site-domains-cron.log"
LOCK_FILE="/tmp/public-site-domains-cron.lock"
APP_URL="${APP_BASE_URL:-https://estio.co}"
CRON_SECRET="${CRON_SECRET:-}"

mkdir -p "${LOG_DIR}"
find "${LOG_DIR}" -name "public-site-domains-cron.log.*" -mtime +7 -delete 2>/dev/null || true
exec 200>"${LOCK_FILE}"
flock -n 200 || exit 0

AUTH_ARGS=()
if [ -n "${CRON_SECRET}" ]; then
    AUTH_ARGS=(-H "Authorization: Bearer ${CRON_SECRET}")
fi

RESPONSE=$(curl -sS -m 55 -w $'\n%{http_code}' "${AUTH_ARGS[@]}" "${APP_URL}/api/cron/public-site-domains" 2>&1 || true)
HTTP_CODE=$(printf '%s' "${RESPONSE}" | tail -n 1)
BODY=$(printf '%s' "${RESPONSE}" | sed '$d')
printf '[%s] HTTP %s - %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "${HTTP_CODE}" "${BODY}" >> "${LOG_FILE}"
