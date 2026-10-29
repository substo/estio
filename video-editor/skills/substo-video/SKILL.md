---
name: substo-video
description: Edit local .substo video projects with the substo command and the Studio macOS editor.
---

# Studio video editor

Use this skill for timeline editing, media review, captions, sound, exports, and checks in a `.substo` project. The installed app and `substo` CLI share one project and one edit history.

1. Read `docs/AGENTS.md` in this editor checkout for project and edit rules.
2. From the video folder, run `substo status` and `substo timeline --summary` before editing. Use `substo help <command>` for exact options.
3. Make labelled batches through `substo apply`, inspect the result with `substo frame`, `substo clip`, or the app, and run `substo check --changed`.
4. Preserve the project’s assets, licences, and source records. Keep exports beside the project in `exports/`.

Substo’s content workspace stores linked edits under `data/video-projects/<record-id>/`. Use the existing linked project when a content record already has one.
