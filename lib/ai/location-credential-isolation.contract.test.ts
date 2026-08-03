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
