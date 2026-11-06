import assert from "node:assert/strict";
import test from "node:test";
import { planOutlookColumnMove, planWebhookSecretMove } from "./legacy-credentials-plan";

test("webhook verify token: document wins, existing secret is never overwritten", () => {
    assert.deepEqual(planWebhookSecretMove({ documentValue: " doc ", columnValue: "col", hasSecret: false }),
        { action: "store_secret_and_clear", value: "doc", note: "document and column differ; document value wins" });
    assert.equal(planWebhookSecretMove({ documentValue: undefined, columnValue: "col", hasSecret: false }).value, "col");
    assert.deepEqual(planWebhookSecretMove({ documentValue: "doc", columnValue: "doc", hasSecret: true }),
        { action: "clear_only", value: null, note: "already has secret; would clear legacy copies" });
    assert.equal(planWebhookSecretMove({ documentValue: undefined, columnValue: null, hasSecret: false }).action, "nothing");
    assert.equal(planWebhookSecretMove({ documentValue: null, columnValue: null, hasSecret: false }).action, "clear_only");
});

test("outlook column: decryptable values move, unreadable ones stay, existing secret wins", () => {
    assert.deepEqual(planOutlookColumnMove({ encrypted: "x", hasSecret: false, decrypt: () => "plain" }),
        { action: "store_secret_and_clear", value: "plain", note: "decrypts; would store secret and clear column" });
    assert.equal(planOutlookColumnMove({ encrypted: "x", hasSecret: false, decrypt: () => { throw new Error("bad tag"); } }).action, "skip_unreadable");
    assert.equal(planOutlookColumnMove({ encrypted: "x", hasSecret: true, decrypt: () => { throw new Error("not called"); } }).action, "clear_only");
    assert.equal(planOutlookColumnMove({ encrypted: null, hasSecret: false, decrypt: () => "" }).action, "nothing");
});
