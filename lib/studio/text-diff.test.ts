import assert from "node:assert/strict";
import test from "node:test";
import { diffLines } from "./text-diff";

test("diffLines marks only changed lines", () => {
  assert.deepEqual(diffLines("a\nb\nc", "a\nB\nc\nd"), [
    { kind: "same", text: "a" }, { kind: "remove", text: "b" }, { kind: "add", text: "B" }, { kind: "same", text: "c" }, { kind: "add", text: "d" }]);
  assert.deepEqual(diffLines("", "x"), [{ kind: "remove", text: "" }, { kind: "add", text: "x" }]);
});
