import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const root = process.cwd();

test("location-funded AI paths never select an arbitrary SiteConfig key", async () => {
    const files = [
        "lib/ai/llm.ts",
        "lib/ai/search/hybrid-search.ts",
        "lib/ai/search/property-embeddings.ts",
        "lib/scraping/extractors/generic.ts",
    ];
    for (const file of files) {
        const source = await readFile(`${root}/${file}`, "utf8");
        assert.doesNotMatch(source, /siteConfig\.findFirst|googleAiApiKey:\s*\{\s*not:\s*null/);
    }
});

test("location key resolution never falls through to the Estio global key", async () => {
    const source = await readFile(`${root}/lib/ai/location-google-key.ts`, "utf8");
    const locationResolver = source.slice(source.indexOf("export async function resolveLocationGoogleAiApiKey"), source.indexOf("export function resolveEstioGlobalGoogleAiApiKey"));
    assert.doesNotMatch(locationResolver, /process\.env\.GOOGLE_API_KEY/);
});

test("no app or script code reads the retired plaintext SiteConfig.googleAiApiKey column", async () => {
    const { execFileSync } = await import("node:child_process");
    // Only the column-retirement script and the historical settings backfill may name it; the public-site loader blanks it.
    const allowed = new Set(["scripts/ai/move-plaintext-keys.ts", "scripts/settings/backfill.ts", "lib/public-data.ts"]);
    const hits = execFileSync("git", ["grep", "-l", "googleAiApiKey", "--", "app", "lib", "scripts", "components"], { cwd: root, encoding: "utf8" })
        .split("\n").filter(Boolean).filter(file => !allowed.has(file) && !/\.test\.ts$/.test(file));
    for (const file of hits) {
        const source = await readFile(`${root}/${file}`, "utf8");
        assert.doesNotMatch(source.replace(/\b(?:find\w*|resolve\w*)GoogleAiApiKey\b/g, ""), /googleAiApiKey/, file);
    }
});
