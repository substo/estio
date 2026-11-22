/**
 * Script + shot footage -> edited video, on this Mac. Voiceover (ElevenLabs v3), then an agent drives the `substo` editor:
 * cuts, captions, motion graphics, sound design, export.
 *   npm run studio:video-assemble -- --script script.txt --clips ~/Movies/shoot --project ~/Movies/Substo/Projects/my-video [--voiceover] [--music] [--portrait] [--voice <id>] [--dry-run]
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { assembleVideo } from "../lib/studio/video-assembly/assemble";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const value = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const need = (name: string) => { const v = value(name); if (!v) { console.error(`Missing --${name}`); process.exit(2); } return resolve(v.replace(/^~(?=\/)/, process.env.HOME ?? "~")); };

async function main() {
const result = await assembleVideo({
  script: await readFile(need("script"), "utf8"), clipsDir: need("clips"), projectDir: need("project"),
  editorDocs: resolve(__dirname, "../video-editor/docs"), orientation: flag("portrait") ? "portrait" : "landscape",
  voiceover: flag("voiceover"), music: flag("music"), voiceId: value("voice"), model: value("model"), dryRun: flag("dry-run"), log: line => console.error(line),
});
console.log(flag("dry-run") ? result.brief : result.agentOutput);
}
main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
