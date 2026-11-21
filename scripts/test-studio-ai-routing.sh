#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
for binary in initdb pg_ctl psql; do command -v "$binary" >/dev/null; done
routing_test_dir=$(mktemp -d "${TMPDIR:-/tmp}/estio-studio-test.XXXXXX")
cleanup() { pg_ctl -D "$routing_test_dir/db" -m immediate -w stop >/dev/null 2>&1 || true; rm -rf "$routing_test_dir"; }
trap cleanup EXIT
initdb -D "$routing_test_dir/db" --username=studio_test --no-locale --encoding=UTF8 --auth=trust >"$routing_test_dir/init.log"
mkdir "$routing_test_dir/socket"
pg_ctl -D "$routing_test_dir/db" -l "$routing_test_dir/server.log" -o "-k $routing_test_dir/socket -h '' -p 55439" -w start >/dev/null
routing_psql=(env -u PGSERVICE -u PGHOSTADDR -u PGOPTIONS psql --no-psqlrc --host="$routing_test_dir/socket" --port=55439 --username=studio_test --dbname=postgres --set=ON_ERROR_STOP=1)
"${routing_psql[@]}" --file=studio/tests/crm-fixture.sql --file=prisma/migrations/20261028100000_studio_schema/migration.sql --file=studio/tests/crm-fixture-writes.sql >"$routing_test_dir/setup.log"
for migration in 20261028190000_brand_profile 20261105100000_studio_ai_key_from_settings 20261105140000_studio_library_summary 20261106120000_studio_device_onboarding_research 20261118120000_studio_text_subscription 20261118130000_studio_video_transcription 20261118160000_studio_knowledge_outline 20261118170000_studio_script_templates 20261118180000_studio_video_template_extraction 20261118190000_studio_youtube_mac_search 20261119100000_studio_youtube_egress_search 20261119120000_studio_related_search_ranking 20261119140000_studio_source_assistant 20261119170000_studio_knowledge_review_curation 20261119180000_studio_knowledge_batch_retry 20261120120000_studio_staged_creation 20261120120001_ai_route_chain 20261120120002_crm_ai_route_budget 20261120120003_studio_device_ai_routes 20261121120000_studio_agent_conversation; do
 "${routing_psql[@]}" --file="prisma/migrations/$migration/migration.sql" >>"$routing_test_dir/setup.log"
done
"${routing_psql[@]}" --file=studio/tests/text-provider-assertions.sql --file=studio/tests/knowledge-outline-assertions.sql \
  --file=studio/tests/video-transcription-assertions.sql --file=studio/tests/video-template-assertions.sql --file=studio/tests/source-assist-assertions.sql --file=studio/tests/knowledge-curation-assertions.sql --file=studio/tests/knowledge-batch-retry-assertions.sql --file=studio/tests/ai-route-chain-assertions.sql --file=lib/ai/crm-route-budget.test.sql --file=studio/tests/staged-creation-assertions.sql --file=studio/tests/device-ai-route-assertions.sql --file=studio/tests/studio-agent-assertions.sql
STUDIO_TEST_CURATION=1 STUDIO_TEST_DATABASE_URL="postgresql://studio_test@localhost:55439/postgres?host=$routing_test_dir/socket" npx tsx --test lib/studio/db.db.test.ts
echo 'Studio AI routing disposable database tests passed.'
