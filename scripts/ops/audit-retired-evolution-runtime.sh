#!/usr/bin/env bash
set -euo pipefail

REMOVE=false
if [ "${1:-}" = "--remove" ]; then
    REMOVE=true
fi

match_lines() {
    local label="$1"
    shift

    echo "## $label"
    "$@" || true
    echo
}

match_lines "Docker containers" sh -c "command -v docker >/dev/null 2>&1 && docker ps -a --format '{{.Names}} {{.Image}} {{.Status}}' | grep -i evolution"
match_lines "Docker volumes" sh -c "command -v docker >/dev/null 2>&1 && docker volume ls --format '{{.Name}}' | grep -i evolution"
match_lines "Docker networks" sh -c "command -v docker >/dev/null 2>&1 && docker network ls --format '{{.Name}}' | grep -i evolution"
match_lines "Docker images" sh -c "command -v docker >/dev/null 2>&1 && docker images --format '{{.Repository}}:{{.Tag}} {{.ID}}' | grep -i evolution"
match_lines "PM2 processes/env keys" sh -c "command -v pm2 >/dev/null 2>&1 && pm2 jlist | node -e '
let input = \"\";
process.stdin.on(\"data\", chunk => input += chunk);
process.stdin.on(\"end\", () => {
  try {
    const apps = JSON.parse(input);
    for (const app of apps) {
      const name = String(app?.name || \"\");
      const env = { ...(app?.pm2_env || {}), ...(app?.pm2_env?.env || {}) };
      const keys = Object.keys(env).filter((key) => /evolution/i.test(key) || /evolution/i.test(String(env[key] || \"\")));
      if (/evolution/i.test(name) || keys.length > 0) {
        console.log((name || \"unknown\") + \": \" + keys.sort().join(\", \"));
      }
    }
  } catch {}
});
'"
match_lines "Systemd units" sh -c "find /etc/systemd/system /lib/systemd/system -maxdepth 2 -type f 2>/dev/null | xargs grep -Ili evolution 2>/dev/null"
match_lines "Cron entries" sh -c "grep -Rli evolution /etc/cron* /var/spool/cron 2>/dev/null"
match_lines "Caddy config" sh -c "grep -Rli evolution /etc/caddy 2>/dev/null"
match_lines "Home runtime files" sh -c "find /home/martin -maxdepth 4 -iname '*evolution*' 2>/dev/null | grep -v '/prisma/migrations/'"

if [ "$REMOVE" != "true" ]; then
    echo "Run with --remove on the server to remove known retired runtime artifacts."
    exit 0
fi

if command -v docker >/dev/null 2>&1; then
    CONTAINERS=$(docker ps -a --format '{{.Names}}' | grep -Ei '^(evolution|evolution_.*)$' || true)
    if [ -n "$CONTAINERS" ]; then
        docker rm -f $CONTAINERS
    fi

    VOLUMES=$(docker volume ls --format '{{.Name}}' | grep -i evolution || true)
    if [ -n "$VOLUMES" ]; then
        docker volume rm $VOLUMES
    fi

    NETWORKS=$(docker network ls --format '{{.Name}}' | grep -i evolution || true)
    if [ -n "$NETWORKS" ]; then
        docker network rm $NETWORKS
    fi

    IMAGE_IDS=$(docker images --format '{{.Repository}} {{.ID}}' | awk 'tolower($1) ~ /evolution/ { print $2 }' | sort -u || true)
    if [ -n "$IMAGE_IDS" ]; then
        docker rmi $IMAGE_IDS
    fi
fi

if command -v pm2 >/dev/null 2>&1; then
    PM2_IDS=$(pm2 jlist | node -e '
let input = "";
process.stdin.on("data", chunk => input += chunk);
process.stdin.on("end", () => {
  try {
    for (const app of JSON.parse(input)) {
      if (/evolution/i.test(String(app?.name || ""))) console.log(app.pm_id);
    }
  } catch {}
});
' || true)
    if [ -n "$PM2_IDS" ]; then
        pm2 delete $PM2_IDS
        pm2 save
    fi
fi

rm -rf /home/martin/logs/evolution

echo "Removal pass complete. Re-run without --remove to inspect remaining references."
