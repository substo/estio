import assert from "node:assert/strict";
import { test } from "node:test";
import { currentShotFiles, nextTake, parseShotFileName, shotFileName, shotFilesByBeat, supersededShotFiles } from "./shots";

test("shot file names round-trip and reject look-alikes", () => {
  assert.equal(shotFileName(3, 2, ".MP4"), "Shot 03 take 2.mp4");
  assert.deepEqual(parseShotFileName("Shot 03 take 2.mp4"), { shot: 3, take: 2 });
  for (const bad of ["Shot 03.mp4", "My Shot 03 take 1.mp4", "Shot 00 take 1.mp4", "Shot 41 take 1.mp4", "Shot 03 take 0.mp4"]) assert.equal(parseShotFileName(bad), null);
});
test("the newest take of a shot is current; older takes are superseded", () => {
  const names = ["Shot 01 take 1.webm", "Shot 01 take 2.mp4", "Shot 02 take 1.mov", "intro.mp4"];
  assert.equal(currentShotFiles(names.map(name => ({ name }))).get(1)?.name, "Shot 01 take 2.mp4");
  assert.deepEqual([...supersededShotFiles(names)], ["Shot 01 take 1.webm"]);
  assert.deepEqual(shotFilesByBeat(names).map((f, i) => [i, f]).filter(x => x[1]), [[1, "Shot 01 take 2.mp4"], [2, "Shot 02 take 1.mov"]]);
  assert.equal(nextTake(names.map(name => ({ name })), 1), 3);
  assert.equal(nextTake([], 5), 1);
});
