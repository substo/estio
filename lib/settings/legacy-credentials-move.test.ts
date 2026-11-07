import assert from "node:assert/strict";
import test from "node:test";
import { formatLegacyCredentialsReport, moveLegacyCredentials, type LegacyCredentialsStore } from "./legacy-credentials-move";

const PLAIN = "plain-secret-value";
const decrypt = (value: string) => { if (value === "bad") throw new Error("bad tag"); return value.replace(/^enc:/, ""); };

function fixture(options: {
    outlook?: Array<{ id: string; password: string | null; cookies: string | null }>;
    columns?: Array<{ id: string; value: string | null }>;
    documents?: Array<{ scopeId: string; payload: unknown; version: number }>;
    existingSecrets?: string[];
    breakReadBack?: boolean;
    dropped?: boolean;
}) {
    const secrets = new Map<string, string>((options.existingSecrets ?? []).map(key => [key, "existing"]));
    const calls: string[] = [];
    const key = (s: { scopeType: string; scopeId: string; secretKey: string }) => `${s.scopeType}:${s.scopeId}:${s.secretKey}`;
    const store: LegacyCredentialsStore = {
        async columnExists() { return !options.dropped; },
        async listOutlookRows() { return options.outlook ?? []; },
        async listWebhookColumnRows() { return options.columns ?? []; },
        async listIntegrationDocuments() { return options.documents ?? []; },
        async clearColumn(input) { calls.push(`clear ${input.table}.${input.column} ${input.id} by ${input.actorUserId} ${input.requestId}`); },
        async stripWebhookKeyFromDocument(input) { calls.push(`strip ${input.scopeId} v${input.expectedVersion}`); },
    };
    const secretPort = {
        async hasSecret(s: any) { return secrets.has(key(s)); },
        async getSecret(s: any) { return options.breakReadBack ? "different" : secrets.get(key(s)) ?? null; },
        async setSecret(s: any) { secrets.set(key(s), s.plaintext); calls.push(`set ${key(s)} by ${s.actorUserId} ${s.requestId}`); },
    };
    return { secrets, calls, deps: { store, secrets: secretPort, decrypt } };
}

const run = (apply: boolean, deps: any) => moveLegacyCredentials({ apply, actorUserId: "admin-1", requestId: "req-1" }, deps);

test("dry run plans without writing anything", async () => {
    const f = fixture({ outlook: [{ id: "u1", password: "enc:pw", cookies: "enc:[]" }], columns: [{ id: "l1", value: "tok" }] });
    const report = await run(false, f.deps);
    assert.equal(report.toMove, 3);
    assert.equal(report.written, 0);
    assert.deepEqual(f.calls, []);
});

test("apply stores each value, verifies it, then clears the old copy, attributing the actor", async () => {
    const f = fixture({
        outlook: [{ id: "u1", password: "enc:pw", cookies: "enc:[]" }],
        columns: [{ id: "l1", value: "col-tok" }],
        documents: [{ scopeId: "l1", payload: { whatsappWebhookSecret: "doc-tok", other: 1 }, version: 4 }, { scopeId: "l2", payload: { other: 1 }, version: 1 }],
    });
    const report = await run(true, f.deps);
    assert.equal(report.written, 3);
    assert.deepEqual(report.errors, []);
    assert.equal(f.secrets.get("USER:u1:outlook_password"), "pw");
    assert.equal(f.secrets.get("USER:u1:outlook_session_cookies"), "[]");
    assert.equal(f.secrets.get("LOCATION:l1:whatsapp_webhook_secret"), "doc-tok", "the document value wins");
    assert.deepEqual(f.calls, [
        "set USER:u1:outlook_password by admin-1 req-1",
        "clear User.outlookPasswordEncrypted u1 by admin-1 req-1",
        "set USER:u1:outlook_session_cookies by admin-1 req-1",
        "clear User.outlookSessionCookies u1 by admin-1 req-1",
        "set LOCATION:l1:whatsapp_webhook_secret by admin-1 req-1",
        "strip l1 v4",
        "clear Location.whatsappWebhookSecret l1 by admin-1 req-1",
    ]);
});

test("an existing secret is never overwritten; only the old copy is cleared", async () => {
    const f = fixture({ outlook: [{ id: "u1", password: "enc:pw", cookies: null }], existingSecrets: ["USER:u1:outlook_password"] });
    const report = await run(true, f.deps);
    assert.equal(f.secrets.get("USER:u1:outlook_password"), "existing");
    assert.equal(report.items[0].action, "clear_only");
    assert.deepEqual(f.calls, ["clear User.outlookPasswordEncrypted u1 by admin-1 req-1"]);
});

test("a failed read-back keeps the old copy and reports the error", async () => {
    const f = fixture({ outlook: [{ id: "u1", password: "enc:pw", cookies: null }], breakReadBack: true });
    const report = await run(true, f.deps);
    assert.equal(report.written, 0);
    assert.equal(report.errors.length, 1);
    assert.ok(!f.calls.some(call => call.startsWith("clear")), "nothing cleared");
});

test("unreadable values are skipped and counted", async () => {
    const f = fixture({ outlook: [{ id: "u1", password: "bad", cookies: null }] });
    const report = await run(true, f.deps);
    assert.equal(report.unreadable, 1);
    assert.equal(report.toMove, 0);
    assert.deepEqual(f.calls, []);
});

test("dropped columns mean nothing left to move", async () => {
    const report = await run(true, fixture({ dropped: true }).deps);
    assert.equal(report.toMove, 0);
    assert.equal(report.items.length, 0);
});

test("no value ever appears in the report or its text", async () => {
    const f = fixture({ outlook: [{ id: "u1", password: `enc:${PLAIN}`, cookies: null }], columns: [{ id: "l1", value: PLAIN }] });
    for (const apply of [false, true]) {
        const report = await run(apply, f.deps);
        assert.doesNotMatch(JSON.stringify(report) + formatLegacyCredentialsReport(report).join("\n"), new RegExp(PLAIN));
    }
});
