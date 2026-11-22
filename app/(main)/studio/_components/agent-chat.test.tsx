import React from "react";
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
Object.assign(globalThis, { React });
import { StudioTenantProvider } from "./studio-tenant-context";
import { AgentDraftProvider, DraftPanel } from "./agent-workspace";
import { AgentChat } from "./agent-chat";
import type { AgentTurnView } from "@/lib/studio/agent";
import type { CreationRecord } from "@/lib/studio/creation-policy";

const record: CreationRecord = { id: "r1", version: 3, templateId: null, state: { schema: 1, brief: "", source: null, history: [],
  direction: { choice: "conversation", publisher: "", viewer: "", goal: "", angle: "", rationale: "" },
  stages: { Hook: { text: "Old hook text", approved: true, shortlist: [], previous: { text: "", approved: false } } } } };
const base: Omit<AgentTurnView, "id" | "status" | "result"> = { provider: "location_order", target: null, seq: 1, message: "Make the opener sharper", error: null, activity: [], waiting: null, route: null, inputs: { reads: [], context: ["Your message"] } };
const done: AgentTurnView = { ...base, id: "t1", status: "done", route: "Your Mac subscription · codex", activity: ["Searched the saved source for “opening” · 2 passages"],
  inputs: { reads: [{ tool: "Searched the saved source for “opening” · 2 passages", items: ["MrBeast · characters 0–420"] }], context: ["Your message"] },
  result: { reply: "Is this promoting Substo or a customer's video?", choices: ["Promote Substo to new creators", "A customer's video"], decisions: [{ key: "style", value: "punchy", basis: "sharper" }], plan: ["Pick the publisher"],
    proposals: [{ stage: "Hook", text: "Two openings, one promise.", rationale: "Uses the opener finding.", verify: ["Studio shows both openings"], evidenceIds: ["f:1"],
      evidence: [{ id: "f:1", label: "L", quote: "The opening sets the promise.", sourceId: "s1", at: 42 }] }] } };
const render = (turns: AgentTurnView[], plan: string[] = [], extra: Partial<React.ComponentProps<typeof AgentChat>> = {}, initialRecord: CreationRecord | null = record) => renderToStaticMarkup(
  <StudioTenantProvider locationId="loc"><AgentDraftProvider recordId="r1" sessionKey="t" initialRecord={initialRecord} initialPlan={plan}>
    <AgentChat locationId="loc" source={{ id: "s1", version: 1, title: "MrBeast on openings", hasText: true }} initialTurns={turns} provider="location_order" onProvider={() => {}} scope="test" {...extra} />
    <DraftPanel />
  </AgentDraftProvider></StudioTenantProvider>);

test("opening is a conversation with one composer and no form fields", () => {
  const html = render([]);
  assert.match(html, /MrBeast on openings/);
  assert.match(html, /Start for me/);
  assert.equal((html.match(/<textarea/g) ?? []).length, 1);
  assert.ok(!/<form|<input|role="tab"/.test(html));
});

test("a reloaded turn shows the real reads, cited proposal, claims to verify, quick replies, plan and the draft", () => {
  const html = render([done], ["Pick the publisher"]);
  assert.match(html, /Searched the saved source/);
  assert.match(html, /Proposed Hook/);
  assert.match(html, /“The opening sets the promise\.”/);
  assert.match(html, /Check before filming: Studio shows both openings/);
  assert.match(html, /Use as Hook/);
  assert.match(html, /Promote Substo to new creators/);
  assert.match(html, /Next steps/);
  assert.match(html, /Old hook text/);
  assert.match(html, /What this answer used/);
});

test("running and failed turns state what happened without internal reasoning", () => {
  const running = render([{ ...base, id: "t2", status: "running", waiting: "queued", activity: ["Read a saved passage"], result: null }]);
  assert.match(running, /Read a saved passage/);
  assert.match(running, /Waiting for your computer or provider/);
  assert.match(running, /disabled=""/);
  const failed = render([{ ...base, id: "t3", status: "failed", error: "The model run stopped before answering.", result: null }]);
  assert.match(failed, /Nothing was changed/);
  assert.match(failed, /Send again/);
});

test("a fresh entry offers Resume versus Start new inline, without attaching to the old draft", () => {
  const resume = { id: "old", title: "Earlier hook work", turns: 2, updatedAt: "2026-11-20T10:00:00Z", href: "/studio/library/s1?mode=create&draft=old" };
  const html = render([], [], { resume }, null);
  assert.match(html, /You already started a draft from this source/);
  assert.match(html, /href="\/studio\/library\/s1\?mode=create&amp;draft=old"[^>]*>Resume that draft/);
  assert.match(html, />Start new</);
  assert.match(html, /Start for me/);
  assert.ok(!/Start a new draft/.test(html), "no duplicate new-draft link before there is a draft");
  // Resuming an explicit draft shows no offer, and a new-draft action is available straight away.
  const resumed = render([], [], { resume, newDraftHref: "/x" });
  assert.ok(!/already started a draft/.test(resumed));
  assert.match(resumed, /Start a new draft/);
});

test("a proposal for an existing Script says it replaces it (undoable); long quotes preview on whole words with the full quote one click away", () => {
  const long = "The opening sets the promise for the viewer and then every later moment pays that promise off before the practice section begins, which is why the structure works for first-time creators making their own videos and measuring what holds attention across both openings.";
  const withScript: CreationRecord = { ...record, state: { ...record.state, stages: { ...record.state.stages, Script: { text: "Saved six minute script", approved: true, shortlist: [], targetSeconds: 360 } } } };
  const turn: AgentTurnView = { ...done, result: { ...done.result!, proposals: [{ stage: "Script", text: "A different script", rationale: "r", verify: [], evidenceIds: ["f:1"],
    evidence: [{ id: "f:1", label: "L", quote: long, sourceId: "s1", at: 42 }] }] } };
  const html = render([turn], [], {}, withScript);
  assert.match(html, />Replace saved Script</);
  assert.match(html, /This replaces your saved Script\. <strong>Undo last change<\/strong>/);
  assert.ok(!/>Use as Script</.test(html));
  assert.match(html, /Show full quote/);
  assert.ok(html.includes(`“${long}”`), "the full saved quote is present unaltered");
  const preview = /“([^“”]*…)”/.exec(html)![1];
  assert.ok(long.startsWith(preview.slice(0, -1)), "the preview is an exact prefix");
  assert.ok(/\s/.test(long[preview.length - 1] ?? " ") || long[preview.length - 1] === undefined || /\W/.test(long[preview.length - 1]), "the preview ends before a word boundary, not inside a word");
  // No saved Script: the plain wording, no replace warning.
  const plain = render([turn], [], {}, record);
  assert.match(plain, />Use as Script</);
  assert.ok(!/This replaces your saved Script/.test(plain));
});
