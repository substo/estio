import type { Beat } from "./script";

export interface BriefInput {
  editorDocs: string; orientation: "landscape" | "portrait";
  beats: Beat[]; voiceFiles: string[]; timings: number[]; clips: string[]; hasVoiceover: boolean; music: boolean;
}

/** The instruction handed to the editing agent. Everything it may do goes through the `substo` command, so edits land in the editor's undo history. */
export function buildBrief(i: BriefInput): string {
  const beats = i.beats.map((b, n) => `${b.index}. "${b.narration}"${b.direction ? `  [visual: ${b.direction}]` : ""}${i.voiceFiles[n] ? `  (voiceover: ${i.voiceFiles[n]}${i.timings[n] !== undefined ? `, place at ${i.timings[n]}s` : ""})` : ""}`).join("\n");
  return `You are editing a finished video from a script. The current directory is a Substo Video project folder (already created with \`substo new\`). Use ONLY the \`substo\` command; read ${i.editorDocs}/AGENTS.md, then agents/cutting.md, agents/broll-and-titles.md, agents/sound.md and agents/shorts.md as needed. Pass --author claude on every editing command.

Canvas: ${i.orientation}. Footage the creator shot (already in this folder): ${i.clips.join(", ") || "none"}.
${i.hasVoiceover ? "Generated voiceover files (one per beat, in this folder) are the narration: place them back to back on the Voice track in order." : "The footage carries the narration: transcribe it (`substo wait transcript`) and cut to the script."}

Script beats:
${beats}

Do this, in order:
1. \`substo media\` and \`substo timeline --summary\` to learn what exists.
2. Build the picture: for each beat put the best-matching footage on the camera/screen/B-roll track for that beat's length. Use \`substo search\` on transcripts to match footage to lines. Trim dead air; do not invent footage. Where a beat has a [visual] note and no footage fits, use a title or graphic instead.
3. Captions: try \`substo captions --apply\` (word-by-word) once the voice track is in place. Transcripts need macOS 26; if it reports transcripts are unavailable, instead add one text clip (preset caption) per short phrase of each beat on the Text track, timed inside that beat's voiceover span (a beat lasts from its start to the next beat's start).
4. Motion graphics, kept modest: a section title card at each major topic change and a short lower-third or callout for key numbers or names, using the title presets (callout, sectionHeader, label) with animationIn/animationOut (fade, pop, slideUp, typewriter). Keep text to a few words (longest line checked at the frame where it is fully visible), at least 48 px tall, inside safe margins (about 5% each side; portrait: 150 px top, 170 px bottom for platform UI), not overlapping the captions. For portrait, re-place elements for the tall frame instead of shrinking a landscape layout. Check with \`substo frame <time> -o /tmp/f.png\` and look at the image, and look at a contact sheet of frames across the video (clipped type, weak hierarchy, overlaps) before exporting.
5. Sound design: a soft whoosh on title entrances and cuts that change scene (\`substo assets\` to find or generate SFX); no more than one effect every few seconds, about -15 dB.${i.music ? " Add one instrumental music bed under the whole video, about -31 dB with a 2 s fade out." : " Do not add music."}
6. \`substo loudness\` then normalise speech, then \`substo check --changed\` and fix what it reports.
7. \`substo export --preset ${i.orientation === "portrait" ? "short" : "youtube1080"}\` and print the exported path as the last line.

Rules: run exactly one plain \`substo ...\` command per Bash call (a JSON batch goes in as the argument or via a here-string); no pipes, cd, variables, ; or &&, which are refused. Never delete or overwrite the creator's source files; never use footage not in this folder; if something cannot be done, say so in your final message instead of faking it. Finish with a short summary of what you placed and anything needing the creator's attention.`;
}
