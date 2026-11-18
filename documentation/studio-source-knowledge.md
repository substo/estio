# Studio source knowledge

Local Gap 2 implementation on top of the deployed `f074b587` baseline. Both apps use the same routes and Location-owned Knowledge.

## Review a saved source

Open **Extract knowledge** from a Library source with saved evidence. Choose the transcript or evidence set and authorize the paired Mac subscription or Location OpenAI route. Studio processes that entire input in bounded batches and shows all takeaways in one review. New runs use the full-input workflow. Prior range reviews and their decisions remain available.

The review shows completed evidence passages and batches. The overview surfaces takeaways from the first few topics. Expand a topic to follow its subtopics and cited takeaways. A citation opens the exact passage in the paged evidence viewer. Notes can be saved at the overview, topic, takeaway or passage. The overview and topic display titles and summaries can be edited inline. These shared Location annotations are versioned and tracked by actor. Original evidence and provider proposals are retained.

**Approve selected** saves chosen takeaways via the existing Knowledge application and review commands in one transaction. The broadest suggested topic is resolved through the existing Location topic rules if a finding needs a topic. An existing approved or rejected decision is preserved. Exact statement/kind matches within the review share one takeaway and display alternate citations. The existing Knowledge insight retains its original evidence when reused. New approved insights carry the primary validated citation and a link back to the review.

A batch with zero proposed findings still counts toward completed coverage. Failed or missing batches stay visibly incomplete and block approval. Resolve failures through Jobs and the existing billing reconciliation path. For a new run after a terminal subscription outcome, use **Extraction options** and authorize processing again. A changed transcript, OCR evidence, source URL or archive status blocks new approval of the old review. A metadata-only edit such as a Library summary update leaves the reviewed evidence current.

## Runtime boundaries

- Choose one saved evidence set. Supported inputs are a record’s transcript, notes or script, a completed upload transcript belonging to that record, or one imported transcription’s source units. Studio preserves valid saved segment and frame times. If timed segments fail to cover the saved transcript, it uses the full saved text with character offsets.
- The input bound is 400,000 UTF-8 bytes of transcript text, up to 2,048 normalized passages and 48 batches. Each batch is fenced by the existing 24 KB snapshot limit. Oversized evidence is rejected before any batch is queued. The UI never presents a clipped prefix as a full extraction. Topic branches can have up to 12 levels and a selection can approve up to 50 takeaways at a time.
- This release combines batch output deterministically. Topic labels are matched case-insensitively after whitespace normalization. It merges exact takeaways and preserves citations in the review. Semantically similar statements and differently named topics can remain visible. There is no cross-batch synthesis model call.
- The existing paired-Mac route uses the requesting account’s own ready device. Full-source batches require advertised `knowledgeOutlineVersion: 2` from the updated Node companion (`studio-companion-5`) and prompt `studio.knowledge-extract.v2`. The hosted worker needs the matching prompt support. Older isolated runs still use v1. Existing device config, membership, cancellation and replay fences apply.
- Location OpenAI requires explicit paid consent and a saved key. The existing worker reserves $0.01 per batch, settles actual metered usage, and retains uncertain holds. Subscription extraction creates no platform API hold. Studio uses the chosen provider throughout the review.

## Gap 1 integration seam

Both worktrees can be integrated independently. The current entry point is the existing authenticated extraction command with `action: "enqueueOutline"`. Its SQL entry point is `studio.studio_enqueue_knowledge_outline`. A transcript-ready producer should reuse that admission path with a stable request identity, the source ID and version, and the actor’s explicit authorization for automatic subscription use. Offline waiting, automatic enqueue and the one-time permission are integration work. The presence of a saved Location API key is insufficient to authorize automatic API use.

For a record-backed transcript, set `payload.transcript` to the saved text. This branch’s fixture adapter accepts an optional `payload.transcriptEvidence` envelope with:

- `textSha256`, the hex SHA-256 of the exact UTF-8 transcript text.
- `segments`, an ordered array of `{ id?, start, end, text }` items with seconds. The normalized joined segment text must cover the saved transcript before segment timestamps are used.
- `frames`, an optional array of `{ id?, time, end?, ocr, audioContext? }` items with seconds. The adapter consumes OCR text and up to 1,000 characters of nearby speech as context. Only the OCR text itself can be quoted from an OCR passage. Frame bytes, private paths and keys stay out of provider prompts.

Translate the final Gap 1 representation at the ingestion boundary if it differs from this fixture envelope. Related-video ranking and the decision to send a Discovery candidate for transcription or OCR stay in Gap 1. Existing notes on a review stay attached to its immutable evidence. Coordinate handling for revised OCR evidence arriving after a speech-only run before adding automatic reruns.

Likely merge overlaps are `scripts/studio-companion.ts`, `lib/studio/devices-policy.ts`, and the Library source detail. Keep both sets of companion capabilities/handlers and both additive migrations. Then verify the signed-in Substo Location by adding a chosen source, letting the Mac prepare the transcript, seeing one automatically queued review, opening citations and approving selections. This worktree uses mocked providers and disposable fixtures.

## Local verification

Run `bash scripts/test-studio-ai-routing.sh` with PostgreSQL 17 on `PATH` for the disposable database suite. It covers a 60-minute transcript, OCR evidence, saved text, imported source units, completed uploads, Location isolation, explicit approval and funding, batch settlement, stale evidence, note version conflicts and replay. The real saved Think Media text was also queued in a disposable database, covering all 12 untimed passages and all 617 passages in the separate timed fixture. No production transcript is bundled in the repository.

Chromium checked the actual review components with a fixture endpoint at 1440×900 and 390×844. Checks included keyboard disclosure, note save/read-back, passage links, approval/read-back, empty and incomplete states, and horizontal overflow. A real signed-in browser session and provider output quality remain integration acceptance.
