#!/usr/bin/env bash
# Read-only database export. Credentials belong in a private pg_service.conf.
set -euo pipefail
if [[ $# != 2 || ! "$1" =~ ^[a-zA-Z0-9_-]+$ || "$2" != /* ]]; then
  echo 'Usage: bash scripts/backup-unified-database.sh SERVICE /absolute/new-backup-directory' >&2
  exit 1
fi
for tool in pg_dump pg_restore shasum; do
  command -v "$tool" >/dev/null || { echo "Missing tool: $tool" >&2; exit 1; }
done
umask 077
# Refuse reuse so an earlier verified recovery point cannot be overwritten.
mkdir "$2"
cd "$2"
# No --schema filter: public, studio, functions, migration ledger and other
# application schemas must be captured in the same consistent snapshot.
pg_dump --format=custom --file=database.dump "service=$1"
pg_restore --list database.dump > database.toc
for schema in public studio; do
  if ! grep -Eq " SCHEMA - ${schema} " database.toc; then
    echo "Incomplete unified backup: missing ${schema} schema; retain for diagnosis only" >&2
    exit 1
  fi
done
# Decode the complete archive, not just its table of contents. No restore runs.
pg_restore --file=/dev/null database.dump
shasum -a 256 database.dump database.toc > SHA256SUMS
printf '%s\n' 'Unified database archive decoded and checksummed. Restore drill still required.'
