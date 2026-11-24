import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentDock } from "./agent-dock";
import { AssetsRail } from "./assets-rail";
import { PlayerStage } from "./player-stage";
import { TimelineView } from "./timeline-view";
import { TranscriptPanel } from "./transcript-panel";
import { buildTranscript } from "@/lib/studio/workspace/transcript";
import { groupAssets } from "@/lib/studio/workspace/assets";

const noop = () => {};
const snapshot = { d: 20, tracks: [
  { n: "Text", k: "video" as const, c: [{ s: 1, e: 4, l: "TIP 1", k: "text" }, { s: 10, e: 12, l: "TIP 2", k: "text" }] },
  { n: "Screen", k: "video" as const, c: [{ s: 0, e: 20, l: "shot", k: "media" }] },
  { n: "Voice", k: "audio" as const, c: [] },
] };

test("timeline renders every layer, labelled accessible clip buttons, and selection actions", () => {
  const html = renderToStaticMarkup(<TimelineView snapshot={snapshot} selected={{ track: "Text", clip: snapshot.tracks[0].c[0] }} onSelect={noop} onAction={noop} canEdit busy={false} />);
  for (const name of ["Text", "Screen", "Voice"]) assert.match(html, new RegExp(`>${name}<`));
  assert.match(html, /aria-label="Text: TIP 1, 0:01 to 0:04"/);
  assert.match(html, /aria-pressed="true"/);
  for (const label of ["Trim", "Replace", "Delete", "Retake audio", "Ask the agent"]) assert.match(html, new RegExp(`>${label}<`));
  assert.doesNotMatch(renderToStaticMarkup(<TimelineView snapshot={snapshot} selected={null} onSelect={noop} onAction={noop} canEdit busy={false} />), /Selected clip/);
});

test("timeline without a snapshot explains itself; actions are disabled until a project exists", () => {
  assert.match(renderToStaticMarkup(<TimelineView snapshot={null} selected={null} onSelect={noop} onAction={noop} canEdit={false} busy={false} />), /appears after the next video/);
  const html = renderToStaticMarkup(<TimelineView snapshot={snapshot} selected={{ track: "Text", clip: snapshot.tracks[0].c[0] }} onSelect={noop} onAction={noop} canEdit={false} busy={false} />);
  assert.match(html, /disabled=""[^>]*>Trim/); assert.match(html, /Make a video first/);
});

test("player shows the video with a version switcher, a live stepper, or the empty state", () => {
  const v = (id: string, i: number) => ({ id, name: `Edited video ${i}.mp4`, bytes: 9_000_000, createdAt: "2026-11-23T11:00:00Z" });
  const html = renderToStaticMarkup(<PlayerStage versions={[v("a", 2), v("b", 1)]} versionId="a" onVersion={noop} steps={[{ key: "narration", label: "Narration", state: "active", detail: "3 of 6 voiced" }, { key: "editing", label: "Editing", state: "pending", detail: null }]} empty={null} />);
  assert.doesNotMatch(html, />Stop</); assert.match(html, /Download/);
  assert.match(renderToStaticMarkup(<PlayerStage versions={[v("a", 2)]} versionId="a" onVersion={noop} steps={null} empty={null} onStop={noop} />), />Stop</);
  assert.match(html, /<video[^>]*controls/); assert.match(html, /src="\/studio\/uploads\/a\?inline=1"/); assert.match(html, /Latest/); assert.match(html, /3 of 6 voiced/); assert.match(html, /aria-current="step"/);
  assert.match(renderToStaticMarkup(<PlayerStage versions={[]} versionId="" onVersion={noop} steps={null} empty={<p>No video yet</p>} />), /No video yet/);
});

test("agent dock shows its focus, suggestions and enabled/disabled states", () => {
  const thread = [{ id: "1", instruction: "Make it shorter", createdAt: "2026-11-23T11:00:00Z", status: "succeeded" as const, reply: "Trimmed 4 s" }];
  const html = renderToStaticMarkup(<AgentDock thread={thread} projectKept busy={false} selected={{ track: "Text", clip: { s: 1, e: 4, l: "TIP 1", k: "text" } }} onClearSelection={noop} onSend={noop} pending={false} draft="" onDraft={noop} onStop={noop} stopping={false} />);
  assert.match(html, /you can stop it/); assert.doesNotMatch(html, />Stop</);
  assert.match(renderToStaticMarkup(<AgentDock thread={[]} projectKept busy selected={null} onClearSelection={noop} onSend={noop} pending={false} draft="" onDraft={noop} onStop={noop} stopping={false} />), />Stop</);
  assert.match(html, /Focus: Text · TIP 1/); assert.match(html, /Make it shorter/); assert.match(html, /Trimmed 4 s/); assert.match(html, /Make this shorter/); assert.match(html, /aria-label="Clear focus"/);
  const off = renderToStaticMarkup(<AgentDock thread={[]} projectKept={false} busy={false} selected={null} onClearSelection={noop} onSend={noop} pending={false} draft="" onDraft={noop} onStop={noop} stopping={false} />);
  assert.match(off, /Focus: whole video/); assert.match(off, /Make a video first/); assert.match(off, /disabled=""/);
});

test("assets rail lists the footage only: narration lives on the script blocks and exports are versions in the player", () => {
  const up = (id: string, name: string, status = "uploaded") => ({ id, name, contentType: name.endsWith(".mp3") ? "audio/mpeg" : "video/mp4", byteSize: 4_000_000, createdAt: "2026-11-23T11:40:00Z", status });
  const groups = groupAssets([up("1", "shot.mp4"), up("2", "Edited video 2026-11-23 1325.mp4"), up("3", "Narration 2026-11-23 1140 01.mp3"), up("4", "Narration 2026-11-23 1140 02.mp3"), up("5", "bad.mov", "awaiting_upload")], []);
  const html = renderToStaticMarkup(<AssetsRail groups={groups} uploadSlot={<div>UPLOAD-ZONE</div>} />);
  assert.match(html, /Footage/); assert.match(html, /You uploaded/); assert.match(html, /UPLOAD-ZONE/); assert.match(html, /shot\.mp4/);
  assert.doesNotMatch(html, /Narration/); assert.doesNotMatch(html, /Exports/); assert.doesNotMatch(html, /Show in player/); assert.doesNotMatch(html, /Edited video/);
  assert.doesNotMatch(html, /bad\.mov/); assert.doesNotMatch(html, /Check storage and finish/);
});

test("transcript shows each beat as a line of clickable words with a start time, and says the timing is estimated", () => {
  const lines = buildTranscript(["Stop scrolling, now.", "Watch this"], [{ s: 0, e: 4 }, { s: 65, e: 67 }])!;
  const html = renderToStaticMarkup(<TranscriptPanel lines={lines} videoRef={{ current: null }} onEditScript={noop} />);
  assert.match(html, /aria-label="Transcript"/); assert.match(html, />Stop<\/button><\/span>/); assert.match(html, /<span> <button[^>]*>scrolling,<\/button>/); assert.match(html, /Play from 0:00/); assert.match(html, /Play from 1:05/);
  assert.match(html, /Click a word to play from it/); assert.match(html, /estimated/); assert.match(html, /Edit the script/);
});
