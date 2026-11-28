import test from "node:test";
import assert from "node:assert/strict";
import { createVideoDeviceApi } from "./video-api";

test("a frame upload sends every header the signed URL covers (If-None-Match: * was missing, so storage refused each frame)", async () => {
  let seen: RequestInit | undefined;
  const api = createVideoDeviceApi({ origin: "https://example.test", token: "t" } as never, { fetcher: (async (_url: unknown, init?: RequestInit) => { seen = init; return new Response(null, { status: 200 }); }) as typeof fetch });
  await api.upload("https://r2.example/frame", new Uint8Array([1, 2, 3]), new AbortController().signal);
  const headers = seen?.headers as Record<string, string>;
  assert.equal(headers["if-none-match"], "*"); assert.equal(headers["content-type"], "image/jpeg");
});

import { nativeLoginEnvironment } from "./process";
test("the progress file path reaches the transcription scripts (it was dropped by the environment allow-list)", () => {
  assert.equal(nativeLoginEnvironment({ STUDIO_PROGRESS_FILE: "/tmp/p.json", OPENAI_API_KEY: "secret" }).STUDIO_PROGRESS_FILE, "/tmp/p.json");
  assert.equal(nativeLoginEnvironment({ OPENAI_API_KEY: "secret" }).OPENAI_API_KEY, undefined);
});
