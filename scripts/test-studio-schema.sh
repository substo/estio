#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
for binary in initdb pg_ctl psql rg; do command -v "$binary" >/dev/null || { echo "Missing PostgreSQL binary: $binary" >&2; exit 1; }; done
studio_test_dir=$(mktemp -d "${TMPDIR:-/tmp}/estio-studio-test.XXXXXX")
cleanup() {
  pg_ctl -D "$studio_test_dir/db" -m immediate -w stop >/dev/null 2>&1 || true
  rm -rf "$studio_test_dir"
}
trap cleanup EXIT
initdb -D "$studio_test_dir/db" --username=studio_test --no-locale --encoding=UTF8 --auth=trust >"$studio_test_dir/init.log"
mkdir "$studio_test_dir/socket"
# No TCP listener, existing database, credentials, or production environment used.
pg_ctl -D "$studio_test_dir/db" -l "$studio_test_dir/server.log" -o "-k $studio_test_dir/socket -h '' -p 55439" -w start >/dev/null
env -u PGSERVICE -u PGHOSTADDR -u PGOPTIONS psql --no-psqlrc --host="$studio_test_dir/socket" --port=55439 --username=studio_test --dbname=postgres --set=ON_ERROR_STOP=1 \
  --file=studio/tests/bootstrap.sql \
  --file=studio/supabase/migrations/20261022000000_studio_workspace_core.sql \
  --file=studio/supabase/migrations/20261022010000_studio_library.sql \
  --file=studio/supabase/migrations/20261022020000_studio_library_import.sql \
  --file=studio/supabase/migrations/20261022030000_studio_knowledge.sql \
  --file=studio/supabase/migrations/20261022040000_studio_knowledge_import.sql \
  --file=studio/supabase/migrations/20261022050000_studio_knowledge_review.sql \
  --file=studio/supabase/migrations/20261023000000_studio_schedules.sql \
  --file=studio/supabase/migrations/20261023010000_studio_schedule_import.sql \
  --file=studio/supabase/migrations/20261023020000_studio_record_link_editing.sql \
  --file=studio/supabase/migrations/20261023030000_studio_legacy_media_reconciliation.sql \
  --file=studio/supabase/migrations/20261023040000_studio_knowledge_media.sql \
  --file=studio/supabase/migrations/20261024000000_studio_ai_credentials.sql \
  --file=studio/supabase/migrations/20261024010000_studio_jobs.sql \
  --file=studio/supabase/migrations/20261024020000_studio_uploads.sql \
  --file=studio/supabase/migrations/20261024030000_platform_youtube_discovery.sql \
  --file=studio/tests/assertions.sql \
  --file=studio/tests/import-assertions.sql \
  --file=studio/tests/knowledge-assertions.sql \
  --file=studio/tests/knowledge-import-assertions.sql \
  --file=studio/tests/knowledge-review-assertions.sql \
  --file=studio/tests/schedule-assertions.sql \
  --file=studio/tests/schedule-import-assertions.sql \
  --file=studio/tests/record-link-assertions.sql \
  --file=studio/tests/media-reconciliation-assertions.sql \
  --file=studio/tests/knowledge-media-assertions.sql \
  --file=studio/tests/ai-credentials-assertions.sql \
  --file=studio/tests/jobs-assertions.sql \
  --file=studio/tests/uploads-assertions.sql \
  --file=studio/tests/youtube-discovery-assertions.sql \
  --file=studio/supabase/migrations/20261024040000_studio_paid_attempt_reliability.sql \
  --file=studio/tests/paid-attempt-reliability-assertions.sql \
  --file=studio/supabase/migrations/20261024050000_studio_transcription_reconciliation.sql \
  --file=studio/tests/transcription-reconciliation-assertions.sql \
  --file=studio/supabase/migrations/20261024060000_studio_idea_review.sql \
  --file=studio/tests/idea-review-assertions.sql \
  --file=studio/supabase/migrations/20261024070000_studio_script_briefs.sql \
  --file=studio/tests/script-brief-assertions.sql \
  --file=studio/supabase/migrations/20261024080000_studio_knowledge_extraction.sql \
  --file=studio/tests/knowledge-extraction-assertions.sql \
  --file=studio/supabase/migrations/20261024090000_studio_schedule_run_now.sql \
  --file=studio/tests/schedule-execution-assertions.sql \
  --file=studio/supabase/migrations/20261024100000_studio_recurring_schedules.sql \
  --file=studio/tests/recurring-schedule-assertions.sql \
  --file=studio/supabase/migrations/20261024110000_studio_youtube_schedules.sql \
  --file=studio/tests/youtube-schedule-assertions.sql \
  --file=studio/supabase/migrations/20261024120000_studio_knowledge_edit_topics.sql \
  --file=studio/tests/knowledge-edit-topics-assertions.sql \
  --file=studio/supabase/migrations/20261024130000_platform_profile_deletion.sql \
  --file=studio/tests/profile-deletion-assertions.sql \
  --file=studio/supabase/migrations/20261024140000_studio_upload_recovery.sql \
  --file=studio/tests/upload-recovery-assertions.sql \
  --file=studio/supabase/migrations/20261024150000_studio_readiness.sql \
  --file=studio/tests/readiness-assertions.sql \
  --file=studio/supabase/migrations/20261026000000_studio_youtube_run_now.sql \
  --file=studio/tests/youtube-run-now-assertions.sql \
  --file=studio/supabase/migrations/20261026010000_studio_mac_devices.sql \
  --file=studio/tests/devices-assertions.sql
bash studio/tests/devices-concurrency.sh "$studio_test_dir/socket" "$studio_test_dir"
bash studio/tests/transcription-reconciliation-concurrency.sh "$studio_test_dir/socket" "$studio_test_dir"
bash studio/tests/script-brief-concurrency.sh "$studio_test_dir/socket" "$studio_test_dir"
bash studio/tests/knowledge-extraction-concurrency.sh "$studio_test_dir/socket" "$studio_test_dir"
bash studio/tests/schedule-execution-concurrency.sh "$studio_test_dir/socket" "$studio_test_dir"
bash studio/tests/recurring-schedule-concurrency.sh "$studio_test_dir/socket" "$studio_test_dir"
bash studio/tests/youtube-schedule-concurrency.sh "$studio_test_dir/socket" "$studio_test_dir"
bash studio/tests/knowledge-edit-topics-concurrency.sh "$studio_test_dir/socket" "$studio_test_dir"
bash studio/tests/profile-deletion-concurrency.sh "$studio_test_dir/socket" "$studio_test_dir"
bash studio/tests/upload-recovery-concurrency.sh "$studio_test_dir/socket" "$studio_test_dir"
bash studio/tests/recovery-rehearsal.sh "$studio_test_dir/socket" "$studio_test_dir"
