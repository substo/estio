#!/usr/bin/env bash
# Real SQL for the Mac device wrapper chain (voice preview in front of video assembly/edit loop): every suite on a fresh cluster with ALL migrations in a disposable PostgreSQL 17 cluster. No credentials, network or providers.
set -euo pipefail
export LC_ALL=en_US.UTF-8 LANG=en_US.UTF-8
cd "$(dirname "$0")/.."
for pg in /opt/homebrew/opt/postgresql@17/bin /usr/lib/postgresql/17/bin; do [ -x "$pg/initdb" ] && PATH="$pg:$PATH"; done
for binary in initdb pg_ctl psql; do command -v "$binary" >/dev/null; done
[[ "$(pg_ctl --version)" == *" 17."* ]] || { echo "PostgreSQL 17 is required" >&2; exit 1; }
for assertions in video-assembly-assertions edit-loop-assertions voices-assertions voices-studio-assertions voice-local-clone-assertions workspace-timeline-assertions storyboard-assertions; do
test_dir=$(mktemp -d "${TMPDIR:-/tmp}/estio-chain.XXXXXX")
cleanup() { pg_ctl -D "$test_dir/db" -m immediate -w stop >/dev/null 2>&1 || true; rm -rf "$test_dir"; }
trap cleanup EXIT
initdb -D "$test_dir/db" --username=studio_test --no-locale --encoding=UTF8 --auth=trust >"$test_dir/init.log"
mkdir "$test_dir/socket"
pg_ctl -D "$test_dir/db" -l "$test_dir/server.log" -o "-k $test_dir/socket -h '' -p 55444" -w start >/dev/null
run=(env -u PGSERVICE -u PGHOSTADDR -u PGOPTIONS psql --no-psqlrc --host="$test_dir/socket" --port=55444 --username=studio_test --dbname=postgres --set=ON_ERROR_STOP=1)
"${run[@]}" --file=studio/tests/crm-fixture.sql --file=prisma/migrations/20261028100000_studio_schema/migration.sql --file=studio/tests/crm-fixture-writes.sql >"$test_dir/setup.log"
for migration in 20261028190000_brand_profile 20261105100000_studio_ai_key_from_settings 20261105140000_studio_library_summary 20261106120000_studio_device_onboarding_research 20261118120000_studio_text_subscription 20261118130000_studio_video_transcription 20261118160000_studio_knowledge_outline 20261118170000_studio_script_templates 20261118180000_studio_video_template_extraction 20261118190000_studio_youtube_mac_search 20261119100000_studio_youtube_egress_search 20261119120000_studio_related_search_ranking 20261119140000_studio_source_assistant 20261119170000_studio_knowledge_review_curation 20261119180000_studio_knowledge_batch_retry 20261120120000_studio_staged_creation 20261120120001_ai_route_chain 20261120120002_crm_ai_route_budget 20261120120003_studio_device_ai_routes 20261126100000_studio_video_assembly 20261127100000_studio_voices 20261128100000_studio_edit_loop 20261130100000_studio_voices_studio 20261201130000_studio_workspace_timeline 20261201140000_studio_voice_local_clone 20261201150000_studio_storyboard; do
 "${run[@]}" --file="prisma/migrations/$migration/migration.sql" >>"$test_dir/setup.log"
done
"${run[@]}" --file="studio/tests/$assertions.sql" >"$test_dir/assertions.log"
echo "passed: $assertions"
cleanup; trap - EXIT
done
echo 'Studio device wrapper chain disposable PostgreSQL 17 tests passed.'
