import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { handleLegacyCredentialsApply } from "./legacy-credentials-http";

const report = { apply: true, outlookColumnsPresent: true, webhookColumnPresent: true, items: [
    { kind: "outlook_password" as const, scopeId: "u1", action: "store_secret_and_clear" as const, note: "", written: true },
], toMove: 1, written: 1, unreadable: 0, errors: [] };

function deps(overrides: { actor?: { internalUserId: string } | null; sameOrigin?: boolean } = {}) {
    const runs: unknown[] = [];
    return {
        runs,
        value: {
            getActor: async () => (overrides.actor === undefined ? { internalUserId: "admin-1" } : overrides.actor),
            sameOrigin: () => overrides.sameOrigin ?? true,
            run: async (input: any) => { runs.push(input); return report; },
        },
    };
}
const request = () => new Request("https://estio.co/api/platform/legacy-credentials", { method: "POST" });

test("non-admins (including impersonation, which yields no admin context) are refused before anything runs", async () => {
    const d = deps({ actor: null });
    const response = await handleLegacyCredentialsApply(request(), d.value);
    assert.equal(response.status, 403);
    assert.equal(d.runs.length, 0);
});

test("cross-origin requests are refused before anything runs", async () => {
    const d = deps({ sameOrigin: false });
    assert.equal((await handleLegacyCredentialsApply(request(), d.value)).status, 403);
    assert.equal(d.runs.length, 0);
});

test("the platform admin applies, attributed to their user, and gets counts only", async () => {
    const d = deps();
    const response = await handleLegacyCredentialsApply(request(), d.value);
    assert.equal(response.status, 200);
    assert.deepEqual(d.runs, [{ apply: true, actorUserId: "admin-1" }]);
    const body = await response.json();
    assert.deepEqual(body, { toMove: 0, written: 1, unreadable: 0, errors: 0, groups: [] });
    assert.doesNotMatch(JSON.stringify(body), /u1/);
});

test("the route wires the platform-admin gate and the same-origin check", () => {
    const route = readFileSync(new URL("../../app/api/platform/legacy-credentials/route.ts", import.meta.url), "utf8");
    assert.match(route, /getActor: getPlatformAdminContext/);
    assert.match(route, /sameOrigin,/);
    assert.doesNotMatch(route, /export (async )?function GET/);
    const platformAccess = readFileSync(new URL("../auth/platform-access.ts", import.meta.url), "utf8");
    assert.match(platformAccess, /if \(!userId \|\| actor\) return null;/);
});
