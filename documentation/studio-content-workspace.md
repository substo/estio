# Studio content workspace (design, 2026-11-23)

Owner feedback: the content page is a long scroll of unrelated forms and upload rows. It must behave like a video editor workspace: one focused mode at a time, the video and timeline visible, an agent always at hand, assets organised with provenance, and a script that is structured, not a text box. Studio is the front end to an AI harness for content and brand work (limited, purpose-built tools), with the native Substo Video app as the full editor.

## Modes (one at a time, remembered per piece)

- **Script** - structured blocks plus the agent focused on the selected block/section.
- **Edit** - player, timeline, assets, agent. Default once a video exists.
- **Details** - stage, pillar, audience, production notes, linked research (the old form, demoted).
Default mode: no script -> Script; script but no video -> Script; video exists -> Edit.

## Layout (desktop >= 1024px; mobile stacks with the agent as a bottom sheet)

- **Top bar:** title, stage, mode tabs, primary **Make video** (dialog: voice, music, vertical), **Open in editor**, Mac status chip. Mac status shows exactly what is missing ("Claude sign-in missing") with Recheck, never a generic error.
- **Left rail, Assets:** groups **Footage** (you uploaded), **Narration** (generated; voice + date), **Exports** (versions; latest first), each row shows provenance ("You uploaded 14:23", "Generated, Liam - ElevenLabs", "Made from script, 6 beats"). Unfinished/failed upload reservations are never listed inline: one collapsed **Needs attention** row with Retry/Discard. Upload (drag/drop or button) lands in Footage; remote-friendly.
- **Center:** player (stage) with version switcher + stepper while a job runs (Preparing narration, Mac editing, Uploading, Done; real status), and below it a **timeline visualization**: tracks Video/Camera, B-roll, Graphics, Text, Voice, Music, SFX, drawn from a timeline snapshot saved with each export. Click a clip -> selection actions: Trim, Replace, Delete, Retake audio, Ask the agent. Read-mostly in the browser; real editing is the Mac app. Quick actions are structured instructions to the existing `studio.video_edit` agent job.
- **Right, Agent:** docked chat with a context chip ("Focus: block 3" / "Clip: B-roll 0:12-0:18" / "Whole video"), suggested prompts, persisted thread; replies link to the new version.

## Script mode

Notion-style blocks: Heading, Narration, Visual note, Section break. Stored as structured JSON on the record (`scriptBlocks`), with the plain `script` kept derived so existing consumers work. Drag handles **and** Move up/Move down buttons and keyboard shortcuts (WCAG 2.2 dragging alternative). Each Narration block shows voice status (Fresh / Changed since audio) with a per-block **Regenerate audio** and a batch **Regenerate changed**; selecting text offers Regenerate selection. A piece-level **Voice** dropdown (Location default, per-piece override) sits in the top bar of this mode. **Brainstorm this section** opens the agent focused on that block (reuse the record-scoped Studio agent).

**Read script** opens a scrollable rehearsal view with the current narration, including edits still in the editor. It omits headings, visual notes, section breaks and bracketed cues. **Copy narration** copies the same text for pasting into a teleprompter.

**Is this ready to film?** prepares a chat review of the saved script. It asks the agent to check the spoken opening, title and payoff, runtime, and assets or proof still needed. Save the proposed checklist in the same conversation. If the piece changes before you apply the checklist, request a new review.

## Rules

- Use the repo UI principles and tokens; no new palette. Keyboard focus always visible, targets >= 44px, drag always has a button alternative, reduced motion respected.
- Mode switching never reloads the page or loses state; nothing important is below the fold of its mode.
- Every state has an owner: empty (what to do next), running (what is happening), failed (why + one action).
