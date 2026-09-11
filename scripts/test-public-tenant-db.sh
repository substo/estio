#!/usr/bin/env bash

set -euo pipefail

for task_binary in initdb pg_ctl createdb pg_isready npx; do
    if ! command -v "$task_binary" >/dev/null 2>&1; then
        echo "Missing required test dependency: $task_binary" >&2
        exit 1
    fi
done

task_repo_root="$(git rev-parse --show-toplevel)"
task_temp_parent="${TMPDIR:-/tmp}"
task_pg_root="$(mktemp -d "$task_temp_parent/estio-public-tenant-db.XXXXXX")"
task_pg_data="$task_pg_root/data"
task_pg_socket="$task_pg_root/socket"
task_pg_log="$task_pg_root/postgres.log"
task_pg_port="${PUBLIC_TENANT_TEST_PORT:-55439}"
task_database_name="estio_public_tenant_test"

cleanup() {
    if [[ -f "$task_pg_data/postmaster.pid" ]]; then
        pg_ctl -D "$task_pg_data" -m immediate -w stop >/dev/null 2>&1 || true
    fi
    case "$task_pg_root" in
        "$task_temp_parent"/estio-public-tenant-db.*)
            rm -rf -- "$task_pg_root"
            ;;
        *)
            echo "Refusing to remove unexpected temporary path: $task_pg_root" >&2
            ;;
    esac
}
trap cleanup EXIT INT TERM

if pg_isready -h 127.0.0.1 -p "$task_pg_port" >/dev/null 2>&1; then
    echo "Port $task_pg_port is already in use; set PUBLIC_TENANT_TEST_PORT to an unused local port." >&2
    exit 1
fi

mkdir -p "$task_pg_socket"
initdb -A trust --no-locale -E UTF8 -U postgres -D "$task_pg_data" >/dev/null
pg_ctl -D "$task_pg_data" \
    -o "-F -h 127.0.0.1 -p $task_pg_port -k $task_pg_socket" \
    -l "$task_pg_log" -w start >/dev/null
createdb -h 127.0.0.1 -p "$task_pg_port" -U postgres "$task_database_name"

task_database_url="postgresql://postgres@127.0.0.1:$task_pg_port/$task_database_name?schema=public"

cd "$task_repo_root"
DATABASE_URL="$task_database_url" DIRECT_URL="$task_database_url" \
    npx prisma db push --skip-generate
DATABASE_URL="$task_database_url" DIRECT_URL="$task_database_url" \
    PUBLIC_TENANT_TEST_DATABASE_URL="$task_database_url" \
    npx tsx --test app/actions/public-user-location-isolation.db.test.ts
