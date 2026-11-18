# Studio script templates

Open **Content → Script templates** in either edition. Team members can browse drafts and propose templates or revisions for the active Location (Brand in Substo). Each version has a name, purpose and ordered writing beats. A Location Admin approves the latest draft. The proof-first example pre-fills a new form and becomes available for review only after someone saves it.

The editor suggests the only approved template for a blank, unassigned script. The user can choose another approved template when there are several, or select **No template**. Save the content piece to persist that choice. Saved scripts retain their selected version when a template changes. A template may have a pending draft while its last approved version stays available. Existing scripts and production notes are kept as entered.

## Learn from a saved video

Open **Extract script template** from an active saved YouTube source. A saved timestamped transcript is required. Studio uses the released evidence reader to attach available OCR for the matching transcript. A long video is sampled across its timeline to fit a single text request. The extraction shows how many speech and OCR passages were included. It uses saved text and timings from those passages. Frames and object paths stay private.

Choose the requesting Account's paired Mac subscription or explicitly authorize the Location OpenAI API route. Mac processing requires an updated companion advertising `videoTemplateVersion: 1`. The existing text reservation and settlement apply to the API route. Open the latest extraction from the source when returning to it.

Studio proposes ordered reusable writing beats, with source-specific rationale, timestamped exact quotes and limitations in the original extraction review. Edit the reusable name, purpose and guidance before saving an unapproved draft. A Location Admin reviews the draft and can follow the link back to the original citations. A source change before saving blocks that proposal and leaves its historical review available. Each saved draft keeps a reference to its original review. Citations and rationale stay in the review when template versions are used for scripts.

## Integration with script generation

`studio.studio_script_template_snapshot(location_id, record_id)` returns the exact pinned approved version as `{ templateId, versionId, version, name, purpose, beats }` or SQL null when there is no selection. Gap 5 can call it inside the authorized, version-fenced script-brief snapshot transaction and include the returned value as optional writing structure for both provider routes. Template beats are user-authored structure. Source citations, evidence, profile context and approval retain their own contracts. A template selection updates the content record version, so a brief based on an earlier selection can use the existing stale-input guard. Approval of a new template revision does not change the record version or the prior immutable template contents.

The content record's `script_template_selected` flag distinguishes an explicit **No template** from an unassigned piece. If script-brief admission applies the sole-template default to an unassigned piece, resolve the choice before capturing the immutable snapshot. Preserve an explicit opt-out and any pinned older revision.

Gap 4 exposes the saved selection and writing beats in the manual script editor. The existing script generator still uses its current inputs.
