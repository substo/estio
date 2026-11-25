import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createCodexFrameDrawer } from "./codex-image";
import type { ProcessRequest } from "./process";

const png = (bytes = 20_000) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(bytes)]);

test("it runs the Codex CLI with the photo attached, '--' before the prompt, the subscription login only, and returns true for a real picture", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codex-frame-")); let seen: ProcessRequest | undefined;
  const draw = createCodexFrameDrawer({ run: async request => { seen = request; await writeFile(join(dir, "frame-1.png"), png()); return { stdout: "frame-1.png", stderr: "" }; } });
  assert.equal(await draw({ prompt: "Show them walking.", references: [join(dir, "avatar.png")], out: join(dir, "frame-1.png") }), true);
  const args = seen!.args;
  assert.deepEqual(args.slice(0, 5), ["exec", "--skip-git-repo-check", "--sandbox", "workspace-write", "--ephemeral"]);
  assert.equal(args[args.indexOf("-i") + 1], join(dir, "avatar.png"));
  assert.ok(args.indexOf("--") > args.indexOf("-i") && args.indexOf("--") === args.length - 2, "the prompt comes after --");
  assert.match(args.at(-1)!, /^Use \$imagegen to edit the attached reference photo into one new image\. Show them walking\. Save the final image as \.\/frame-1\.png/);
  assert.equal(seen!.subscriptionGeneration, "codex");
  assert.ok(!("OPENAI_API_KEY" in (seen!.env ?? {})) && !("CODEX_API_KEY" in (seen!.env ?? {})));
  assert.equal(seen!.cwd, dir);
});

test("a failed run, no file, a tiny file or a non-image file all return false and leave nothing behind", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codex-frame-"));
  const out = join(dir, "frame-2.png");
  assert.equal(await createCodexFrameDrawer({ run: async () => { throw new Error("cli_failed"); } })({ prompt: "x", references: [], out }), false);
  assert.equal(await createCodexFrameDrawer({ run: async () => ({ stdout: "", stderr: "" }) })({ prompt: "x", references: [], out }), false);
  assert.equal(await createCodexFrameDrawer({ run: async () => { await writeFile(out, png(10)); return { stdout: "", stderr: "" }; } })({ prompt: "x", references: [], out }), false);
  assert.equal(await createCodexFrameDrawer({ run: async () => { await writeFile(out, Buffer.alloc(30_000, 65)); return { stdout: "", stderr: "" }; } })({ prompt: "x", references: [], out }), false);
  await assert.rejects(readFile(out));   // the bad file was removed
});

test("a cancelled job stops the draw instead of returning false", async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(createCodexFrameDrawer({ run: async () => { throw new Error("aborted"); } })({ prompt: "x", references: [], out: join(tmpdir(), "never.png"), signal: controller.signal }));
});
