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

## Paired Mac transcription evidence

Open the saved Library source and start a full source review. Studio matches the saved transcript to the completed Mac job before attaching speech timestamps and verified slide OCR source units. Nearby speech is context only. Private frame objects and paths stay out of model prompts. Edited transcript text is reviewed as saved text without the superseded Mac evidence. Starting a review requires an explicit route choice and approving findings is a separate action.

## Local verification

Run `bash scripts/test-studio-ai-routing.sh` with PostgreSQL 17 on `PATH` for the disposable database suite. It covers a 60-minute transcript, OCR evidence, saved text, imported source units, completed uploads, Location isolation, explicit approval and funding, batch settlement, stale evidence, note version conflicts and replay. The real saved Think Media text was also queued in a disposable database, covering all 12 untimed passages and all 617 passages in the separate timed fixture. No production transcript is bundled in the repository.

Chromium checked the actual review components with a fixture endpoint at 1440×900 and 390×844. Checks included keyboard disclosure, note save/read-back, passage links, approval/read-back, empty and incomplete states, and horizontal overflow. A real signed-in browser session and provider output quality remain integration acceptance.


## Curated review and idea handoff

New, explicitly requested full-source runs use the v3 extraction prompt. Each batch still sees every assigned passage and runs on the same authorized route and metering. The model decides which findings deserve attention and labels them by practical use. The per-batch validator remains a technical ceiling. There is no editorial quota, synthesis call, or automatic rerun. Historical v2 reviews retain their original results and get the same triage, comments, and idea handoff. They have no generated suggestions until a new extraction is requested.

Exact matches share a card. For advice, matching model-supplied equivalence keys within the same use can also share a card. Numerical statements, examples and claims use exact matching. The card retains alternative statements, exact citations and original finding references. Related labels or paraphrases without a shared key can still remain separate. Speaker claims are marked unverified. Coverage shows the speech and on-screen-text evidence present in the saved review. The Library also surfaces the latest frame failure when recorded.

**Keep** and **Skip** are private to the signed-in account in the active Location. Undo restores the previous state, and the Skipped view can restore a takeaway after a reload. A contextual comment edits the same versioned annotation as the earlier note interface. Existing comments, heading edits, and history remain available. **Approve selected** keeps the existing permission and audit path.

**Draft linked idea** hands the kept references to the single-source assistant. Generation requires the existing explicit route and consent. It receives server-resolved quote evidence and an optional reaction. The editable proposal opens in Script, and only **Create linked idea** saves it and links it to the source. The idea record retains structured source-review IDs, original finding references and exact quote evidence. This can be done before approving any Knowledge. The saved idea links back to the cited review. This handoff does not change how the separate script generator builds its context.

Integration requires migration `20261119170000_studio_knowledge_review_curation` and the matching hosted worker and Node companion (`studio-companion-9`, `knowledgeCurationVersion: 1`). Old queued jobs use their pinned prompt. Fresh and selected-idea prompts are gated against older companions. The independent Discovery and script-context workstreams are outside this change.
