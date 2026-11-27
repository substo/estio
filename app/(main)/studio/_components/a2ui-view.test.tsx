import React from "react";import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
Object.assign(globalThis, { React });
import { A2uiView } from "./a2ui-view";
import { parseA2ui } from "@/lib/studio/a2ui";

test("catalog renders natively and escapes model text", () => {
  const { components } = parseA2ui('x\n```a2ui\n{"components":[{"type":"choices","prompt":"<img src=x>","options":["Warm","Direct"]},{"type":"confirm","title":"Go?"}]}\n```');
  const html = renderToStaticMarkup(<A2uiView components={components} disabled={false} onSend={() => {}} />);
  assert.match(html, /Warm/); assert.match(html, /Direct/); assert.match(html, /Approve/); assert.doesNotMatch(html, /<img/);
});
