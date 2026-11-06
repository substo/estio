import assert from "node:assert/strict";
import test from "node:test";
import { createUserCrmCredentials } from "./credentials";

type Key = string;
const keyOf = (input: { scopeType: string; scopeId: string; domain: string; secretKey?: string }) =>
    [input.scopeType, input.scopeId, input.domain, input.secretKey ?? ""].join("|");

function fakeStore() {
    const documents = new Map<Key, { payload: any; version: number; schemaVersion: number }>();
    const secrets = new Map<Key, string>();
    const calls: string[] = [];
    const settings = {
        async getDocument(input: any) { return documents.get(keyOf(input)) ?? null; },
        async upsertDocument(input: any) {
            const existing = documents.get(keyOf(input));
            if (input.expectedVersion != null && (existing?.version ?? 0) !== input.expectedVersion) throw new Error("version conflict");
            const saved = { payload: input.payload, version: (existing?.version ?? 0) + 1, schemaVersion: 1 };
            documents.set(keyOf(input), saved);
            calls.push(`upsert:${input.domain}`);
            return saved as any;
        },
        async getSecret(input: any) { return secrets.get(keyOf(input)) ?? null; },
        async hasSecret(input: any) { return secrets.has(keyOf(input)); },
        async setSecret(input: any) { secrets.set(keyOf(input), input.plaintext); calls.push(`set:${input.secretKey}`); return {} as any; },
        async clearSecret(input: any) { secrets.delete(keyOf(input)); calls.push(`clear:${input.secretKey}`); return null; },
    };
    const secretRows = {
        async findMany(args: any) {
            return [...secrets.keys()]
                .map(key => key.split("|"))
                .filter(([scopeType, scopeId, domain, secretKey]) => scopeType === args.where.scopeType && domain === args.where.domain
                    && secretKey === args.where.secretKey && args.where.scopeId.in.includes(scopeId))
                .map(([, scopeId]) => ({ scopeId }));
        },
    };
    const documentRows = {
        async findMany(args: any) {
            return [...documents.entries()]
                .map(([key, doc]) => ({ parts: key.split("|"), doc }))
                .filter(({ parts: [scopeType, scopeId, domain] }) => scopeType === args.where.scopeType && domain === args.where.domain && args.where.scopeId.in.includes(scopeId))
                .map(({ parts: [, scopeId], doc }) => ({ scopeId, payload: doc.payload }));
        },
    };
    return { documents, secrets, calls, credentials: createUserCrmCredentials({ settings: settings as any, secretRows, documentRows }) };
}

test("username comes from the user.crm document and password from the encrypted crm_password secret (USER scope)", async () => {
    const store = fakeStore();
    await store.credentials.setUserCrmCredentials({ userId: "u1", username: "  agent  ", password: "s3cret", actorUserId: "u1" });

    assert.deepEqual(await store.credentials.getUserCrmCredentials("u1"), { username: "agent", password: "s3cret" });
    assert.deepEqual(store.documents.get("USER|u1|user.crm|")?.payload, { crmUsername: "agent" });
    assert.equal(store.secrets.get("USER|u1|user.crm|crm_password"), "s3cret");
    assert.equal(await store.credentials.hasUserCrmPassword("u1"), true);
    assert.deepEqual(await store.credentials.getUserCrmCredentials("someone-else"), { username: null, password: null });
});

test("undefined keeps the stored password, null removes it, empty string is refused", async () => {
    const store = fakeStore();
    await store.credentials.setUserCrmCredentials({ userId: "u1", username: "agent", password: "first" });
    await store.credentials.setUserCrmCredentials({ userId: "u1", username: "renamed" });
    assert.deepEqual(await store.credentials.getUserCrmCredentials("u1"), { username: "renamed", password: "first" });

    await store.credentials.setUserCrmCredentials({ userId: "u1", username: "renamed", password: null });
    assert.deepEqual(await store.credentials.getUserCrmCredentials("u1"), { username: "renamed", password: null });

    await assert.rejects(store.credentials.setUserCrmCredentials({ userId: "u1", username: "renamed", password: "   " }), /cannot be empty/);
});

test("saving keeps other keys in the user.crm document", async () => {
    const store = fakeStore();
    store.documents.set("USER|u1|user.crm|", { payload: { crmUsername: "old", note: "kept" }, version: 3, schemaVersion: 1 });
    await store.credentials.setUserCrmCredentials({ userId: "u1", username: "new" });
    assert.deepEqual(store.documents.get("USER|u1|user.crm|")?.payload, { crmUsername: "new", note: "kept" });
});

test("clear removes username and password", async () => {
    const store = fakeStore();
    await store.credentials.setUserCrmCredentials({ userId: "u1", username: "agent", password: "pw" });
    await store.credentials.clearUserCrmCredentials({ userId: "u1", actorUserId: "admin" });
    assert.deepEqual(await store.credentials.getUserCrmCredentials("u1"), { username: null, password: null });
    assert.equal(store.secrets.size, 0);
});

test("filterUserIdsWithCrmCredentials keeps order and requires both username and password", async () => {
    const store = fakeStore();
    await store.credentials.setUserCrmCredentials({ userId: "both-late", username: "a", password: "p" });
    await store.credentials.setUserCrmCredentials({ userId: "password-only", username: null, password: "p" });
    await store.credentials.setUserCrmCredentials({ userId: "username-only", username: "b" });
    await store.credentials.setUserCrmCredentials({ userId: "both-early", username: "c", password: "p" });

    assert.deepEqual(
        await store.credentials.filterUserIdsWithCrmCredentials(["both-early", "password-only", "username-only", "none", "both-late"]),
        ["both-early", "both-late"],
    );
    assert.deepEqual(await store.credentials.filterUserIdsWithCrmCredentials([]), []);
});
