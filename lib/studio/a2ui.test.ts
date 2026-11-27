import assert from "node:assert/strict";
import test from "node:test";
import { a2uiActionMessage, parseA2ui } from "./a2ui";

const block = (value: unknown) => `Pick one.\n\`\`\`a2ui\n${JSON.stringify(value)}\n\`\`\``;
test("plain text passes through", () => assert.deepEqual(parseA2ui("Hello"), { text: "Hello", components: [] }));
test("valid components parse and the block is removed", () => {
  const p = parseA2ui(block({ components: [{ type: "choices", options: ["A", "B"] }, { type: "confirm", title: "Use it?" }] }));
  assert.equal(p.text, "Pick one."); assert.equal(p.components.length, 2);
  assert.deepEqual(p.components[1], { type: "confirm", title: "Use it?", approve: "Approve", decline: "Not now" });
});
test("unknown or malformed components are dropped, bad JSON falls back to text", () => {
  assert.equal(parseA2ui(block({ components: [{ type: "iframe", src: "x" }, { type: "choices", options: [] }, { type: "choices", options: [1] }] })).components.length, 0);
  assert.deepEqual(parseA2ui("Hi\n```a2ui\n{nope\n```"), { text: "Hi", components: [] });
});
test("limits: at most four components, no html-length abuse", () => {
  const many = Array.from({ length: 6 }, () => ({ type: "choices", options: ["x"] }));
  assert.equal(parseA2ui(block({ components: many })).components.length, 4);
  assert.equal(parseA2ui(block({ components: [{ type: "choices", options: ["x".repeat(81)] }] })).components.length, 0);
});
test("form needs named fields; action message is plain text", () => {
  assert.equal(parseA2ui(block({ components: [{ type: "form", fields: [{ name: "n" }] }] })).components.length, 0);
  assert.equal(a2uiActionMessage("form", { tone: "warm" }), "[A2UI form] tone: warm");
});
