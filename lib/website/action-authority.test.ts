import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

function load(file: string, dependencies: Record<string, unknown>): any {
    const module = { exports: {} };
    const code = ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
    vm.runInNewContext(code, { module, exports: module.exports, require: (name: string) => dependencies[name] || {}, console: { log() {}, error() {} }, process, FormData, URL });
    return module.exports;
}

test("every shared website AI entry rejects a different brand before reading config, fetching or calling AI", async () => {
    const guards: string[] = [];
    const actions = load("app/(main)/admin/content/ai-actions.ts", {
        "@/lib/auth/crm-action-guard": { assertCrmActionAllowed: async (_module: string, action: string) => { guards.push(action); } },
        "@clerk/nextjs/server": { auth: async () => ({ userId: "substo-user" }) },
        "@/lib/auth/location-context": { getLocationContext: async () => ({ id: "own-brand" }) },
        "@/lib/db": { siteConfig: { findUnique: () => { throw new Error("Unexpected config access"); } } },
    });
    const calls = [
        () => actions.generateContentFromUrl("https://example.com", "other-brand"),
        () => actions.regeneratePageDesign([], "other-brand"),
        () => actions.generateBrandVoiceFromSite("other-brand"),
        () => actions.refineBlockContent({}, "Improve", "other-brand"),
        () => actions.generateSiteTheme("other-brand", "Improve", {}),
        () => actions.generateSectionFromPrompt("other-brand", "Hero"),
    ];
    for (const call of calls) {
        const result = await call(); assert.equal(result.success, false); assert.match(result.error, /Active location mismatch/);
    }
    assert.equal(guards.length, 6);
});

test("shared navigation rejects foreign brand IDs and resolves the admin inside the request realm", async () => {
    let reads = 0;
    const actions = load("app/(main)/admin/site-settings/navigation/actions.ts", {
        "@/lib/auth/crm-action-guard": { assertCrmActionAllowed: async () => {} },
        "@clerk/nextjs/server": { auth: async () => ({ userId: "clerk-user" }) },
        "@/lib/auth/request-realm": { getRequestAuthRealm: async () => "substo" },
        "@/lib/auth/location-context": { getLocationContext: async () => ({ id: "own-brand" }) },
        "@/lib/auth/permissions": { verifyUserIsLocationAdmin: async () => true },
        "@/lib/db": {
            user: { findUnique: async ({ where }: any) => { assert.equal(where.authRealm_clerkId.authRealm, "substo"); assert.equal(where.authRealm_clerkId.clerkId, "clerk-user"); return { id: "user" }; } },
            contentPage: { findMany: async ({ where }: any) => { reads++; assert.equal(where.locationId, "own-brand"); return [{ title: "About", slug: "about" }]; } },
        },
    });
    for (const call of [() => actions.getLivePages("foreign"), () => actions.saveNavigation("foreign", "nav", []), () => actions.saveFooterBio("foreign", ""), () => actions.saveFooterDisclaimer("foreign", ""), () => actions.saveNavigationStyle("foreign", "top")]) await assert.rejects(call, /Unauthorized/);
    assert.equal(reads, 0);
    const options = await actions.getLivePages("own-brand");
    assert.deepEqual(Array.from(options, (item: any) => item.value), ["/", "/blog", "/about"]);
    assert.equal(reads, 1);
});


test("shared homepage action rejects foreign brands/property sections and mirrors generic sections for publication", async () => {
    const writes: any[] = [];
    const actions = load("app/(main)/admin/content/actions.ts", {
        "@/lib/auth/crm-action-guard": { assertCrmActionAllowed: async () => {} },
        "@clerk/nextjs/server": { auth: async () => ({ userId: "clerk-user" }) },
        "@/lib/auth/request-realm": { getRequestAuthRealm: async () => "substo" },
        "@/lib/auth/location-context": { getLocationContext: async () => ({ id: "own-brand" }) },
        "@/lib/auth/permissions": { verifyUserIsLocationAdmin: async () => true },
        "@/lib/db": { user: { findUnique: async ({ where }: any) => { assert.equal(where.authRealm_clerkId.authRealm, "substo"); return { id: "user" }; } }, siteConfig: { upsert: async (query: any) => { writes.push(query); } } },
        "@/lib/settings/service": { settingsService: { getDocument: async () => null, upsertDocument: async () => ({}) } },
        "@/lib/settings/constants": { SETTINGS_DOMAINS: { LOCATION_CONTENT: "content" }, isSettingsDualWriteLegacyEnabled: () => false, isSettingsParityCheckEnabled: () => false },
        "next/cache": { revalidatePath: () => {} },
    });
    const form = new FormData(); form.set("locationId", "foreign"); form.set("blocks", "[]");
    assert.equal((await actions.updateHomeConfig({}, form)).success, false);
    form.set("locationId", "own-brand"); form.set("blocks", JSON.stringify([{ type: "featured-properties" }]));
    assert.equal((await actions.updateHomeConfig({}, form)).success, false); assert.equal(writes.length, 0);
    form.set("blocks", JSON.stringify([{ type: "hero", headline: "Our business" }, { type: "features", title: "Services" }]));
    assert.equal((await actions.updateHomeConfig({}, form)).success, true);
    assert.equal(writes.length, 1); assert.equal(writes[0].where.locationId, "own-brand");
    assert.equal(writes[0].update.heroContent.headline, "Our business");
    assert.deepEqual(Array.from(writes[0].update.homeSections, (section: any) => section.type), ["hero", "features"]);
});
