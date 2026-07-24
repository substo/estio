#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="${SCRIPT_DIR}/../logs"
LOG_FILE="${LOG_DIR}/property-match-campaigns-cron.log"
LOCK_FILE="/tmp/property-match-campaigns-cron.lock"
ENV_FILE="${SCRIPT_DIR}/../.env"

if [ -f "${ENV_FILE}" ]; then
    set -a
    . "${ENV_FILE}"
    set +a
fi

APP_URL="${APP_BASE_URL:-https://estio.co}"
CRON_SECRET="${CRON_SECRET:-}"
CAMPAIGN_BATCH="${PROPERTY_MATCH_CAMPAIGN_CRON_CAMPAIGNS:-2}"
CANDIDATE_BATCH="${PROPERTY_MATCH_CAMPAIGN_CRON_CANDIDATES:-10}"

mkdir -p "${LOG_DIR}"
find "${LOG_DIR}" -name "property-match-campaigns-cron.log.*" -mtime +14 -delete 2>/dev/null || true
exec 200>"${LOCK_FILE}"
flock -n 200 || exit 0

AUTH_ARGS=()
if [ -n "${CRON_SECRET}" ]; then
    AUTH_ARGS=(-H "Authorization: Bearer ${CRON_SECRET}")
fi

ENDPOINT="${APP_URL}/api/cron/property-match-campaigns?campaigns=${CAMPAIGN_BATCH}&candidates=${CANDIDATE_BATCH}"
if ! RESPONSE=$(curl -sS -m 240 -w $'\n%{http_code}' "${AUTH_ARGS[@]}" "${ENDPOINT}" 2>&1); then
    printf '[%s] ERROR - %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "${RESPONSE}" >> "${LOG_FILE}"
    exit 1
fi

HTTP_CODE=$(printf '%s' "${RESPONSE}" | tail -n 1)
BODY=$(printf '%s' "${RESPONSE}" | sed '$d')
printf '[%s] HTTP %s - %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "${HTTP_CODE}" "${BODY}" >> "${LOG_FILE}"

case "${HTTP_CODE}" in
    2*) ;;
    *) exit 1 ;;
esac
