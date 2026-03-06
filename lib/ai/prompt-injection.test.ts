import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

function read(relativePath: string): string {
    return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

test("AI draft path injects shared communication contract", () => {
    const source = read("lib/ai/coordinator.ts");
    assert.match(source, /buildDealProtectiveCommunicationContract/);
    assert.match(source, /communicationContract/);
});

test("skill execution path injects shared communication contract", () => {
    const source = read("lib/ai/skills/loader.ts");
    assert.match(source, /buildDealProtectiveCommunicationContract/);
    assert.match(source, /skill-generated outbound communication/);
    assert.match(source, /post-tool synthesized outbound reply/);
});

test("smart reply path injects shared communication contract", () => {
    const source = read("lib/ai/smart-replies.ts");
    assert.match(source, /buildDealProtectiveCommunicationContract/);
    assert.match(source, /suggested action labels/);
});
