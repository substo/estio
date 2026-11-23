---
name: script-to-video
description: Turn a Studio script plus the creator's shot footage into an edited, captioned, sound-designed video with the substo editor.
---

# Script to video

Run on the paired Mac: `npm run studio:video-assemble -- --script script.txt --clips <footage folder> --project <project folder> [--voiceover [--voice-local ryan]] [--music] [--portrait] [--dry-run]`.

What it does: copies footage into the project folder, creates the `.substo` project, narrates each script paragraph (from Studio, a hosted voice is rendered on the server with the Location's own Fish Audio or ElevenLabs key and handed to the Mac as files; the CLI here uses the on-device voice; audio tags like `[excited]` or `[whispers]` in the script steer hosted delivery), measures each voiced beat, then runs `claude -p` limited to `Bash(substo:*)` and `Read` with the brief in `lib/studio/video-assembly/brief.ts`.

Script format: blank-line separated paragraphs are spoken beats; a `[bracketed]` or `(parenthesised)` line is a visual direction for the next beat.

Motion graphics rule (from how people use Claude with Remotion and similar tools): keep it to the editor's native title presets (callout, sectionHeader, label) with fade, pop, slideUp or typewriter, a few words each, checked with `substo frame`, because model-written layouts often overflow. Generated React/Remotion graphics are a later option, not needed for the first cut.

Known limits: `substo captions` needs macOS 26 transcripts; on older Macs the agent places caption text clips using the measured voice timings. Footage with its own narration needs macOS 26 (or a supplied transcript). Each Bash call must be one plain `substo` command.
