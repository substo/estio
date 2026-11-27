import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { StudioJobError } from "../worker/handlers";
import { createCharacterSheetHandler } from "./character-sheet";
import type { FrameDrawer } from "./codex-image";

const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(30_000)]);
const job = (over: Record<string, unknown> = {}) => ({ id: "11111111-1111-4111-8111-111111111111", kind: "studio.character_sheet", payload: {
  sheet: "turnaround", profile: { aspects: [{ key: "hair", value: "short dark", locked: true }, { key: "clothing", value: "navy sweater", locked: false }] },
  photos: [{ name: "photo-1.jpg", url: "https://r2.example/p1" }, { name: "photo-2.png", url: "https://r2.example/p2" }], uploads: [{ name: "sheet-1.png", url: "https://r2.example/up?sig=1" }], ...over } });
const ctx = () => ({ signal: new AbortController().signal, workerId: "mac" });
function setup(over: { transcribe?: (file: string) => Promise<Array<{ start: number; end: number; text: string }> | null>; draw?: FrameDrawer; enabled?: boolean; ready?: boolean; put?: number; photoStatus?: number } = {}) {
  const puts: Array<{ url: string; type: string | null; size: number }> = [], gets: string[] = [], drawn: Parameters<FrameDrawer>[0][] = [];
  const fetcher = (async (input: URL | string, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === "PUT") { puts.push({ url, type: new Headers(init.headers).get("content-type"), size: (init.body as Uint8Array).length }); return new Response(null, { status: over.put ?? 200 }); }
    gets.push(url); return new Response(new Uint8Array([1, 2, 3, 4]), { status: over.photoStatus ?? 200 });
  }) as typeof fetch;
  const draw: FrameDrawer = over.draw ?? (async r => { drawn.push(r); await writeFile(r.out, png); return true; });
  const handler = createCharacterSheetHandler({ enabled: () => over.enabled ?? true, ready: () => over.ready ?? true, draw, fetcher, workRoot: tmpdir(), transcribe: over.transcribe });
  return { handler, puts, gets, drawn };
}

test("it downloads the photos, draws the sheet with the card in the prompt, uploads the picture through the private link and reports file names only", async () => {
  const { handler, puts, gets, drawn } = setup();
  const result = await handler(job() as never, ctx());
  assert.deepEqual(result, { sheet: "turnaround", files: ["sheet-1.png"] });
  assert.deepEqual(gets, ["https://r2.example/p1", "https://r2.example/p2"]);
  assert.equal(drawn[0].references.length, 2); assert.match(drawn[0].references[0], /photo-1\.jpg$/);
  assert.match(drawn[0].prompt, /five views in one row/); assert.match(drawn[0].prompt, /hair: short dark/); assert.match(drawn[0].prompt, /glasses|clothing: navy sweater/);
  assert.match(drawn[0].intro ?? "", /use them as the only source for the face/);
  assert.deepEqual(puts, [{ url: "https://r2.example/up?sig=1", type: "image/png", size: png.length }]);
  assert.ok(!JSON.stringify(result).includes("http"), "no links in the result");
});

test("every refusal is a clear failure: payload, gate, Codex not signed in, no photos, no picture, failed upload", async () => {
  const code = async (s: ReturnType<typeof setup>, j = job()) => (await s.handler(j as never, ctx()).catch(e => e)) as StudioJobError;
  assert.equal((await code(setup(), job({ sheet: "selfie" }))).code, "invalid_job_payload");
  assert.equal((await code(setup(), job({ uploads: [{ name: "../x.png", url: "https://r2.example/x" }] }))).code, "invalid_job_payload");
  assert.equal((await code(setup(), job({ photos: [] }))).code, "invalid_job_payload");
  const off = await code(setup({ enabled: false })); assert.equal(off.code, "local_policy"); assert.equal(off.retryable, true);
  const codex = await code(setup({ ready: false })); assert.equal(codex.code, "codex_not_ready"); assert.match(codex.message, /ChatGPT/);
  assert.equal((await code(setup({ photoStatus: 403 }))).code, "photos_unavailable");
  const none = await code(setup({ draw: async () => false })); assert.equal(none.code, "sheet_failed"); assert.equal(none.retryable, false);
  assert.equal((await code(setup({ put: 403 }))).code, "sheet_upload_failed");
});

test("links must be https and a failed photo only costs that photo", async () => {
  const s = setup();
  const mixed = job({ photos: [{ name: "photo-1.jpg", url: "http://r2.example/p1" }, { name: "photo-2.png", url: "https://r2.example/p2" }] });
  await s.handler(mixed as never, ctx());
  assert.deepEqual(s.gets, ["https://r2.example/p2"]); assert.equal(s.drawn[0].references.length, 1);
  const bad = setup(); const e = (await bad.handler(job({ uploads: [{ name: "sheet-1.png", url: "http://r2.example/up" }] }) as never, ctx()).catch(x => x)) as StudioJobError;
  assert.equal(e.code, "sheet_upload_failed");
});

test("a cancelled job stops the work", async () => {
  const controller = new AbortController(); controller.abort();
  const s = setup({ draw: async () => { throw new Error("aborted"); } });
  await assert.rejects(s.handler(job() as never, { signal: controller.signal, workerId: "mac" }));
});

test("a storyboard draws one picture per beat from the right references, uploads each, and a beat that fails costs only that picture", async () => {
  const beats = [{ n: 1, prompt: "A wide shot of the desk.", person: true }, { n: 2, prompt: "A close-up of the interface.", person: false }, { n: 3, prompt: "Walking to the door.", person: true }];
  const uploads = beats.map(b => ({ name: `frame-${b.n}.png`, url: `https://r2.example/up${b.n}` }));
  const payload = { sheet: "storyboard", profile: undefined, beats, uploads, characterSheets: [{ name: "character-turnaround.png", url: "https://r2.example/t" }] };
  const ok = setup();
  assert.deepEqual(await ok.handler(job(payload) as never, ctx()), { sheet: "storyboard", files: ["frame-1.png", "frame-2.png", "frame-3.png"] });
  assert.equal(ok.drawn.length, 3);
  assert.match(ok.drawn[0].prompt, /wide shot of the desk/);
  assert.match(ok.drawn[0].references[0], /character-turnaround\.png$/);   // the first picture: sheets first, then the photos
  assert.equal(ok.drawn[0].references.length, 3);
  assert.match(ok.drawn[0].intro ?? "", /reference sheets/);
  // Object/UI-only beats get no creator references. Later presenter beats reuse only compatible presenter shots.
  assert.deepEqual(ok.drawn[1].references, []); assert.match(ok.drawn[1].intro ?? "", /no person, presenter, face or hands/);
  assert.match(ok.drawn[2].references[0], /frame-1\.png$/); assert.equal(ok.drawn[2].references.length, 4);
  assert.doesNotMatch(ok.drawn[2].references.join(" "), /frame-2\.png/);
  assert.deepEqual(ok.puts.map(p => p.url), ["https://r2.example/up1", "https://r2.example/up2", "https://r2.example/up3"]);
  // beat 2 fails: the others still land
  let n = 0;
  const partial = setup({ draw: async r => { n++; if (n === 2) return false; await writeFile(r.out, png); return true; } });
  assert.deepEqual(await partial.handler(job(payload) as never, ctx()), { sheet: "storyboard", files: ["frame-1.png", "frame-3.png"] });
  // nothing drawn is a failure the creator can retry; a beat with no upload link is skipped; a bad sheet name is refused
  const none = await setup({ draw: async () => false }).handler(job(payload) as never, ctx()).catch(e => e) as StudioJobError;
  assert.equal(none.code, "storyboard_failed");
  assert.deepEqual(await setup().handler(job({ ...payload, uploads: [uploads[0]] }) as never, ctx()), { sheet: "storyboard", files: ["frame-1.png"] });
  assert.equal(((await setup().handler(job({ ...payload, characterSheets: [{ name: "../x.png", url: "https://r2.example/x" }] }) as never, ctx()).catch(e => e)) as StudioJobError).code, "invalid_job_payload");
});

test("an all-object storyboard needs no creator photos", async () => {
  const payload = { sheet: "storyboard", photos: [], beats: [{ n: 1, prompt: "Full-frame dark phone UI.", person: false }], uploads: [{ name: "frame-1.png", url: "https://r2.example/up1" }] };
  const s = setup();
  assert.deepEqual(await s.handler(job(payload) as never, ctx()), { sheet: "storyboard", files: ["frame-1.png"] });
  assert.deepEqual(s.gets, []); assert.deepEqual(s.drawn[0].references, []); assert.match(s.drawn[0].intro ?? "", /only the requested object or interface/);
});

test("a transcript job reads the video through its private link, transcribes it on this Mac without Codex or photos, and uploads only the timed lines", async () => {
  const seen: string[] = [];
  const s = setup({ ready: false, transcribe: async file => { seen.push(file); return [{ start: 1, end: 2.5, text: "hello there" }]; } });
  const payload = { sheet: "transcript", photos: undefined, media: { url: "https://r2.example/video?sig=1" }, uploads: [{ name: "transcript.json", url: "https://r2.example/t.json?sig=2" }] };
  assert.deepEqual(await s.handler(job(payload) as never, ctx()), { sheet: "transcript", files: ["transcript.json"] });
  assert.deepEqual(s.gets, ["https://r2.example/video?sig=1"]);
  assert.equal(s.puts.length, 1); assert.equal(s.puts[0].type, "application/json"); assert.equal(s.puts[0].url, "https://r2.example/t.json?sig=2");
  assert.equal(seen.length, 1); assert.deepEqual(s.drawn, []);
  const code = async (x: ReturnType<typeof setup>) => ((await x.handler(job(payload) as never, ctx()).catch(e => e)) as StudioJobError).code;
  assert.equal(await code(setup({ transcribe: async () => null })), "transcription_tools_missing");
  assert.equal(await code(setup({ transcribe: async () => [] })), "no_speech");
  assert.equal(await code(setup({ transcribe: async () => [{ start: 0, end: 1, text: "x" }], put: 500 })), "transcript_upload_failed");
  assert.equal(await code(setup({ transcribe: async () => [{ start: 0, end: 1, text: "x" }], photoStatus: 403 })), "media_unavailable");
});
