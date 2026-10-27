#!/usr/bin/env bash
# Rehearse the realm-scoped identity and Substo brand migrations (expand,
# brands, contract) on a disposable local PostgreSQL cluster. Never point this
# at a real database.
#
#   bash scripts/test-user-auth-realm-db.sh
#
# USER_AUTH_REALM_BASE_REF selects the previous release's schema (default
# release/studio-go-live); USER_AUTH_REALM_TEST_PORT selects the local port.

set -euo pipefail

for task_binary in initdb pg_ctl createdb pg_isready psql npx git; do
    if ! command -v "$task_binary" >/dev/null 2>&1; then
        echo "Missing required test dependency: $task_binary" >&2
        exit 1
    fi
done

task_repo_root="$(git rev-parse --show-toplevel)"
task_temp_parent="${TMPDIR:-/tmp}"
task_temp_parent="${task_temp_parent%/}"
task_pg_root="$(mktemp -d "$task_temp_parent/estio-user-auth-realm-db.XXXXXX")"
task_pg_data="$task_pg_root/data"
task_pg_socket="$task_pg_root/socket"
task_pg_log="$task_pg_root/postgres.log"
task_pg_port="${USER_AUTH_REALM_TEST_PORT:-55441}"
task_database_name="estio_user_auth_realm_test"
task_base_ref="${USER_AUTH_REALM_BASE_REF:-release/studio-go-live}"
task_expand_sql="$task_repo_root/prisma/migrations/20261024160000_user_auth_realm_expand/migration.sql"
task_brands_sql="$task_repo_root/prisma/migrations/20261024170000_substo_brands/migration.sql"
task_websites_sql="$task_repo_root/prisma/migrations/20261025010000_substo_public_sites_expand/migration.sql"
task_contract_sql="$task_repo_root/prisma/migrations/20261024180000_user_auth_realm_contract/migration.sql"
task_location_names_sql="$task_repo_root/prisma/migrations/20261027010000_location_invitation_rename/migration.sql"

cleanup() {
    if [[ -f "$task_pg_data/postmaster.pid" ]]; then
        pg_ctl -D "$task_pg_data" -m immediate -w stop >/dev/null 2>&1 || true
    fi
    case "$task_pg_root" in
        "$task_temp_parent"/estio-user-auth-realm-db.*)
            rm -rf -- "$task_pg_root"
            ;;
        *)
            echo "Refusing to remove unexpected temporary path: $task_pg_root" >&2
            ;;
    esac
}
trap cleanup EXIT INT TERM

if pg_isready -h 127.0.0.1 -p "$task_pg_port" >/dev/null 2>&1; then
    echo "Port $task_pg_port is already in use; set USER_AUTH_REALM_TEST_PORT to an unused local port." >&2
    exit 1
fi

mkdir -p "$task_pg_socket"
initdb -A trust --no-locale -E UTF8 -U postgres -D "$task_pg_data" >/dev/null
pg_ctl -D "$task_pg_data" \
    -o "-F -h 127.0.0.1 -p $task_pg_port -k $task_pg_socket" \
    -l "$task_pg_log" -w start >/dev/null
createdb -h 127.0.0.1 -p "$task_pg_port" -U postgres "$task_database_name"

task_database_url="postgresql://postgres@127.0.0.1:$task_pg_port/$task_database_name?schema=public"
export DATABASE_URL="$task_database_url" DIRECT_URL="$task_database_url"
cd "$task_repo_root"

sql() { psql -X -q -t -A -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$task_pg_port" -U postgres -d "$task_database_name" "$@"; }
pass() { echo "ok - $1"; }
fail() { echo "not ok - $1" >&2; exit 1; }
expect_equal() { [[ "$2" == "$3" ]] && pass "$1" || fail "$1 (expected '$3', got '$2')"; }
expect_unique_violation() {
    local label="$1" statement="$2" constraint="$3" output
    if output="$(sql -c "$statement" 2>&1)"; then fail "$label (statement succeeded)"; fi
    [[ "$output" == *"$constraint"* ]] && pass "$label" || fail "$label (unexpected error: $output)"
}
expect_rejected() { expect_unique_violation "$@"; }
expect_no_drift() {
    local label="$1" schema_file="$2"
    if npx prisma migrate diff --from-url "$task_database_url" --to-schema-datamodel "$schema_file" --exit-code >"$task_pg_root/drift.txt" 2>&1; then
        pass "$label"
    else
        cat "$task_pg_root/drift.txt" >&2
        fail "$label"
    fi
}
new_user() { # id, email, clerkId-or-NULL, [realm]
    local realm_columns="" realm_values=""
    if [[ -n "${4:-}" ]]; then realm_columns=', "authRealm"'; realm_values=", '$4'"; fi
    echo "INSERT INTO \"User\" (id, email, \"clerkId\", \"updatedAt\"$realm_columns) VALUES ('$1', '$2', $3, now()$realm_values)"
}

echo "# 1. Previous release schema ($task_base_ref) with legacy users"
git show "$task_base_ref:prisma/schema.prisma" >"$task_pg_root/previous.prisma"
if grep -q "authRealm" "$task_pg_root/previous.prisma"; then fail "base ref $task_base_ref already contains authRealm"; fi
npx prisma db push --schema "$task_pg_root/previous.prisma" --skip-generate >/dev/null
sql -c "$(new_user legacy-1 shared@example.com "'user_estio_1'")"
sql -c "$(new_user legacy-2 invited@example.com NULL)"
sql -c "INSERT INTO \"Location\" (id, name, \"updatedAt\") VALUES ('estio-brand', 'Estio agency', now())"
sql -c "INSERT INTO \"_LocationToUser\" (\"A\", \"B\") VALUES ('estio-brand', 'legacy-1')"
sql -c "INSERT INTO \"UserLocationRole\" (id, \"userId\", \"locationId\", role, \"updatedAt\") VALUES ('role-1', 'legacy-1', 'estio-brand', 'ADMIN', now())"
expect_equal "global email index exists before expand" "$(sql -c "SELECT count(*) FROM pg_indexes WHERE tablename = 'User' AND indexname = 'User_email_key'")" "1"

echo "# 2. Expand migration"
sql -f "$task_expand_sql"
expect_equal "legacy rows backfilled as estio" "$(sql -c "SELECT string_agg(\"authRealm\"::text, ',' ORDER BY id) FROM \"User\"")" "estio,estio"
sql -c "$(new_user old-release-insert old@example.com "'user_estio_old'")"
expect_equal "previous-release insert without authRealm defaults to estio" "$(sql -c "SELECT \"authRealm\" FROM \"User\" WHERE id = 'old-release-insert'")" "estio"
expect_equal "previous-release email lookup still returns one row" "$(sql -c "SELECT count(*) FROM \"User\" WHERE email = 'shared@example.com'")" "1"
expect_unique_violation "expand: same email in substo fails closed on global email index" \
    "$(new_user substo-shared shared@example.com "'user_substo_1'" substo)" "User_email_key"
sql -c "$(new_user substo-only only@example.com "'user_substo_2'" substo)"
pass "expand: substo user with a new email can be created"
expect_unique_violation "Clerk ID stays globally unique across realms" \
    "$(new_user substo-clerk other@example.com "'user_estio_1'" substo)" "User_clerkId_key"

echo "# 3. Substo brands migration"
expect_equal "implicit membership table maps A to Location and B to User" \
    "$(sql -c "SELECT string_agg(a.attname || '->' || c.confrelid::regclass::text, ',' ORDER BY a.attname) FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1] WHERE c.conrelid = '\"_LocationToUser\"'::regclass AND c.contype = 'f'")" \
    'A->"Location",B->"User"'
sql -f "$task_brands_sql"
sed -e '/^  substoSiteSlug /d' -e '/^  substoSitePublished /d' -e '/^  substoSiteConfig /d' -e '/^model User {/,/^}/ s/^\(  email[[:space:]]*String\)$/\1 @unique/' -e "s/LocationInvitation/BrandInvitation/g" prisma/schema.prisma >"$task_pg_root/before-contract.prisma"
if cmp -s prisma/schema.prisma "$task_pg_root/before-contract.prisma"; then fail "could not derive the pre-contract schema"; fi
expect_no_drift "database matches the schema before the contract step" "$task_pg_root/before-contract.prisma"
expect_equal "legacy brand backfilled as estio" "$(sql -c "SELECT \"authRealm\" FROM \"Location\" WHERE id = 'estio-brand'")" "estio"
sql -c "INSERT INTO \"Location\" (id, name, \"updatedAt\") VALUES ('old-release-brand', 'Old release', now())"
sql -c "INSERT INTO \"_LocationToUser\" (\"A\", \"B\") VALUES ('old-release-brand', 'old-release-insert')"
sql -c "INSERT INTO \"UserLocationRole\" (id, \"userId\", \"locationId\", \"updatedAt\") VALUES ('role-old', 'old-release-insert', 'old-release-brand', now())"
pass "previous-release brand and membership inserts still work"
sql -c "INSERT INTO \"Location\" (id, name, \"authRealm\", \"updatedAt\") VALUES ('substo-brand', 'Substo brand', 'substo', now())"
sql -c "INSERT INTO \"_LocationToUser\" (\"A\", \"B\") VALUES ('substo-brand', 'substo-only')"
sql -c "INSERT INTO \"UserLocationRole\" (id, \"userId\", \"locationId\", role, \"updatedAt\") VALUES ('role-substo', 'substo-only', 'substo-brand', 'ADMIN', now())"
pass "substo user can join a substo brand"
expect_rejected "estio user cannot be connected to a substo brand" \
    "INSERT INTO \"_LocationToUser\" (\"A\", \"B\") VALUES ('substo-brand', 'legacy-1')" "different apps"
expect_rejected "substo user cannot get a role in an estio brand" \
    "INSERT INTO \"UserLocationRole\" (id, \"userId\", \"locationId\", \"updatedAt\") VALUES ('role-x', 'substo-only', 'estio-brand', now())" "different apps"
expect_rejected "an existing role cannot be moved to another app's brand" \
    "UPDATE \"UserLocationRole\" SET \"locationId\" = 'estio-brand' WHERE id = 'role-substo'" "different apps"
expect_rejected "invitation realm must match its brand" \
    "INSERT INTO \"BrandInvitation\" (id, \"locationId\", \"authRealm\", email, \"updatedAt\") VALUES ('inv-x', 'substo-brand', 'estio', 'a@example.com', now())" "different apps"
sql -c "INSERT INTO \"BrandInvitation\" (id, \"locationId\", \"authRealm\", email, \"updatedAt\") VALUES ('inv-1', 'substo-brand', 'substo', 'a@example.com', now())"
expect_rejected "an estio user cannot accept a substo invitation" \
    "UPDATE \"BrandInvitation\" SET \"acceptedById\" = 'legacy-1', status = 'ACCEPTED' WHERE id = 'inv-1'" "different apps"
expect_rejected "one invitation row per brand and email" \
    "INSERT INTO \"BrandInvitation\" (id, \"locationId\", \"authRealm\", email, \"updatedAt\") VALUES ('inv-2', 'substo-brand', 'substo', 'a@example.com', now())" "BrandInvitation_locationId_email_key"
expect_rejected "a user's app cannot change" "UPDATE \"User\" SET \"authRealm\" = 'substo' WHERE id = 'legacy-2'" "cannot change"
expect_rejected "a brand's app cannot change" "UPDATE \"Location\" SET \"authRealm\" = 'substo' WHERE id = 'estio-brand'" "cannot change"
expect_rejected "a Studio workspace maps to at most one brand" \
    "UPDATE \"Location\" SET \"studioWorkspaceId\" = 'ws-1' WHERE id IN ('substo-brand', 'old-release-brand')" "Location_studioWorkspaceId_key"
expect_equal "estio memberships unchanged" "$(sql -c "SELECT count(*) FROM \"_LocationToUser\" WHERE \"A\" = 'estio-brand'")" "1"

echo "# 4. Contract step (later release)"
sql -c "CREATE TABLE _prisma_migrations (migration_name text, finished_at timestamptz, rolled_back_at timestamptz)"
sql -c "INSERT INTO _prisma_migrations VALUES ('20261024160000_user_auth_realm_expand', now(), NULL)"
expect_rejected "contract refuses to run in the same deploy as the expand step" "$(cat "$task_contract_sql")" "Deploy the realm identity expand release first"
sql -c "UPDATE _prisma_migrations SET finished_at = now() - interval '1 hour'"
sql -f "$task_contract_sql"
sql -c "DROP TABLE _prisma_migrations"
expect_equal "global email index dropped" "$(sql -c "SELECT count(*) FROM pg_indexes WHERE tablename = 'User' AND indexname = 'User_email_key'")" "0"
sql -f "$task_websites_sql"
sql -f "$task_location_names_sql"
expect_equal "invitation rows kept by the rename" "$(sql -c "SELECT string_agg(id, ',' ORDER BY id) FROM \"LocationInvitation\"")" "inv-1"
expect_rejected "renamed invitation table still enforces the app" \
    "UPDATE \"LocationInvitation\" SET \"acceptedById\" = 'legacy-1', status = 'ACCEPTED' WHERE id = 'inv-1'" "different apps"
expect_no_drift "database matches prisma/schema.prisma after the website expand step" "prisma/schema.prisma"
sql -c "$(new_user substo-shared shared@example.com "'user_substo_1'" substo)"
expect_equal "same email exists once per realm" "$(sql -c "SELECT string_agg(\"authRealm\"::text || ':' || id, ',' ORDER BY \"authRealm\") FROM \"User\" WHERE email = 'shared@example.com'")" "estio:legacy-1,substo:substo-shared"
expect_unique_violation "same email twice in one realm is rejected" \
    "$(new_user estio-dupe shared@example.com "'user_estio_9'" estio)" "User_authRealm_email_key"
expect_unique_violation "Clerk ID stays globally unique after contract" \
    "$(new_user substo-clerk-2 other2@example.com "'user_estio_1'" substo)" "User_clerkId_key"
expect_equal "estio row untouched by substo writes" "$(sql -c "SELECT \"clerkId\" FROM \"User\" WHERE id = 'legacy-1'")" "user_estio_1"

echo "# 5. Brand service against the migrated database"
LOCATIONS_TEST_DATABASE_URL="$task_database_url" npx tsx --test --test-concurrency=1 lib/locations/location-service.db.test.ts lib/substo-sites/service.db.test.ts

echo "# All user auth realm migration checks passed"
