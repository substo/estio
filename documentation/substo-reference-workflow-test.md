# Substo reference-to-script slice

2026-11-18. Local implementation only; no commit or deployment. Shared Estio/Substo pages use the active Location. Inspiration: https://youtu.be/9DBJXRy5dvk. The parent owns obtaining/verifying that video's transcript and signed-in browser acceptance; no claim about the video's contents is made here.

## Implemented

- Source detail shows saved-transcript availability, routes to source editing, knowledge extraction and extraction review, and up to five actual source findings with their recorded status. Missing findings are explicit. Extraction proposals and knowledge approval remain separate existing actions.
- “Create an idea from this source” discloses a title/concept form. Existing `studio_save_record` and audited `studio_change_record_link` run in one Prisma transaction. The idea is unapproved, at Idea stage, with an outgoing research link. It does not copy the source's claims or approval. Source validation is scoped to the authorized Location and excludes channels/archived sources; impersonation cannot create/link.
- Content detail gives the next step based on saved script, stage, outgoing link count and evidence availability. Links lead to optional references, Library and script briefs. Evidence availability matches the script snapshot's transcript → notes → stored summary precedence, including its first-600-character excerpt and three-outgoing-link bound. A description, URL or `aiSummary` alone does not count.
- The single-idea script form carries its idea automatically. Explicit paid-use authorization, immutable request retries, reviewed-version application and the existing approval behavior remain intact.
- Filming guidance uses the existing script, Production notes and Record stage; template decisions are described as manual.

## Confirmed gaps

- **Update 2026-11-18 (local, not deployed):** a pasted/saved YouTube source can now be transcribed by the paired Mac into the saved transcript (see [AI workflows](ai-workflows.md#video-transcription-from-a-url)). The sentence below describes the earlier slice. This slice does not fetch YouTube transcripts or discover related videos. Save verified transcript text or use existing authorized upload/transcription flows. Uploaded transcripts/source units can feed knowledge extraction but are not automatically copied into the record text consumed by script briefs.
- No approved-template selector/enforcement was found in the current Studio page/service flow. Writing a template name/review decision in notes is manual guidance, not enforced template approval.
- Knowledge findings do not automatically become content concepts or feed the script snapshot. Review the findings, write the concept, and retain source text/links. Source/knowledge/content approvals remain distinct.
- Script generation uses bounded saved excerpts and requires the existing key/budget/paid confirmation. No provider call was made for these checks.
- Filming handoff is a saved script and production notes, not a new export, shoot package or editor integration. No automatic approval, publication or filming readiness is asserted.

## Verification

- 17 focused tests passed: `npx tsx --test lib/studio/source-idea-service.test.ts lib/studio/reference-workflow.test.ts lib/studio/content-policy.test.ts lib/studio/worker/script-brief.test.ts`.
- Six database-layer tests passed against a disposable PostgreSQL 17 cluster using the repository CRM fixture and canonical Studio schema, including real save/link commit and rollback on a simulated link failure. PostgreSQL 14 could not load the existing schema's `MAINTAIN` privilege; PostgreSQL 17 was used successfully. The full schema/concurrency suite was not run.
- `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit` completed with existing project failures (624 diagnostic output lines); none name the changed source/test files. This is not a whole-project type-clean result.
- `npm run build` passed (exit 0), including the source/content routes and all 133 static pages. It retained dependency warnings and skipped type validation as configured; this does not override the compiler failures above.
- `git diff --check` passed. Private local logs: `/tmp/substo-reference-{tests,db,types,build}.log`.
- Browser, phone layout, native disclosure keyboard behavior and actual Substo Location workflow remain for the parent. Static tests do not establish that acceptance. Suggested cases: source with/without text/findings; create an original concept and verify outgoing source link; add URL-only versus text-backed references; exceed three links; confirm the script form has no redundant idea checkbox but still requires paid authorization; saved script/manual filming notes; archived records.

## Live continuation — 2026-11-18

Signed-in Substo Location test completed through the serving release's manual draft handoff. Canonical profile saves/read-back replaced an unrelated Dublin-agency offer suggestion with Substo's actual CRM/Studio direction, voice/guardrails and four working content pillars. Audience remains explicitly inferred; unknown owner facts remain unfilled. Mobile Profile tab at 390×844 has document width 390 and shows the saved summary. This is not acceptance of the undeployed local UI.

Saved primary reference `291af992-3d9a-4178-b730-8b33fb04c596` and related official YouTube reference `327b7d30-af49-4605-9fda-c8505a6011cb`, each with externally retrieved captions and clearly attributed research notes. Content `f93ee1ea-a95e-41fa-8305-da6e36edcf6e` links both and holds an original 3,423-character script plus filming notes, Script stage/Pillar 1, approval unchecked. Template is a proposal in Production notes; no standalone approved template or filming is claimed. These records are in Substo, not Estio.

Native extraction `de27d543-16c2-470d-99b4-bca541977abd` selected the first 8/12 transcript units, then failed: `Add an OpenAI key in AI settings before retrying.` No native findings or approved knowledge were produced. This test distinguishes an actual failed in-app generation from the current assistant's outside-app analysis/draft. After enabling Text work and selecting Codex on the already-processing active Mac, desired setup v2 was applied and the related source's subscription-generated transcript summary displayed successfully. No API key was added; no paid fallback was configured. The older summary handler may select another ready subscription by capacity, so the selected UI value alone does not prove which CLI executed.

Provider discrepancy fixes, truthful shared capabilities/readiness and app-readable AI documentation are now a local candidate for both editions, detailed below. Automatic caption acquisition, arbitrary 600-character script excerpts, approved-template application and connected knowledge graph remain distinct gaps; this live test does not imply they are implemented. Full evidence and profile before/after views are in `/Users/martingreen/Downloads/Substo-reference-workflow/live-workflow-results.md` and adjacent files.

## Integrated AI routing verification — 2026-11-18

The shared local candidate now also offers explicit paired-Mac subscription versus paid Location OpenAI routing for knowledge extraction, idea reviews and script briefs, with operation readiness and durable authority/configuration/replay/result guards. The bundled model-readable capability guide is imported at actual provider prompt boundaries. CRM interactive model context reaches classifier, sentiment, skill planning, tool-result synthesis and critic; saved contact knowledge avoids a separate interactive embedding API call. Background claimants cannot resume personal interactive jobs, and the two manual draft actions cannot replay failed/empty skill work through the legacy generator.

The combined no-provider suite passed **81 tests**. The PostgreSQL 17 disposable routing script passed its actual SQL assertions and **6 database tests**, including source/idea rollback. `git diff --check` passed. This does not establish real provider acceptance, browser/mobile/keyboard acceptance of the new selector, production migration application or an updated running companion. The serving-release profile and draft evidence above remain separate from the local candidate. See [AI workflows](ai-workflows.md) for supported and unsupported routes and release prerequisites.

The integrated production build passed (exit 0), including 133 static pages. Compiled server chunks contain the new interactive-background and manual-action replay fences. The build retained dependency warnings and skipped type validation as configured; the separate typecheck is reported independently.

Final standalone typecheck completed with 371 diagnostics across the repository. Five name edited files: two pre-existing `responseSchema` incompatibilities in `lib/ai/llm.ts` and three pre-existing nullable-contact accesses in `lib/ai/runtime/engine.ts`; their source is unchanged from `HEAD`. No diagnostics remain in new files. One test-fixture sentiment type was corrected and all seven loader tests passed again. This is not a whole-project type-clean result.
