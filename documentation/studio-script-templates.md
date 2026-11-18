# Studio script templates

Open **Content → Script templates** in either edition. Team members can browse drafts and propose templates or revisions for the active Location (Brand in Substo). Each version has a name, purpose and ordered writing beats. A Location Admin approves the latest draft. The proof-first example pre-fills a new form and becomes available for review only after someone saves it.

The editor suggests the only approved template for a blank, unassigned script. The user can choose another approved template when there are several, or select **No template**. Save the content piece to persist that choice. Saved scripts retain their selected version when a template changes. A template may have a pending draft while its last approved version stays available. Existing scripts and production notes are kept as entered.

## Integration with script generation

`studio.studio_script_template_snapshot(location_id, record_id)` returns the exact pinned approved version as `{ templateId, versionId, version, name, purpose, beats }` or SQL null when there is no selection. Gap 5 can call it inside the authorized, version-fenced script-brief snapshot transaction and include the returned value as optional writing structure for both provider routes. Template beats are user-authored structure. Source citations, evidence, profile context and approval retain their own contracts. A template selection updates the content record version, so a brief based on an earlier selection can use the existing stale-input guard. Approval of a new template revision does not change the record version or the prior immutable template contents.

The content record's `script_template_selected` flag distinguishes an explicit **No template** from an unassigned piece. If script-brief admission applies the sole-template default to an unassigned piece, resolve the choice before capturing the immutable snapshot. Preserve an explicit opt-out and any pinned older revision.

Gap 4 exposes the saved selection and writing beats in the manual script editor. The existing script generator still uses its current inputs.
