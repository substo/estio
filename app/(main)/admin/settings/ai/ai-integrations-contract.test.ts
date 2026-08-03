import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const root = process.cwd();

test("AI Configuration has no credential inputs or query/cookie location authority", async () => {
    const [page, form] = await Promise.all([
        readFile(`${root}/app/(main)/admin/settings/ai/page.tsx`, "utf8"),
        readFile(`${root}/app/(main)/admin/settings/ai/ai-settings-form.tsx`, "utf8"),
    ]);
    assert.doesNotMatch(page, /searchParams\.locationId|crm_location_id/);
    assert.doesNotMatch(form, /name="googleAiApiKey"|name="openAiApiKey"/);
    assert.match(form, /Advanced model settings/);
    assert.match(form, /Balanced/);
    assert.match(form, /applyAiPreset/);
    assert.match(form, /setAiPreset\("custom"\)/);
});

test("AI services have separate integration cards and pages", async () => {
    const page = await readFile(`${root}/app/(main)/admin/settings/integrations/page.tsx`, "utf8");
    assert.match(page, /\/integrations\/gemini/);
    assert.match(page, /\/integrations\/openai-api/);
    assert.match(page, /\/integrations\/chatgpt-subscription/);
});

test("device-code UX exposes accessible states without terminal instructions", async () => {
    const [panel, page] = await Promise.all([
        readFile(`${root}/app/(main)/admin/settings/integrations/chatgpt-subscription/chatgpt-connection-panel.tsx`, "utf8"),
        readFile(`${root}/app/(main)/admin/settings/integrations/chatgpt-subscription/page.tsx`, "utf8"),
    ]);
    assert.match(panel, /DialogTitle/);
    assert.match(panel, /DialogDescription/);
    assert.match(panel, /aria-live="polite"/);
    assert.match(panel, /waiting/);
    assert.match(panel, /connected/);
    assert.match(panel, /personal_only/);
    assert.match(panel, /Save as my connection/);
    assert.match(panel, /min-h-11/);
    assert.match(page, /Shared by everyone at this location/);
    assert.match(page, /Only used by you/);
    assert.doesNotMatch(`${panel}\n${page}`, /codex login|terminal command/i);
});

test("Gemini saves only the encrypted settings secret and does not duplicate new keys", async () => {
    const actions = await readFile(`${root}/app/(main)/admin/settings/integrations/ai-provider-actions.ts`, "utf8");
    assert.match(actions, /settingsService\.setSecret/);
    assert.doesNotMatch(actions, /siteConfig\.upsert/);
});
