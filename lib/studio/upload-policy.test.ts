import assert from "node:assert/strict";
import test from "node:test";
import { readStudioUploadRequest } from "./upload-policy";

const recordId = "A2000000-0000-4000-8000-000000000001";
test("upload requests accept own video/audio and reject everything else", () => {
  assert.deepEqual(readStudioUploadRequest({ recordId, filename: "C:\\clips\\Talk 1.MOV", contentType: "", byteSize: 10 }),
    { recordId: recordId.toLowerCase(), filename: "Talk 1.MOV", contentType: "video/quicktime", byteSize: 10 });
  assert.equal(readStudioUploadRequest({ recordId, filename: "a.bin", contentType: "audio/mpeg", byteSize: 1 }).contentType, "audio/mpeg");
  assert.equal(readStudioUploadRequest({ recordId, filename: "voice.m4a", contentType: "audio/x-m4a", byteSize: 1 }).contentType, "audio/x-m4a");
  for (const bad of [{ filename: "page.html", contentType: "text/html" }, { filename: "x.svg", contentType: "image/svg+xml" }, { filename: "", contentType: "video/mp4" }])
    assert.throws(() => readStudioUploadRequest({ recordId, byteSize: 1, ...bad }));
  assert.throws(() => readStudioUploadRequest({ recordId, filename: "a.mp4", contentType: "video/mp4", byteSize: 0 }), /empty/);
  assert.throws(() => readStudioUploadRequest({ recordId, filename: "a.mp4", contentType: "video/mp4", byteSize: 5 * 1024 ** 3 + 1 }), /5 GB/);
  assert.throws(() => readStudioUploadRequest({ recordId: "x", filename: "a.mp4", contentType: "video/mp4", byteSize: 1 }), /record/);
  assert.equal(readStudioUploadRequest({ recordId, filename: "bad\u0007name.mp4", contentType: "video/mp4", byteSize: 1 }).filename, "badname.mp4");
});
